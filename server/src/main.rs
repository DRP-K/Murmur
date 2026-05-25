use murmur_server::app::{AppState, router};

#[tokio::main]
async fn main() {
    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        eprintln!("DATABASE_URL must be set");
        std::process::exit(1);
    });
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_string());

    let state = match AppState::from_database_url(&database_url) {
        Ok(state) => state,
        Err(err) => {
            eprintln!("failed to initialize DB: {err}");
            std::process::exit(1);
        }
    };

    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("failed to bind {bind_addr}: {err}");
            std::process::exit(1);
        }
    };

    println!("murmur server listening on {bind_addr}");

    if let Err(err) = axum::serve(listener, router(state)).await {
        eprintln!("server error: {err}");
        std::process::exit(1);
    }
}
