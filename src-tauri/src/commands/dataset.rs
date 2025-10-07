use crate::db::models::{CreateDataset, Dataset};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[tauri::command]
pub async fn create_dataset(
    state: State<'_, AppState>,
    dataset: CreateDataset,
) -> Result<Dataset, String> {
    let pool = state.pool.clone();

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
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub async fn list_datasets(state: State<'_, AppState>) -> Result<Vec<Dataset>, String> {
    let pool = state.pool.clone();

    let datasets = sqlx::query_as::<_, Dataset>("SELECT * FROM datasets ORDER BY created_at DESC")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(datasets)
}

#[tauri::command]
pub async fn get_dataset(state: State<'_, AppState>, id: i64) -> Result<Dataset, String> {
    let pool = state.pool.clone();

    let dataset = sqlx::query_as::<_, Dataset>("SELECT * FROM datasets WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(dataset)
}

#[tauri::command]
pub async fn delete_dataset(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let pool = state.pool.clone();

    sqlx::query("DELETE FROM datasets WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn update_dataset(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    description: Option<String>,
) -> Result<Dataset, String> {
    let pool = state.pool.clone();

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Dataset name cannot be empty".to_string());
    }

    let normalized_description = description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    sqlx::query_as::<_, Dataset>(
        "UPDATE datasets
         SET name = ?, description = ?, updated_at = datetime('now')
         WHERE id = ?
         RETURNING *",
    )
    .bind(trimmed_name)
    .bind(normalized_description)
    .bind(id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        if matches!(e, sqlx::Error::RowNotFound) {
            "Dataset not found".to_string()
        } else {
            e.to_string()
        }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeDatasetsRequest {
    pub source_dataset_ids: Vec<i64>,
    pub target_name: String,
    pub target_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeDatasetsResult {
    pub dataset: Dataset,
    pub employee_count: i64,
    pub score_count: i64,
    pub rating_mapping_count: i64,
    pub source_dataset_ids: Vec<i64>,
}

#[tauri::command]
pub async fn merge_datasets(
    state: State<'_, AppState>,
    request: MergeDatasetsRequest,
) -> Result<MergeDatasetsResult, String> {
    let pool = state.pool.clone();

    let mut unique_ids: Vec<i64> = Vec::new();
    for id in request.source_dataset_ids.iter().copied() {
        if !unique_ids.contains(&id) {
            unique_ids.push(id);
        }
    }

    if unique_ids.len() < 2 {
        return Err("Select at least two datasets to merge".to_string());
    }

    let trimmed_name = request.target_name.trim();
    if trimmed_name.is_empty() {
        return Err("Target dataset name cannot be empty".to_string());
    }

    let target_description = request.target_description.as_ref().and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    for dataset_id in &unique_ids {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM datasets WHERE id = ?")
            .bind(dataset_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err(format!("Dataset {} not found", dataset_id));
        }
    }

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let dataset = sqlx::query_as::<_, Dataset>(
        "INSERT INTO datasets (name, description, source_file, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))
         RETURNING *",
    )
    .bind(trimmed_name)
    .bind(target_description.clone())
    .bind(Option::<String>::None)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    for source_id in &unique_ids {
        sqlx::query(
            "INSERT OR IGNORE INTO dataset_employees (dataset_id, employee_id, created_at, updated_at)
             SELECT ?, employee_id, created_at, datetime('now')
             FROM dataset_employees
             WHERE dataset_id = ?",
        )
        .bind(dataset.id)
        .bind(source_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT OR IGNORE INTO scores (employee_id, dataset_id, competency_id, raw_value, numeric_value, created_at)
             SELECT employee_id, ?, competency_id, raw_value, numeric_value, created_at
             FROM scores
             WHERE dataset_id = ?",
        )
        .bind(dataset.id)
        .bind(source_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT OR IGNORE INTO rating_mappings (dataset_id, text_value, numeric_value)
             SELECT ?, text_value, numeric_value
             FROM rating_mappings
             WHERE dataset_id = ?",
        )
        .bind(dataset.id)
        .bind(source_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    let employee_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM dataset_employees WHERE dataset_id = ?")
            .bind(dataset.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    let score_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scores WHERE dataset_id = ?")
        .bind(dataset.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let rating_mapping_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM rating_mappings WHERE dataset_id = ?")
            .bind(dataset.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(MergeDatasetsResult {
        dataset,
        employee_count,
        score_count,
        rating_mapping_count,
        source_dataset_ids: unique_ids,
    })
}
