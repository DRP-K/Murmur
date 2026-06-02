use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, CustomizeConnection, Error as DieselR2d2Error};
use diesel::sql_query;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};
use r2d2::{Pool, PooledConnection};

pub mod models;
pub mod repository;
pub mod schema;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("./migrations");
pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;
pub type DbConn = PooledConnection<ConnectionManager<SqliteConnection>>;

#[derive(Debug)]
struct SqliteCustomizer;

impl CustomizeConnection<SqliteConnection, DieselR2d2Error> for SqliteCustomizer {
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), DieselR2d2Error> {
        conn.batch_execute(
            "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
        )
        .map_err(DieselR2d2Error::QueryError)
    }
}

pub fn establish_connection(
    database_url: &str,
) -> Result<SqliteConnection, diesel::ConnectionError> {
    let mut conn = SqliteConnection::establish(database_url)?;
    sql_query("PRAGMA foreign_keys = ON;")
        .execute(&mut conn)
        .map_err(|err| diesel::ConnectionError::BadConnection(err.to_string()))?;
    Ok(conn)
}

pub fn establish_pool(database_url: &str) -> Result<DbPool, r2d2::Error> {
    let manager = ConnectionManager::<SqliteConnection>::new(database_url);
    Pool::builder()
        .connection_customizer(Box::new(SqliteCustomizer))
        .build(manager)
}

pub fn run_migrations(
    conn: &mut SqliteConnection,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    conn.run_pending_migrations(MIGRATIONS)?;
    Ok(())
}
