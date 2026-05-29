use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use axum::Router;
use axum::http::Method;
use axum::routing::{delete, get, post};
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};
use tracing::{debug, info, warn};

use crate::api;
use crate::bot_ai::ChatMessage;
use crate::db::{DbPool, establish_pool, run_migrations};
use crate::seed;
use crate::wire::ServerEnvelope;

#[derive(Clone)]
pub struct AppState {
    pub pool: DbPool,
    pub sessions: Arc<RwLock<HashMap<String, String>>>,
    pub online: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<ServerEnvelope>>>>,
    pub deepseek_api_key: Option<Arc<String>>,
    pub http_client: Arc<reqwest::Client>,
    /// Keyed by (bot_id, user_id). Holds the alternating user/assistant turns for each
    /// conversation so bots can reply with awareness of prior messages.
    pub conversation_history: Arc<RwLock<HashMap<(String, String), Vec<ChatMessage>>>>,
}

impl AppState {
    pub fn new(pool: DbPool) -> Self {
        let deepseek_api_key = std::env::var("DEEPSEEK_API_KEY").ok().map(|k| {
            info!("DEEPSEEK_API_KEY found — bots will use DeepSeek for replies");
            Arc::new(k)
        });
        Self::with_key(pool, deepseek_api_key)
    }

    pub fn without_ai(pool: DbPool) -> Self {
        Self::with_key(pool, None)
    }

    fn with_key(pool: DbPool, deepseek_api_key: Option<Arc<String>>) -> Self {
        Self {
            pool,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            online: Arc::new(RwLock::new(HashMap::new())),
            deepseek_api_key,
            http_client: Arc::new(reqwest::Client::new()),
            conversation_history: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn from_database_url(
        database_url: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync + 'static>> {
        let pool = Self::init_pool(database_url)?;
        Ok(Self::new(pool))
    }

    pub fn from_database_url_without_ai(
        database_url: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync + 'static>> {
        let pool = Self::init_pool(database_url)?;
        Ok(Self::without_ai(pool))
    }

    fn init_pool(
        database_url: &str,
    ) -> Result<DbPool, Box<dyn std::error::Error + Send + Sync + 'static>> {
        let pool = establish_pool(database_url)?;
        {
            let mut conn = pool.get()?;
            run_migrations(&mut conn)?;
            seed::seed_bots(&mut conn);
        }
        debug!("database pool initialized and migrations applied");
        Ok(pool)
    }

    pub fn user_for_token(&self, token: &str) -> Option<String> {
        self.sessions.read().ok()?.get(token).cloned()
    }

    pub fn put_session(&self, token: String, user_id: String) {
        if let Ok(mut sessions) = self.sessions.write() {
            debug!(user_id = %user_id, "session created");
            sessions.insert(token, user_id);
        }
    }

    pub fn put_online(&self, user_id: String, tx: mpsc::UnboundedSender<ServerEnvelope>) {
        if let Ok(mut online) = self.online.write() {
            debug!(user_id = %user_id, "websocket sender registered");
            online.insert(user_id, tx);
        }
    }

    pub fn remove_online(&self, user_id: &str) {
        if let Ok(mut online) = self.online.write() {
            online.remove(user_id);
            debug!(user_id, "websocket sender removed");
        }
    }

    pub fn send_to_online(&self, user_id: &str, envelope: ServerEnvelope) -> bool {
        // Snapshot sender outside lock.
        let tx = self
            .online
            .read()
            .ok()
            .and_then(|online| online.get(user_id).cloned());

        match tx {
            Some(tx) => {
                let sent = tx.send(envelope).is_ok();
                if !sent {
                    warn!(user_id, "online channel send failed");
                }
                sent
            }
            None => false,
        }
    }
}

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    Router::new()
        .route("/api/register", post(api::register))
        .route("/api/auth", post(api::auth))
        .route(
            "/api/messages",
            post(api::post_message).get(api::get_messages),
        )
        .route("/api/messages/{id}", delete(api::delete_message))
        .route("/api/posts", post(api::post_post).get(api::get_posts))
        .route("/api/posts/ack", post(api::ack_post))
        .route("/api/friends", get(api::get_friends).post(api::add_friend))
        .route("/api/ws", get(api::ws_handler))
        .layer(cors)
        .with_state(state)
}
