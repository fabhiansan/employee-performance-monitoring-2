use crate::db::models::{CreateDataset, Dataset};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_dataset(
    state: State<'_, AppState>,
    dataset: CreateDataset,
) -> Result<Dataset, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;

    let result = sqlx::query_as::<_, Dataset>(
        r#"
        INSERT INTO datasets (name, description, source_file, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
        "#,
    )
    .bind(&dataset.name)
    .bind(&dataset.description)
    .bind(&dataset.source_file)
    .fetch_one(&db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub async fn list_datasets(state: State<'_, AppState>) -> Result<Vec<Dataset>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;

    let datasets = sqlx::query_as::<_, Dataset>("SELECT * FROM datasets ORDER BY created_at DESC")
        .fetch_all(&db.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(datasets)
}

#[tauri::command]
pub async fn get_dataset(state: State<'_, AppState>, id: i64) -> Result<Dataset, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;

    let dataset = sqlx::query_as::<_, Dataset>("SELECT * FROM datasets WHERE id = ?")
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(dataset)
}

#[tauri::command]
pub async fn delete_dataset(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;

    sqlx::query("DELETE FROM datasets WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
