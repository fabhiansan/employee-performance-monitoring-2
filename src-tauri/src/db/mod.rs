use sqlx::{migrate::MigrateDatabase, sqlite::SqlitePool, SqliteConnection};
use std::path::PathBuf;

pub mod models;

pub struct Database {
    pub pool: SqlitePool,
}

impl Database {
    pub async fn new(db_path: PathBuf) -> Result<Self, sqlx::Error> {
        let db_url = format!("sqlite:{}", db_path.display());

        // Create database if it doesn't exist
        if !sqlx::Sqlite::database_exists(&db_url)
            .await
            .unwrap_or(false)
        {
            sqlx::Sqlite::create_database(&db_url).await?;
        }

        let pool = SqlitePool::connect(&db_url).await?;

        // Run migrations
        sqlx::migrate!("./migrations").run(&pool).await?;

        Ok(Self { pool })
    }

    pub async fn get_connection(&self) -> Result<SqliteConnection, sqlx::Error> {
        self.pool.acquire().await.map(|conn| conn.detach())
    }
}
