use crate::db::models::Employee;
use crate::AppState;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Sqlite, SqlitePool, Transaction};
use tauri::State;

#[tauri::command]
pub async fn list_all_employees(state: State<'_, AppState>) -> Result<Vec<Employee>, String> {
    let pool = state.pool.clone();

    sqlx::query_as::<_, Employee>("SELECT * FROM employees ORDER BY LOWER(name)")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to list employees: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEmployee {
    pub id: i64,
    pub name: Option<String>,
    pub nip: Option<Option<String>>, // Some(Some(v)) to set, Some(None) to null, None to ignore
    pub gol: Option<Option<String>>, // same semantics
    pub jabatan: Option<Option<String>>, // same semantics
    pub sub_jabatan: Option<Option<String>>, // same semantics
}

async fn delete_employees_tx(tx: &mut Transaction<'_, Sqlite>, ids: &[i64]) -> Result<u64, String> {
    if ids.is_empty() {
        return Ok(0);
    }

    // Delete dependent rows first to maintain referential integrity
    let mut qb = QueryBuilder::<Sqlite>::new("DELETE FROM scores WHERE employee_id IN (");
    {
        let mut sep = qb.separated(", ");
        for id in ids {
            sep.push_bind(id);
        }
    }
    qb.push(")");
    qb.build()
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Failed to delete scores: {}", e))?;

    let mut qb =
        QueryBuilder::<Sqlite>::new("DELETE FROM dataset_employees WHERE employee_id IN (");
    {
        let mut sep = qb.separated(", ");
        for id in ids {
            sep.push_bind(id);
        }
    }
    qb.push(")");
    qb.build()
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Failed to delete dataset mappings: {}", e))?;

    let mut qb = QueryBuilder::<Sqlite>::new("DELETE FROM summaries WHERE employee_id IN (");
    {
        let mut sep = qb.separated(", ");
        for id in ids {
            sep.push_bind(id);
        }
    }
    qb.push(")");
    qb.build()
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Failed to delete summaries: {}", e))?;

    let mut qb = QueryBuilder::<Sqlite>::new("DELETE FROM employees WHERE id IN (");
    {
        let mut sep = qb.separated(", ");
        for id in ids {
            sep.push_bind(id);
        }
    }
    qb.push(")");
    let result = qb
        .build()
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Failed to delete employees: {}", e))?;

    Ok(result.rows_affected())
}

#[tauri::command]
pub async fn bulk_delete_employees(
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<u64, String> {
    let pool: SqlitePool = state.pool.clone();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    let affected = delete_employees_tx(&mut tx, &ids).await?;
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    Ok(affected)
}

#[tauri::command]
pub async fn bulk_update_employees(
    state: State<'_, AppState>,
    updates: Vec<UpdateEmployee>,
) -> Result<u64, String> {
    if updates.is_empty() {
        return Ok(0);
    }

    let pool: SqlitePool = state.pool.clone();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    let mut total_updated: u64 = 0;
    for u in updates {
        // Build dynamic update based on provided fields
        let mut qb = QueryBuilder::<Sqlite>::new("UPDATE employees SET ");
        let mut first = true;

        if let Some(name) = u.name {
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("name = ").push_bind(name);
        }
        if let Some(nip) = u.nip {
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("nip = ").push_bind(nip);
        }
        if let Some(gol) = u.gol {
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("gol = ").push_bind(gol);
        }
        if let Some(jabatan) = u.jabatan {
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("jabatan = ").push_bind(jabatan);
        }
        if let Some(sub_jabatan) = u.sub_jabatan {
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("sub_jabatan = ").push_bind(sub_jabatan);
        }

        if first {
            // nothing to update for this record
            continue;
        }

        qb.push(", updated_at = datetime('now') WHERE id = ")
            .push_bind(u.id);
        let res = qb
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update employee {}: {}", u.id, e))?;
        total_updated += res.rows_affected();
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    Ok(total_updated)
}
