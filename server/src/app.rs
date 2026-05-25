use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use axum::Router;
use axum::routing::{delete, get, post};
use tokio::sync::mpsc;
use tracing::{debug, warn};

use crate::api;
use crate::db::{DbPool, establish_pool, run_migrations};
use crate::wire::ServerEnvelope;

#[derive(Clone)]
pub struct AppState {
    pub pool: DbPool,
    pub sessions: Arc<RwLock<HashMap<String, String>>>,
    pub online: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<ServerEnvelope>>>>,
}

impl AppState {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            online: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn from_database_url(
        database_url: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync + 'static>> {
        let pool = establish_pool(database_url)?;
        {
            let mut conn = pool.get()?;
            run_migrations(&mut conn)?;
        }
        debug!("database pool initialized and migrations applied");
        Ok(Self::new(pool))
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
        .with_state(state)
}
