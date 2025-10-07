import type {
  Dataset,
  CreateDataset,
  CSVPreview,
  ParsedEmployee,
  ParsedScore,
  ImportResult,
  CreateRatingMapping,
  Employee,
  DatasetStats,
  EmployeeListResult,
  EmployeePerformance,
  ImportValidationPayload,
  ImportValidationSummary,
  Summary,
  GeneratedSummary,
  DatasetComparison,
  UpdateDatasetRequest,
  MergeDatasetsRequest,
  MergeDatasetsResult,
  EmployeeImportRequest,
  EmployeeImportResult,
  PerformanceImportRequest,
  PerformanceAppendRequest,
  UpdateEmployee,
  DatasetEmployeeAppendResult,
  SortState,
} from '@/types/models';
import { BrowserCSVParser } from './csv-parser';
import { browserStorage } from './browser-storage';

// Check for Tauri context (v2 uses __TAURI_INTERNALS__)
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// CSV Commands
export async function previewCSV(filePathOrFile: string | File, maxRows: number = 10): Promise<CSVPreview> {
  if (isTauri() && typeof filePathOrFile === 'string') {
    return invoke('preview_csv', { filePath: filePathOrFile, maxRows });
  } else if (filePathOrFile instanceof File) {
    return BrowserCSVParser.preview(filePathOrFile, maxRows);
  }
  throw new Error('Invalid file input');
}

export async function parseEmployeeCSV(filePathOrFile: string | File): Promise<ParsedEmployee[]> {
  if (isTauri() && typeof filePathOrFile === 'string') {
    return invoke('parse_employee_csv', { filePath: filePathOrFile });
  } else if (filePathOrFile instanceof File) {
    return BrowserCSVParser.parseEmployeeCSV(filePathOrFile);
  }
  throw new Error('Invalid file input');
}

export async function parseScoresCSV(filePathOrFile: string | File): Promise<ParsedScore[]> {
  if (isTauri() && typeof filePathOrFile === 'string') {
    return invoke('parse_scores_csv', { filePath: filePathOrFile });
  } else if (filePathOrFile instanceof File) {
    return BrowserCSVParser.parseScoresCSV(filePathOrFile);
  }
  throw new Error('Invalid file input');
}

// Dataset Commands
export async function createDataset(dataset: CreateDataset): Promise<Dataset> {
  if (isTauri()) {
    return invoke('create_dataset', { dataset });
  }
  return browserStorage.createDataset(dataset);
}

export async function listDatasets(): Promise<Dataset[]> {
  if (isTauri()) {
    return invoke('list_datasets');
  }
  return browserStorage.listDatasets();
}

export async function listAllEmployees(): Promise<Employee[]> {
  if (isTauri()) {
    return invoke('list_all_employees');
  }
  return browserStorage.listAllEmployees();
}

export async function bulkDeleteEmployees(ids: number[]): Promise<number> {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  if (isTauri()) {
    return invoke('bulk_delete_employees', { ids });
  }
  // Browser fallback not implemented
  return 0;
}

export async function bulkUpdateEmployees(updates: UpdateEmployee[]): Promise<number> {
  if (!Array.isArray(updates) || updates.length === 0) return 0;
  if (isTauri()) {
    return invoke('bulk_update_employees', { updates });
  }
  // Browser fallback not implemented
  return 0;
}

