-- Restructure employees into master data and capture dataset associations
PRAGMA foreign_keys = OFF;

-- Preserve existing employees as employees_old for migration
ALTER TABLE employees RENAME TO employees_old;

-- Create new employees table without dataset_id and with update tracking
CREATE TABLE employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nip TEXT,
    gol TEXT,
    jabatan TEXT,
    sub_jabatan TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy data from legacy employees table
INSERT INTO employees (id, name, nip, gol, jabatan, sub_jabatan, created_at, updated_at)
SELECT id, name, nip, gol, jabatan, sub_jabatan, created_at, datetime('now')
FROM employees_old;

-- Create dataset_employees bridge table
CREATE TABLE dataset_employees (
    dataset_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (dataset_id, employee_id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Populate dataset associations using legacy dataset_id
INSERT INTO dataset_employees (dataset_id, employee_id, created_at, updated_at)
SELECT dataset_id, id, created_at, datetime('now')
FROM employees_old;

-- Rebuild scores table with explicit dataset_id linkage
ALTER TABLE scores RENAME TO scores_old;

CREATE TABLE scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    dataset_id INTEGER NOT NULL,
    competency_id INTEGER NOT NULL,
    raw_value TEXT NOT NULL,
    numeric_value REAL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE,
    FOREIGN KEY (competency_id) REFERENCES competencies(id) ON DELETE CASCADE,
    UNIQUE (dataset_id, employee_id, competency_id)
);

INSERT INTO scores (id, employee_id, dataset_id, competency_id, raw_value, numeric_value, created_at)
SELECT s.id, s.employee_id, eo.dataset_id, s.competency_id, s.raw_value, s.numeric_value, s.created_at
FROM scores_old s
JOIN employees_old eo ON eo.id = s.employee_id;

DROP TABLE scores_old;

-- Refresh summaries to track updated_at automatically (maintain data)
UPDATE summaries
SET updated_at = datetime('now')
WHERE updated_at IS NULL;

-- Drop legacy employees table
DROP TABLE employees_old;

-- Restore indexes
CREATE INDEX idx_employees_name ON employees(name);
CREATE INDEX idx_dataset_employees_dataset ON dataset_employees(dataset_id);
CREATE INDEX idx_dataset_employees_employee ON dataset_employees(employee_id);
CREATE INDEX idx_scores_employee ON scores(employee_id);
CREATE INDEX idx_scores_dataset ON scores(dataset_id);
CREATE INDEX idx_scores_competency ON scores(competency_id);

PRAGMA foreign_keys = ON;
