use murmur_server::app::{AppState, router};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("murmur_server=info".parse().expect("valid log directive")),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        error!("DATABASE_URL must be set");
        std::process::exit(1);
    });
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_string());

    let state = match AppState::from_database_url(&database_url) {
        Ok(state) => state,
        Err(err) => {
            error!(error = %err, "failed to initialize DB");
            std::process::exit(1);
        }
    };

    state.fetch_seed_posts().await;

    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(listener) => listener,
        Err(err) => {
            error!(bind_addr = %bind_addr, error = %err, "failed to bind listener");
            std::process::exit(1);
        }
    };

    info!(bind_addr = %bind_addr, "murmur server listening");

    if let Err(err) = axum::serve(listener, router(state)).await {
        error!(error = %err, "server error");
        std::process::exit(1);
    }
}
