use diesel::prelude::*;
use diesel::sql_query;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

pub mod models;
pub mod repository;
pub mod schema;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("./migrations");

pub fn establish_connection(database_url: &str) -> Result<SqliteConnection, diesel::ConnectionError> {
    let mut conn = SqliteConnection::establish(database_url)?;
    sql_query("PRAGMA foreign_keys = ON;")
        .execute(&mut conn)
        .map_err(|err| diesel::ConnectionError::BadConnection(err.to_string()))?;
    Ok(conn)
}

pub fn run_migrations(conn: &mut SqliteConnection) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    conn.run_pending_migrations(MIGRATIONS)?;
    Ok(())
}