export async function appendDatasetEmployees(
  datasetId: number,
  employees: ParsedEmployee[]
): Promise<DatasetEmployeeAppendResult> {
  if (!Number.isFinite(datasetId)) {
    throw new Error('A valid dataset is required');
  }

  const sanitizeOptional = (value: string | null | undefined): string | null => {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const unique = new Map<string, ParsedEmployee>();
  for (const employee of employees) {
    const trimmed = employee.name.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const sanitized: ParsedEmployee = {
      name: trimmed,
      nip: sanitizeOptional(employee.nip),
      gol: sanitizeOptional(employee.gol),
      jabatan: sanitizeOptional(employee.jabatan),
      sub_jabatan: sanitizeOptional(employee.sub_jabatan),
    };

    const existing = unique.get(normalized);
    if (existing) {
      if (!existing.nip && sanitized.nip) existing.nip = sanitized.nip;
      if (!existing.gol && sanitized.gol) existing.gol = sanitized.gol;
      if (!existing.jabatan && sanitized.jabatan) existing.jabatan = sanitized.jabatan;
      if (!existing.sub_jabatan && sanitized.sub_jabatan) {
        existing.sub_jabatan = sanitized.sub_jabatan;
      }
    } else {
      unique.set(normalized, sanitized);
    }
  }

  if (unique.size === 0) {
    throw new Error('Provide at least one employee to append');
  }

  const payload = Array.from(unique.values());

  if (isTauri()) {
    return invoke('append_dataset_employees', {
      request: {
        dataset_id: datasetId,
        employees: payload,
      },
    });
  }

  return browserStorage.appendDatasetEmployees(datasetId, payload);
}

export async function getDataset(id: number): Promise<Dataset> {
  if (isTauri()) {
    return invoke('get_dataset', { id });
  }
  return browserStorage.getDataset(id);
}

export async function deleteDataset(id: number): Promise<void> {
  if (isTauri()) {
    return invoke('delete_dataset', { id });
  }
  return browserStorage.deleteDataset(id);
}

export async function updateDataset(id: number, payload: UpdateDatasetRequest): Promise<Dataset> {
  const name = payload.name.trim();
  if (!name) {
    throw new Error('Dataset name is required');
  }

  const description = payload.description === undefined
    ? undefined
    : payload.description === null
      ? null
      : payload.description.trim().length === 0
        ? null
        : payload.description.trim();

  if (isTauri()) {
    return invoke('update_dataset', {
      id,
      name,
      description: description ?? null,
    });
  }

  return browserStorage.updateDataset(id, {
    name,
    description: description ?? null,
  });
}

// Import Commands
export async function importEmployees(request: EmployeeImportRequest): Promise<EmployeeImportResult> {
  const sanitizedEmployees: ParsedEmployee[] = request.employees.map((employee) => ({
    name: employee.name.trim(),
    nip: employee.nip ? (employee.nip.trim() || null) : null,
    gol: employee.gol ? (employee.gol.trim() || null) : null,
    jabatan: employee.jabatan ? (employee.jabatan.trim() || null) : null,
    sub_jabatan: employee.sub_jabatan ? (employee.sub_jabatan.trim() || null) : null,
  }));

  if (sanitizedEmployees.some((employee) => employee.name.length === 0)) {
    throw new Error('Employee name cannot be blank');
  }

  const sanitized: EmployeeImportRequest = {
    employees: sanitizedEmployees,
  };

  if (isTauri()) {
    return invoke('import_employees', { request: sanitized });
  }
  return browserStorage.importEmployees(sanitized);
}

export async function importPerformanceDataset(
  request: PerformanceImportRequest,
): Promise<ImportResult> {
  const datasetName = request.dataset_name.trim();
  if (!datasetName) {
    throw new Error('Dataset name is required');
  }

  const description = request.dataset_description === null
    ? null
    : request.dataset_description?.trim().length
      ? request.dataset_description.trim()
      : null;

  const sanitizedScores: ParsedScore[] = request.scores.map((score) => ({
    employee_name: score.employee_name.trim(),
    competency: score.competency.trim(),
    value: score.value.trim(),
  }));

  if (sanitizedScores.some((score) => score.employee_name.length === 0)) {
    throw new Error('All scores must reference a valid employee');
  }

  const sanitizedMappings: CreateRatingMapping[] = request.rating_mappings.map((mapping) => ({
    ...mapping,
    text_value: mapping.text_value.trim(),
    numeric_value: Number(mapping.numeric_value),
  }));

  const payload: PerformanceImportRequest = {
    dataset_name: datasetName,
    dataset_description: description,
    source_file: request.source_file,
    employee_names: request.employee_names.map((name) => name.trim()).filter((name) => name.length > 0),
    scores: sanitizedScores,
    rating_mappings: sanitizedMappings,
  };

  if (isTauri()) {
    return invoke('import_performance_dataset', { request: payload });
  }
  return browserStorage.importPerformanceDataset(payload);
}

export async function importPerformanceIntoDataset(
  request: PerformanceAppendRequest,
): Promise<ImportResult> {
  const sanitizedScores: ParsedScore[] = request.scores.map((score) => ({
    employee_name: score.employee_name.trim(),
    competency: score.competency.trim(),
    value: score.value.trim(),
  }));

  const sanitizedMappings: CreateRatingMapping[] = request.rating_mappings.map((mapping) => ({
    ...mapping,
    text_value: mapping.text_value.trim(),
    numeric_value: Number(mapping.numeric_value),
  }));

  const payload: PerformanceAppendRequest = {
    dataset_id: request.dataset_id,
    employee_names: request.employee_names.map((n) => n.trim()).filter(Boolean),
    scores: sanitizedScores,
    rating_mappings: sanitizedMappings,
  };

  if (isTauri()) {
    return invoke('import_performance_into_dataset', { request: payload });
  }
  // Browser fallback is not implemented for appending into existing dataset
  throw new Error('Appending into existing dataset is only available in the desktop application.');
}

export async function getDefaultRatingMappings(): Promise<CreateRatingMapping[]> {
  if (isTauri()) {
    return invoke('get_default_rating_mappings');
  }
  return browserStorage.getDefaultRatingMappings();
}

// Analytics Commands
export async function getDatasetStats(datasetId: number): Promise<DatasetStats> {
  if (isTauri()) {
    return invoke('get_dataset_stats', { datasetId });
  }
  return browserStorage.getDatasetStats(datasetId);
}

export async function listEmployees(
  datasetId: number,
  search?: string,
  limit?: number,
  offset?: number,
  sort?: SortState,
): Promise<EmployeeListResult> {
  if (isTauri()) {
    return invoke('list_employees', {
      datasetId,
      search,
      limit,
      offset,
      sortBy: sort?.column,
      sortDirection: sort?.direction,
    });
  }
  return browserStorage.listEmployees(datasetId, search, limit, offset, sort);
}

export async function getEmployeePerformance(
  datasetId: number,
  employeeId: number
): Promise<EmployeePerformance> {
  if (isTauri()) {
    return invoke('get_employee_performance', { datasetId, employeeId });
  }
  return browserStorage.getEmployeePerformance(datasetId, employeeId);
}

export async function validateImportData(
  payload: ImportValidationPayload
): Promise<ImportValidationSummary> {
  if (isTauri()) {
    return invoke('validate_import_data', { payload });
  }
  return browserStorage.validateImportData(payload);
}

export async function generateEmployeeSummary(
  datasetId: number,
  employeeId: number
): Promise<GeneratedSummary> {
  if (isTauri()) {
    return invoke('generate_employee_summary', { datasetId, employeeId });
  }
  return browserStorage.generateEmployeeSummary(datasetId, employeeId);
}

export async function getEmployeeSummary(employeeId: number): Promise<Summary | null> {
  if (isTauri()) {
    return invoke('get_employee_summary', { employeeId });
  }
  return browserStorage.getEmployeeSummary(employeeId);
}

export async function saveEmployeeSummary(employeeId: number, content: string): Promise<Summary> {
  if (isTauri()) {
    return invoke('save_employee_summary', { employeeId, content });
  }
  return browserStorage.saveEmployeeSummary(employeeId, content);
}

export async function exportEmployeeSummary(
  datasetId: number,
  employeeId: number,
  filePath: string
): Promise<void> {
  if (isTauri()) {
    return invoke('export_employee_summary_pdf', { datasetId, employeeId, filePath });
  }
  throw new Error('Export summary is only available in the desktop application.');
}

export async function exportEmployeeReport(
  datasetId: number,
  employeeId: number,
  filePath: string
): Promise<void> {
  if (isTauri()) {
    return invoke('export_employee_report_pdf', { datasetId, employeeId, filePath });
  }
  throw new Error('Employee report export is only available in the desktop application.');
}

export async function exportDataset(
  datasetId: number,
  format: 'csv' | 'xlsx' | 'pdf',
  filePath: string
): Promise<void> {
  if (isTauri()) {
    return invoke('export_dataset', { datasetId, format, filePath });
  }
  throw new Error('Dataset export is only available in the desktop application.');
}

export async function compareDatasets(
  baseDatasetId: number,
  comparisonDatasetId: number
): Promise<DatasetComparison> {
  if (isTauri()) {
    return invoke('compare_datasets', { baseDatasetId, comparisonDatasetId });
  }
  return browserStorage.compareDatasets(baseDatasetId, comparisonDatasetId);
}

export async function mergeDatasets(request: MergeDatasetsRequest): Promise<MergeDatasetsResult> {
  const uniqueIds = request.source_dataset_ids.filter((id, index, array) => array.indexOf(id) === index);
  if (uniqueIds.length < 2) {
    throw new Error('Select at least two datasets to merge');
  }

  const targetName = request.target_name.trim();
  if (!targetName) {
    throw new Error('Target dataset name is required');
  }

  const description = request.target_description
    ? request.target_description.trim().length === 0
      ? null
      : request.target_description.trim()
    : null;

  const payload: MergeDatasetsRequest = {
    source_dataset_ids: uniqueIds,
    target_name: targetName,
    target_description: description,
  };

  if (isTauri()) {
    return invoke('merge_datasets', { request: payload });
  }

  return browserStorage.mergeDatasets(payload);
}
