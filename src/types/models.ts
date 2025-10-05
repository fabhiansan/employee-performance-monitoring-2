export interface Dataset {
  id: number;
  name: string;
  description: string | null;
  source_file: string | null;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: number;
  dataset_id: number;
  name: string;
  nip: string | null;
  gol: string | null;
  jabatan: string | null;
  sub_jabatan: string | null;
  created_at: string;
}

export interface Competency {
  id: number;
  name: string;
  description: string | null;
  display_order: number;
}

export interface Score {
  id: number;
  employee_id: number;
  competency_id: number;
  raw_value: string;
  numeric_value: number | null;
  created_at: string;
}

export interface RatingMapping {
  id: number;
  dataset_id: number;
  text_value: string;
  numeric_value: number;
}

export interface Summary {
  id: number;
  employee_id: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface GeneratedSummary {
  content: string;
}

export interface ValidationIssue {
  id: number;
  dataset_id: number;
  issue_type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  metadata: string | null;
  resolved: boolean;
  created_at: string;
}

// DTOs for creating new records
export interface CreateDataset {
  name: string;
  description?: string;
  source_file?: string;
}

export interface CreateEmployee {
  dataset_id: number;
  name: string;
  nip?: string;
  gol?: string;
  jabatan?: string;
  sub_jabatan?: string;
}

export interface CreateScore {
  employee_id: number;
  competency_id: number;
  raw_value: string;
  numeric_value?: number;
}

export interface CreateRatingMapping {
  dataset_id: number;
  text_value: string;
  numeric_value: number;
}

// Additional types for CSV import
export interface CSVPreview {
  headers: string[];
  rows: string[][];
  detected_delimiter: string;
  employee_count: number;
  encoding: string;
}

export interface FieldMapping {
  csv_column: string;
  db_field: string;
}

export interface ImportConfig {
  file_path: string;
  delimiter: string;
  has_header: boolean;
  field_mappings: FieldMapping[];
  rating_mappings: RatingMapping[];
}

// Import types
export interface ParsedEmployee {
  name: string;
  nip: string | null;
  gol: string | null;
  jabatan: string | null;
  sub_jabatan: string | null;
}

export interface ParsedScore {
  employee_name: string;
  competency: string;
  value: string;
}

export interface ImportRequest {
  dataset_name: string;
  dataset_description: string | null;
  source_file: string;
  employees: ParsedEmployee[];
  scores: ParsedScore[];
  rating_mappings: CreateRatingMapping[];
}

export interface ImportResult {
  dataset: Dataset;
  employee_count: number;
  competency_count: number;
  score_count: number;
}

// Analytics types
export interface ScoreDistribution {
  range: string;
  count: number;
}

export interface CompetencyStats {
  competency: Competency;
  average_score: number;
  employee_count: number;
}

export interface DatasetStats {
  dataset: Dataset;
  total_employees: number;
  total_competencies: number;
  total_scores: number;
  average_score: number;
  score_distribution: ScoreDistribution[];
  competency_stats: CompetencyStats[];
}

export interface CompetencyDelta {
  competency: Competency;
  base_average: number;
  comparison_average: number;
  delta: number;
}

export interface DatasetComparison {
  base: DatasetStats;
  comparison: DatasetStats;
  competency_deltas: CompetencyDelta[];
  average_delta: number;
}

export interface EmployeeWithStats {
  id: number;
  dataset_id: number;
  name: string;
  nip: string | null;
  gol: string | null;
  jabatan: string | null;
  sub_jabatan: string | null;
  created_at: string;
  average_score: number;
  score_count: number;
}

export interface EmployeeListResult {
  employees: EmployeeWithStats[];
  total_count: number;
}

export interface ScoreWithCompetency {
  score: Score;
  competency: Competency;
}

export interface EmployeePerformance {
  employee: Employee;
  scores: ScoreWithCompetency[];
  average_score: number;
  strengths: string[];
  gaps: string[];
}

export interface ImportValidationPayload {
  employees: ParsedEmployee[];
  scores: ParsedScore[];
  rating_mappings: CreateRatingMapping[];
}

export interface DuplicateEmployeeGroup {
  name: string;
  employee_indices: number[];
}

export interface OrphanScoreIssue {
  score_index: number;
  employee_name: string;
  competency: string;
}

export interface UnmappedRatingIssue {
  value: string;
  occurrences: number;
}

export interface BlankEmployeeNameIssue {
  employee_index: number;
}

export interface ValidationStats {
  error_count: number;
  warning_count: number;
  total_issues: number;
  can_import: boolean;
}

export interface ImportValidationSummary {
  stats: ValidationStats;
  duplicate_employees: DuplicateEmployeeGroup[];
  orphan_scores: OrphanScoreIssue[];
  unmapped_ratings: UnmappedRatingIssue[];
  blank_employee_names: BlankEmployeeNameIssue[];
}
