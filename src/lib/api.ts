import type {
  Dataset,
  CreateDataset,
  CSVPreview,
  ParsedEmployee,
  ParsedScore,
  ImportRequest,
  ImportResult,
  CreateRatingMapping,
  DatasetStats,
  EmployeeListResult,
  EmployeePerformance,
  ImportValidationPayload,
  ImportValidationSummary,
  Summary,
  GeneratedSummary,
  DatasetComparison,
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

// Import Commands
export async function importDataset(request: ImportRequest): Promise<ImportResult> {
  if (isTauri()) {
    return invoke('import_dataset', { request });
  }
  return browserStorage.importDataset(request);
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
  offset?: number
): Promise<EmployeeListResult> {
  if (isTauri()) {
    return invoke('list_employees', { datasetId, search, limit, offset });
  }
  return browserStorage.listEmployees(datasetId, search, limit, offset);
}

export async function getEmployeePerformance(employeeId: number): Promise<EmployeePerformance> {
  if (isTauri()) {
    return invoke('get_employee_performance', { employeeId });
  }
  return browserStorage.getEmployeePerformance(employeeId);
}

export async function validateImportData(
  payload: ImportValidationPayload
): Promise<ImportValidationSummary> {
  if (isTauri()) {
    return invoke('validate_import_data', { payload });
  }
  return browserStorage.validateImportData(payload);
}

export async function generateEmployeeSummary(employeeId: number): Promise<GeneratedSummary> {
  if (isTauri()) {
    return invoke('generate_employee_summary', { employeeId });
  }
  return browserStorage.generateEmployeeSummary(employeeId);
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

export async function exportEmployeeSummary(employeeId: number, filePath: string): Promise<void> {
  if (isTauri()) {
    return invoke('export_employee_summary_pdf', { employeeId, filePath });
  }
  throw new Error('Export summary is only available in the desktop application.');
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
