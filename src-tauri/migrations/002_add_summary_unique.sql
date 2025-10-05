-- Ensure each employee has at most one summary record
CREATE UNIQUE INDEX IF NOT EXISTS idx_summaries_employee ON summaries(employee_id);
