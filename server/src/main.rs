mod db;

use db::{establish_connection, run_migrations};

fn main() {
    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        eprintln!("DATABASE_URL must be set");
        std::process::exit(1);
    });

    let mut conn = match establish_connection(&database_url) {
        Ok(conn) => conn,
        Err(err) => {
            eprintln!("failed to connect to DB: {err}");
            std::process::exit(1);
        }
    };

    if let Err(err) = run_migrations(&mut conn) {
        eprintln!("failed to run DB migrations: {err}");
        std::process::exit(1);
    }

    println!("murmur server DB initialized");
}
