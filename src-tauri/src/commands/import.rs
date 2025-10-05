use crate::csv_parser::{ParsedEmployee, ParsedScore};
use crate::db::models::{Competency, CreateRatingMapping, Dataset, Employee};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ImportRequest {
    pub dataset_name: String,
    pub dataset_description: Option<String>,
    pub source_file: String,
    pub employees: Vec<ParsedEmployee>,
    pub scores: Vec<ParsedScore>,
    pub rating_mappings: Vec<CreateRatingMapping>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ImportResult {
    pub dataset: Dataset,
    pub employee_count: usize,
    pub competency_count: usize,
    pub score_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportValidationPayload {
    pub employees: Vec<ParsedEmployee>,
    pub scores: Vec<ParsedScore>,
    pub rating_mappings: Vec<CreateRatingMapping>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DuplicateEmployeeGroup {
    pub name: String,
    pub employee_indices: Vec<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OrphanScoreIssue {
    pub score_index: usize,
    pub employee_name: String,
    pub competency: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnmappedRatingIssue {
    pub value: String,
    pub occurrences: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlankEmployeeNameIssue {
    pub employee_index: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationStats {
    pub error_count: usize,
    pub warning_count: usize,
    pub total_issues: usize,
    pub can_import: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportValidationSummary {
    pub stats: ValidationStats,
    pub duplicate_employees: Vec<DuplicateEmployeeGroup>,
    pub orphan_scores: Vec<OrphanScoreIssue>,
    pub unmapped_ratings: Vec<UnmappedRatingIssue>,
    pub blank_employee_names: Vec<BlankEmployeeNameIssue>,
}

fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn sanitize_optional(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
}

#[tauri::command]
pub async fn import_dataset(
    state: State<'_, AppState>,
    request: ImportRequest,
) -> Result<ImportResult, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;

    // Start transaction
    let mut tx = db.pool.begin().await.map_err(|e| e.to_string())?;

    // 1. Create dataset
    let dataset = sqlx::query_as::<_, Dataset>(
        r#"
        INSERT INTO datasets (name, description, source_file, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *
        "#,
    )
    .bind(&request.dataset_name)
    .bind(&request.dataset_description)
    .bind(&request.source_file)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create dataset: {}", e))?;

    // 2. Insert rating mappings for this dataset
    let mut rating_map: HashMap<String, f64> = HashMap::new();
    for mapping in &request.rating_mappings {
        sqlx::query(
            r#"
            INSERT INTO rating_mappings (dataset_id, text_value, numeric_value)
            VALUES (?, ?, ?)
            ON CONFLICT(dataset_id, text_value) DO UPDATE SET numeric_value = excluded.numeric_value
            "#,
        )
        .bind(dataset.id)
        .bind(&mapping.text_value)
        .bind(mapping.numeric_value)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert rating mapping: {}", e))?;

        rating_map.insert(mapping.text_value.clone(), mapping.numeric_value);
    }

    // 3. Ensure employees exist as master data and associate with dataset
    let mut employee_lookup: HashMap<String, i64> = HashMap::new();
    let mut unique_employee_ids: HashSet<i64> = HashSet::new();

    for emp in &request.employees {
        let normalized = normalize_name(&emp.name);
        if normalized.is_empty() {
            return Err("Employee name cannot be blank".to_string());
        }

        let display_name = emp.name.trim().to_string();
        let nip = sanitize_optional(&emp.nip);
        let gol = sanitize_optional(&emp.gol);
        let jabatan = sanitize_optional(&emp.jabatan);
        let sub_jabatan = sanitize_optional(&emp.sub_jabatan);

        let employee_id = if let Some(&existing_id) = employee_lookup.get(&normalized) {
            sqlx::query(
                r#"
                UPDATE employees
                SET name = ?,
                    nip = COALESCE(?, nip),
                    gol = COALESCE(?, gol),
                    jabatan = COALESCE(?, jabatan),
                    sub_jabatan = COALESCE(?, sub_jabatan),
                    updated_at = datetime('now')
                WHERE id = ?
                "#,
            )
            .bind(&display_name)
            .bind(&nip)
            .bind(&gol)
            .bind(&jabatan)
            .bind(&sub_jabatan)
            .bind(existing_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update employee {}: {}", display_name, e))?;

            existing_id
        } else {
            let existing = sqlx::query_as::<_, Employee>(
                r#"
                SELECT * FROM employees WHERE lower(name) = ? LIMIT 1
                "#,
            )
            .bind(&normalized)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("Failed to lookup employee {}: {}", display_name, e))?;

            if let Some(employee) = existing {
                sqlx::query(
                    r#"
                    UPDATE employees
                    SET name = ?,
                        nip = COALESCE(?, nip),
                        gol = COALESCE(?, gol),
                        jabatan = COALESCE(?, jabatan),
                        sub_jabatan = COALESCE(?, sub_jabatan),
                        updated_at = datetime('now')
                    WHERE id = ?
                    "#,
                )
                .bind(&display_name)
                .bind(&nip)
                .bind(&gol)
                .bind(&jabatan)
                .bind(&sub_jabatan)
                .bind(employee.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed to update employee {}: {}", display_name, e))?;

                employee.id
            } else {
                let employee = sqlx::query_as::<_, Employee>(
                    r#"
                    INSERT INTO employees (name, nip, gol, jabatan, sub_jabatan, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                    RETURNING *
                    "#,
                )
                .bind(&display_name)
                .bind(&nip)
                .bind(&gol)
                .bind(&jabatan)
                .bind(&sub_jabatan)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| format!("Failed to create employee {}: {}", display_name, e))?;

                employee.id
            }
        };

        employee_lookup.insert(normalized.clone(), employee_id);
        unique_employee_ids.insert(employee_id);

        sqlx::query(
            r#"
            INSERT INTO dataset_employees (dataset_id, employee_id, created_at, updated_at)
            VALUES (?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(dataset_id, employee_id)
            DO UPDATE SET updated_at = datetime('now')
            "#,
        )
        .bind(dataset.id)
        .bind(employee_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to link employee {}: {}", display_name, e))?;

        // Ensure name variations map to the same employee
        employee_lookup.insert(display_name.to_lowercase(), employee_id);
    }

    // 4. Extract unique competencies from scores and insert them
    let mut competency_names: Vec<String> = request
        .scores
        .iter()
        .map(|s| s.competency.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    competency_names.sort();

    let mut competency_map: HashMap<String, i64> = HashMap::new();
    for (idx, comp_name) in competency_names.iter().enumerate() {
        // Try to get existing competency first
        let competency =
            match sqlx::query_as::<_, Competency>("SELECT * FROM competencies WHERE name = ?")
                .bind(comp_name)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| format!("Failed to fetch competency: {}", e))?
            {
                Some(comp) => comp,
                None => {
                    // Insert new competency
                    sqlx::query_as::<_, Competency>(
                        r#"
                    INSERT INTO competencies (name, display_order)
                    VALUES (?, ?)
                    RETURNING *
                    "#,
                    )
                    .bind(comp_name)
                    .bind(idx as i32)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(|e| format!("Failed to insert competency {}: {}", comp_name, e))?
                }
            };

        competency_map.insert(comp_name.clone(), competency.id);
    }

    // 5. Insert scores
    let mut score_count = 0;
    for score in &request.scores {
        let normalized = normalize_name(&score.employee_name);
        let employee_id = employee_lookup
            .get(&normalized)
            .or_else(|| employee_lookup.get(&score.employee_name.to_lowercase()))
            .ok_or_else(|| format!("Employee not found: {}", score.employee_name))?;

        let competency_id = competency_map
            .get(&score.competency)
            .ok_or_else(|| format!("Competency not found: {}", score.competency))?;

        // Apply rating mapping if available
        let numeric_value = rating_map.get(&score.value).copied();

        sqlx::query(
            r#"
            INSERT INTO scores (employee_id, dataset_id, competency_id, raw_value, numeric_value, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(dataset_id, employee_id, competency_id) DO UPDATE
            SET raw_value = excluded.raw_value,
                numeric_value = excluded.numeric_value
            "#,
        )
        .bind(employee_id)
        .bind(dataset.id)
        .bind(competency_id)
        .bind(&score.value)
        .bind(numeric_value)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert score: {}", e))?;

        score_count += 1;
    }

    // Commit transaction
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(ImportResult {
        dataset,
        employee_count: unique_employee_ids.len(),
        competency_count: competency_map.len(),
        score_count,
    })
}

#[tauri::command]
pub async fn get_default_rating_mappings() -> Result<Vec<CreateRatingMapping>, String> {
    Ok(vec![
        CreateRatingMapping {
            dataset_id: 0, // Will be replaced when actually used
            text_value: "Sangat Baik".to_string(),
            numeric_value: 85.0,
        },
        CreateRatingMapping {
            dataset_id: 0,
            text_value: "Baik".to_string(),
            numeric_value: 75.0,
        },
        CreateRatingMapping {
            dataset_id: 0,
            text_value: "Kurang Baik".to_string(),
            numeric_value: 65.0,
        },
    ])
}

#[tauri::command]
pub async fn validate_import_data(
    payload: ImportValidationPayload,
) -> Result<ImportValidationSummary, String> {
    let mut duplicate_employees: Vec<DuplicateEmployeeGroup> = Vec::new();
    let mut orphan_scores: Vec<OrphanScoreIssue> = Vec::new();
    let mut unmapped_ratings: Vec<UnmappedRatingIssue> = Vec::new();
    let mut blank_employee_names: Vec<BlankEmployeeNameIssue> = Vec::new();

    let mut name_map: HashMap<String, Vec<usize>> = HashMap::new();
    let mut canonical_names: HashSet<String> = HashSet::new();

    for (idx, employee) in payload.employees.iter().enumerate() {
        let trimmed = employee.name.trim();
        if trimmed.is_empty() {
            blank_employee_names.push(BlankEmployeeNameIssue {
                employee_index: idx,
            });
            continue;
        }

        let key = trimmed.to_lowercase();
        canonical_names.insert(key.clone());
        name_map.entry(key).or_default().push(idx);
    }

    for indices in name_map.values() {
        if indices.len() > 1 {
            let first_index = *indices
                .first()
                .expect("duplicate indices should have at least one entry");
            let display_name = payload.employees[first_index].name.clone();
            duplicate_employees.push(DuplicateEmployeeGroup {
                name: display_name,
                employee_indices: indices.clone(),
            });
        }
    }

    let rating_map: HashMap<String, f64> = payload
        .rating_mappings
        .iter()
        .map(|mapping| {
            (
                mapping.text_value.trim().to_lowercase(),
                mapping.numeric_value,
            )
        })
        .collect();

    let mut unmapped_counts: HashMap<String, usize> = HashMap::new();

    for (idx, score) in payload.scores.iter().enumerate() {
        let employee_key = score.employee_name.trim().to_lowercase();
        if employee_key.is_empty() || !canonical_names.contains(&employee_key) {
            orphan_scores.push(OrphanScoreIssue {
                score_index: idx,
                employee_name: score.employee_name.clone(),
                competency: score.competency.clone(),
            });
        }

        let value_key = score.value.trim().to_lowercase();
        if !value_key.is_empty() && !rating_map.contains_key(&value_key) {
            *unmapped_counts.entry(score.value.clone()).or_insert(0) += 1;
        }
    }

    for (value, occurrences) in unmapped_counts {
        unmapped_ratings.push(UnmappedRatingIssue { value, occurrences });
    }

    let error_count = duplicate_employees.len()
        + orphan_scores.len()
        + unmapped_ratings.len()
        + blank_employee_names.len();

    let validation_stats = ValidationStats {
        error_count,
        warning_count: 0,
        total_issues: error_count,
        can_import: error_count == 0,
    };

    Ok(ImportValidationSummary {
        stats: validation_stats,
        duplicate_employees,
        orphan_scores,
        unmapped_ratings,
        blank_employee_names,
    })
}
