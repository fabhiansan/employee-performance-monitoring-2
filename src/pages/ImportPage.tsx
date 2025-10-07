import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileImport } from '@/components/FileImport';
import { RatingMappingConfig } from '@/components/RatingMappingConfig';
import type {
  CSVPreview,
  CreateRatingMapping,
  ImportResult,
  ParsedEmployee,
  ParsedScore,
  ImportValidationSummary,
  EmployeeImportResult,
  Employee,
} from '@/types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, CheckCircle, Database, Loader2 } from 'lucide-react';
import {
  parseEmployeeCSV,
  parseScoresCSV,
  importEmployees,
  importPerformanceDataset,
  importPerformanceIntoDataset,
  validateImportData,
  listAllEmployees,
} from '@/lib/api';
import { useDatasets } from '@/lib/dataset-context';

type ImportStep =
  | 'landing'
  | 'employee-select'
  | 'employee-preview'
  | 'employee-importing'
  | 'employee-complete'
  | 'performance-select'
  | 'performance-preview'
  | 'performance-map'
  | 'performance-rating'
  | 'performance-validation'
  | 'performance-importing'
  | 'performance-complete';

interface EmployeeMappingEntry {
  originalName: string;
  normalized: string;
  selectedEmployeeId: number | null;
  newEmployee: ParsedEmployee | null;
  autoMatched: boolean;
}

const getErrorMessage = (error: unknown, fallback: string): string => (
  error instanceof Error ? error.message : fallback
);

const normalizeName = (value: string): string => value.trim().toLowerCase();

const sanitizeOptional = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const sanitizeParsedEmployee = (employee: ParsedEmployee): ParsedEmployee => ({
  name: employee.name.trim(),
  nip: sanitizeOptional(employee.nip),
  gol: sanitizeOptional(employee.gol),
  jabatan: sanitizeOptional(employee.jabatan),
  sub_jabatan: sanitizeOptional(employee.sub_jabatan),
});

const toParsedEmployee = (employee: Employee): ParsedEmployee => ({
  name: employee.name,
  nip: employee.nip ?? null,
  gol: employee.gol ?? null,
  jabatan: employee.jabatan ?? null,
  sub_jabatan: employee.sub_jabatan ?? null,
});

export function ImportPage() {
  const navigate = useNavigate();
  const { refreshDatasets, selectDataset, datasets, selectedDatasetId } = useDatasets();

  const [step, setStep] = useState<ImportStep>('landing');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Employee master import state
  const [employeeFile, setEmployeeFile] = useState<File | string | null>(null);
  const [employeeFileKey, setEmployeeFileKey] = useState(0);
  const [employeePreview, setEmployeePreview] = useState<CSVPreview | null>(null);
  const [employeeImportSummary, setEmployeeImportSummary] = useState<EmployeeImportResult | null>(null);

  // Performance import state
  const [performanceFile, setPerformanceFile] = useState<File | string | null>(null);
  const [performanceFileKey, setPerformanceFileKey] = useState(0);
  const [performancePreview, setPerformancePreview] = useState<CSVPreview | null>(null);
  const [scores, setScores] = useState<ParsedScore[]>([]);
  const [uniqueScoreValues, setUniqueScoreValues] = useState<string[]>([]);
  const [employeeMappings, setEmployeeMappings] = useState<EmployeeMappingEntry[]>([]);
  const [pendingNewEmployees, setPendingNewEmployees] = useState<ParsedEmployee[]>([]);
  const [existingEmployees, setExistingEmployees] = useState<Employee[]>([]);
  const [hasLoadedEmployees, setHasLoadedEmployees] = useState(false);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);

  // Shared validation/import state
  const [employees, setEmployees] = useState<ParsedEmployee[]>([]);
  const [ratingMappings, setRatingMappings] = useState<CreateRatingMapping[]>([]);
  const [validationSummary, setValidationSummary] = useState<ImportValidationSummary | null>(null);
  const [isValidationLoading, setIsValidationLoading] = useState(false);
  const [validationDirty, setValidationDirty] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [datasetName, setDatasetName] = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');
  const [sourceFilePath, setSourceFilePath] = useState('');
  const [employeeNamesForDataset, setEmployeeNamesForDataset] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<'new' | 'append'>('new');
  const [targetDatasetId, setTargetDatasetId] = useState<number | null>(selectedDatasetId ?? null);

  const loadMasterEmployees = async (force = false): Promise<Employee[]> => {
    if (hasLoadedEmployees && !force) {
      return existingEmployees;
    }
    try {
      setIsLoadingEmployees(true);
      const list = await listAllEmployees();
      setExistingEmployees(list);
      setHasLoadedEmployees(true);
      return list;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load employees'));
      return existingEmployees;
    } finally {
      setIsLoadingEmployees(false);
    }
  };

  const resetEmployeeFlow = () => {
    setEmployeeFile(null);
    setEmployeePreview(null);
    setEmployeeImportSummary(null);
    setProgress(0);
    setEmployeeFileKey((key) => key + 1);
  };

  const resetPerformanceFlow = () => {
    setPerformanceFile(null);
    setPerformancePreview(null);
    setScores([]);
    setUniqueScoreValues([]);
    setEmployeeMappings([]);
    setPendingNewEmployees([]);
    setEmployees([]);
    setRatingMappings([]);
    setValidationSummary(null);
    setValidationDirty(false);
    setImportResult(null);
    setDatasetName('');
    setDatasetDescription('');
    setSourceFilePath('');
    setEmployeeNamesForDataset([]);
    setProgress(0);
    setPerformanceFileKey((key) => key + 1);
  };

  const startEmployeeFlow = () => {
    resetPerformanceFlow();
    setError(null);
    setStep('employee-select');
  };

  const startPerformanceFlow = () => {
    resetEmployeeFlow();
    setError(null);
    setStep('performance-select');
  };

  const handleEmployeeFileSelected = (fileOrPath: string | File, preview: CSVPreview) => {
    setEmployeeFile(fileOrPath);
    setEmployeePreview(preview);
    setEmployeeImportSummary(null);
    setProgress(0);
    setError(null);
    setStep('employee-preview');
  };

  const handleImportEmployeesOnly = async () => {
    if (!employeeFile) return;

    try {
      setError(null);
      setProgress(10);
      setStep('employee-importing');

      const parsedEmployees = await parseEmployeeCSV(employeeFile);
      const sanitized = parsedEmployees.map(sanitizeParsedEmployee);
      setEmployees(sanitized);
      setProgress(45);

      const result = await importEmployees({ employees: sanitized });
      setEmployeeImportSummary(result);
      setProgress(100);
      setStep('employee-complete');
    } catch (err) {
      const message = getErrorMessage(err, 'Failed to import employees');
      setError(message);
      setStep('employee-preview');
    }
  };

  const handlePerformanceFileSelected = (fileOrPath: string | File, preview: CSVPreview) => {
    setPerformanceFile(fileOrPath);
    setPerformancePreview(preview);
    setError(null);

    const resolvedPath = fileOrPath instanceof File ? fileOrPath.name : fileOrPath;
    setSourceFilePath(resolvedPath);

    if (!datasetName) {
      const baseName = resolvedPath?.split(/[/\\]/).pop() ?? 'Performance Import';
      setDatasetName(baseName.replace(/\.[^.]+$/, '') || baseName);
    }
    if (!datasetDescription) {
      setDatasetDescription(`Imported from ${resolvedPath}`);
    }

    setStep('performance-preview');
  };

  const handlePerformancePreviewContinue = async () => {
    if (!performanceFile) return;

    try {
      setError(null);
      setProgress(10);

      const parsedScores = await parseScoresCSV(performanceFile);
      setScores(parsedScores);
      setProgress(30);

      const uniqueValues = Array.from(new Set(parsedScores.map((score) => score.value)));
      setUniqueScoreValues(uniqueValues);

      const employeesList = await loadMasterEmployees();

      const uniqueEmployeeNames = Array.from(
        new Set(
          parsedScores
            .map((score) => score.employee_name.trim())
            .filter((name) => name.length > 0)
        )
      );

      const mappings: EmployeeMappingEntry[] = uniqueEmployeeNames.map((name) => {
        const normalized = normalizeName(name);
        const autoMatch = employeesList.find(
          (employee) => normalizeName(employee.name) === normalized
        );

        return {
          originalName: name,
          normalized,
          selectedEmployeeId: autoMatch ? autoMatch.id : null,
          newEmployee: null,
          autoMatched: Boolean(autoMatch),
        };
      });

      setEmployeeMappings(mappings);
      setProgress(40);
      setStep('performance-map');
    } catch (err) {
      const message = getErrorMessage(err, 'Failed to parse performance file');
      setError(message);
      setStep('performance-preview');
    }
  };

  const handleMappingSelection = (normalized: string, value: string) => {
    setEmployeeMappings((prev) =>
      prev.map((mapping) => {
        if (mapping.normalized !== normalized) {
          return mapping;
        }

        if (value === '__none__') {
          return {
            ...mapping,
            selectedEmployeeId: null,
            newEmployee: null,
            autoMatched: false,
          };
        }

        if (value === '__new__') {
          return {
            ...mapping,
            selectedEmployeeId: null,
            newEmployee: {
              name: mapping.originalName.trim(),
              nip: null,
              gol: null,
              jabatan: null,
              sub_jabatan: null,
            },
            autoMatched: false,
          };
        }

        const id = Number(value);
        return {
          ...mapping,
          selectedEmployeeId: Number.isNaN(id) ? null : id,
          newEmployee: null,
          autoMatched: false,
        };
      })
    );
  };

  const handleNewEmployeeFieldChange = (
    normalized: string,
    field: keyof ParsedEmployee,
    value: string
  ) => {
    setEmployeeMappings((prev) =>
      prev.map((mapping) => {
        if (mapping.normalized !== normalized || !mapping.newEmployee) {
          return mapping;
        }
        return {
          ...mapping,
          newEmployee: {
            ...mapping.newEmployee,
            [field]: value,
          },
        };
      })
    );
  };

  const handlePerformanceMappingComplete = () => {
    const unresolved = employeeMappings.filter((entry) => {
      if (entry.selectedEmployeeId !== null) {
        return false;
      }
      const newEmployee = entry.newEmployee;
      return !newEmployee || newEmployee.name.trim().length === 0;
    });

    if (unresolved.length > 0) {
      setError('Resolve all employee mappings before continuing.');
      return;
    }

    const normalizedToFinalName = new Map<string, string>();
    const newEmployeesForCreation: ParsedEmployee[] = [];
    const resolvedEmployees: ParsedEmployee[] = [];

    for (const mapping of employeeMappings) {
      if (mapping.selectedEmployeeId !== null) {
        const existing = existingEmployees.find((emp) => emp.id === mapping.selectedEmployeeId);
        if (!existing) {
          setError('Selected employee could not be found. Please reload and try again.');
          return;
        }
        const parsed = toParsedEmployee(existing);
        resolvedEmployees.push(parsed);
        normalizedToFinalName.set(mapping.normalized, existing.name);
        continue;
      }

      const newEmployee = mapping.newEmployee;
      if (!newEmployee) {
        setError('Resolve all employee mappings before continuing.');
        return;
      }

      const sanitized = sanitizeParsedEmployee(newEmployee);
      if (!sanitized.name) {
        setError('Employee name cannot be blank.');
        return;
      }
      resolvedEmployees.push(sanitized);
      newEmployeesForCreation.push(sanitized);
      normalizedToFinalName.set(mapping.normalized, sanitized.name);
    }

    const updatedScores = scores.map((score) => {
      const normalized = normalizeName(score.employee_name);
      const finalName = normalizedToFinalName.get(normalized) ?? score.employee_name.trim();
      return {
        ...score,
        employee_name: finalName,
      };
    });

    setScores(updatedScores);
    setEmployees(resolvedEmployees);
    setPendingNewEmployees(newEmployeesForCreation);
    setEmployeeNamesForDataset(
      Array.from(new Set(updatedScores.map((score) => score.employee_name.trim()).filter(Boolean)))
    );
    setValidationSummary(null);
    setValidationDirty(false);
    setError(null);
    setStep('performance-rating');
  };

  const runValidation = async (
    nextEmployees: ParsedEmployee[],
    nextScores: ParsedScore[],
    nextMappings: CreateRatingMapping[],
  ): Promise<boolean> => {
    setIsValidationLoading(true);
    setError(null);
    try {
      const sanitizedEmployees = nextEmployees.map(sanitizeParsedEmployee);
      const sanitizedScores = nextScores.map((score) => ({
        ...score,
        employee_name: score.employee_name.trim(),
        competency: score.competency.trim(),
        value: score.value.trim(),
      }));
      const sanitizedMappings = nextMappings.map((mapping) => ({
        ...mapping,
        text_value: mapping.text_value.trim(),
        numeric_value: Number(mapping.numeric_value),
      }));

      const summary = await validateImportData({
        employees: sanitizedEmployees,
        scores: sanitizedScores,
        rating_mappings: sanitizedMappings,
      });

      setEmployees(sanitizedEmployees);
      setScores(sanitizedScores);
      setRatingMappings(sanitizedMappings);
      setValidationSummary(summary);
      setValidationDirty(false);
      setProgress(70);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to validate import data'));
      return false;
    } finally {
      setIsValidationLoading(false);
    }
  };

  const handleRatingMappingComplete = async (mappings: CreateRatingMapping[]) => {
    const cleanedMappings = mappings.map((mapping) => ({
      ...mapping,
      text_value: mapping.text_value.trim(),
      numeric_value: Number(mapping.numeric_value),
    }));

    const finalDatasetName = datasetName || `Import ${new Date().toLocaleString()}`;
    setDatasetName(finalDatasetName);
    setRatingMappings(cleanedMappings);
    setValidationDirty(false);
    setProgress(60);

    const success = await runValidation(employees, scores, cleanedMappings);
    if (!success) {
      setStep('performance-rating');
      return;
    }

    setStep('performance-validation');
  };

  const handleEmployeeNameChange = (index: number, value: string) => {
    if (index < 0 || index >= employees.length) return;

    const previousName = employees[index]?.name ?? '';
    const updatedEmployees = [...employees];
    updatedEmployees[index] = {
      ...updatedEmployees[index],
      name: value,
    };
    setEmployees(updatedEmployees);

    if (previousName !== value) {
      setScores((prevScores) => {
        const updated = prevScores.map((score) =>
          score.employee_name === previousName
            ? { ...score, employee_name: value }
            : score
        );
        setEmployeeNamesForDataset(
          Array.from(new Set(updated.map((score) => score.employee_name.trim()).filter(Boolean)))
        );
        return updated;
      });
    }

    setValidationDirty(true);
  };

  const handleScoreEmployeeChange = (scoreIndex: number, employeeIndex: number) => {
    if (scoreIndex < 0 || scoreIndex >= scores.length) return;
    const selectedEmployee = employees[employeeIndex];
    if (!selectedEmployee) return;
    setScores((prevScores) => {
      const updated = [...prevScores];
      updated[scoreIndex] = {
        ...updated[scoreIndex],
        employee_name: selectedEmployee.name,
      };
      setEmployeeNamesForDataset(
        Array.from(new Set(updated.map((score) => score.employee_name.trim()).filter(Boolean)))
      );
      return updated;
    });
    setValidationDirty(true);
  };

  const handleMappingValueChange = (textValue: string, numericValue: number) => {
    const trimmed = textValue.trim();
    const sanitizedNumeric = Number.isFinite(numericValue) ? numericValue : 0;

    setRatingMappings((prev) => {
      const updated = [...prev];
      const existingIndex = updated.findIndex(
        (mapping) => mapping.text_value.trim().toLowerCase() === trimmed.toLowerCase()
      );

      if (existingIndex >= 0) {
        updated[existingIndex] = {
          ...updated[existingIndex],
          text_value: trimmed,
          numeric_value: sanitizedNumeric,
        };
      } else {
        updated.push({
          dataset_id: 0,
          text_value: trimmed,
          numeric_value: sanitizedNumeric,
        });
      }

      return updated;
    });

    setValidationDirty(true);
  };

  const handleRemoveEmployee = (index: number) => {
    if (index < 0 || index >= employees.length) return;
    setEmployees((prev) => prev.filter((_, idx) => idx !== index));
    setValidationDirty(true);
  };

  const handleRevalidate = async () => {
    await runValidation(employees, scores, ratingMappings);
  };

  const handlePerformanceImportConfirmed = async () => {
    if (validationDirty || (validationSummary && !validationSummary.stats.can_import)) {
      return;
    }

    try {
      setError(null);
      setProgress(25);
      setStep('performance-importing');

      if (pendingNewEmployees.length > 0) {
        await importEmployees({ employees: pendingNewEmployees });
        setProgress(55);
        await loadMasterEmployees(true);
      } else {
        setProgress(45);
      }

      const finalDatasetName = datasetName.trim() || `Impor ${new Date().toLocaleString()}`;
      const finalDescription = datasetDescription.trim().length > 0 ? datasetDescription.trim() : null;
      const finalSourceFile = sourceFilePath
        || (performanceFile instanceof File ? performanceFile.name : performanceFile ?? 'Impor Kinerja');

      const sanitizedMappings = ratingMappings.map((mapping) => ({
        ...mapping,
        text_value: mapping.text_value.trim(),
        numeric_value: Number(mapping.numeric_value),
      }));

      let result: ImportResult;
      if (importMode === 'append') {
        const id = targetDatasetId ?? selectedDatasetId ?? null;
        if (!id) {
          throw new Error('Pilih dataset target untuk ditambahkan');
        }
        result = await importPerformanceIntoDataset({
          dataset_id: id,
          employee_names: employeeNamesForDataset,
          scores,
          rating_mappings: sanitizedMappings,
        });
      } else {
        result = await importPerformanceDataset({
          dataset_name: finalDatasetName,
          dataset_description: finalDescription,
          source_file: finalSourceFile,
          employee_names: employeeNamesForDataset,
          scores,
          rating_mappings: sanitizedMappings,
        });
      }

      await refreshDatasets();
      selectDataset(result.dataset.id);
      setImportResult(result);
      setProgress(100);
      setStep('performance-complete');
    } catch (err) {
      const message = getErrorMessage(err, 'Gagal mengimpor dataset kinerja');
      setError(message);
      setStep('performance-validation');
    }
  };

  const handleStartOver = () => {
    resetEmployeeFlow();
    resetPerformanceFlow();
    setEmployees([]);
    setError(null);
    setStep('landing');
  };

  const handleViewDashboard = () => {
    if (importResult) {
      void navigate(`/dashboard/${importResult.dataset.id}`);
    }
  };

  const employeeOptions = useMemo(
    () =>
      employees.map((emp, index) => ({
        value: index.toString(),
        label: emp.name.trim() || `Employee ${index + 1}`,
      })),
    [employees]
  );

  const getEmployeeIndexByName = (name: string): number =>
    employees.findIndex((emp) => emp.name === name);

  const canImportPerformance = Boolean(
    validationSummary?.stats.can_import && !validationDirty && !isValidationLoading,
  );
  const totalIssues = validationSummary?.stats.total_issues ?? 0;

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'landing' && (
        <Card>
          <CardHeader>
            <CardTitle>Pilih jenis impor</CardTitle>
            <CardDescription>
              Pilih apakah akan memperbarui data induk pegawai atau mengimpor dataset kinerja.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle>Data Induk Pegawai</CardTitle>
                  <CardDescription>
                    Segarkan daftar pegawai kanonis (nama, NIP, jabatan, sub-jabatan) secara independen dari data kinerja.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={startEmployeeFlow}>Impor Data Pegawai</Button>
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle>Dataset Kinerja</CardTitle>
                  <CardDescription>
                    Unggah file skor kinerja, petakan nama ke pegawai induk, dan buat dataset baru.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={startPerformanceFlow}>Impor Data Kinerja</Button>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'employee-select' && (
        <Card>
          <CardHeader>
            <CardTitle>Impor CSV Pegawai</CardTitle>
            <CardDescription>
              Unggah CSV yang berisi data induk pegawai terbaru.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FileImport
              key={employeeFileKey}
              onFileSelected={handleEmployeeFileSelected}
              onFileCleared={() => resetEmployeeFlow()}
              title="CSV Pegawai"
              description="Klik untuk memilih file data induk pegawai"
            />
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleStartOver}>
                Kembali
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'employee-preview' && employeePreview && (
        <Card>
          <CardHeader>
            <CardTitle>Tinjau Data Pegawai</CardTitle>
            <CardDescription>
              Konfirmasikan struktur yang terdeteksi sebelum memperbarui daftar induk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pegawai Terdeteksi</p>
                  <p className="text-2xl font-semibold">{employeePreview.employee_count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pemisah</p>
                  <p className="text-2xl font-semibold">
                    {employeePreview.detected_delimiter === ','
                      ? 'Koma'
                      : employeePreview.detected_delimiter === '\t'
                        ? 'Tab'
                        : employeePreview.detected_delimiter}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pengkodean</p>
                  <p className="text-2xl font-semibold">{employeePreview.encoding}</p>
                </CardContent>
              </Card>
            </div>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {employeePreview.headers.map((header, idx) => (
                      <TableHead key={idx}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeePreview.rows.map((row, rowIdx) => (
                    <TableRow key={`employee-preview-${rowIdx}`}>
                      {row.map((cell, cellIdx) => (
                        <TableCell key={cellIdx}>{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep('employee-select')}>
                Kembali
              </Button>
              <Button onClick={() => void handleImportEmployeesOnly()}>
                Impor Pegawai
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'employee-importing' && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Database className="h-12 w-12 text-primary animate-pulse" />
              <p className="text-lg font-medium">Memperbarui data induk pegawai...</p>
              <Progress value={progress} className="w-64" />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'employee-complete' && employeeImportSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-600" />
              Impor Pegawai Berhasil
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Total Diproses</p>
                  <p className="text-2xl font-semibold">{employeeImportSummary.total}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pegawai Baru Ditambahkan</p>
                  <p className="text-2xl font-semibold">{employeeImportSummary.inserted}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pegawai Diperbarui</p>
                  <p className="text-2xl font-semibold">{employeeImportSummary.updated}</p>
                </CardContent>
              </Card>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleStartOver}>Kembali ke Opsi Impor</Button>
              <Button variant="secondary" onClick={startPerformanceFlow}>
                Impor Data Kinerja
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'performance-select' && (
        <Card>
          <CardHeader>
            <CardTitle>Impor CSV Kinerja</CardTitle>
            <CardDescription>
              Unggah file skor kinerja yang merujuk pada pegawai di data induk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FileImport
              key={performanceFileKey}
              onFileSelected={handlePerformanceFileSelected}
              onFileCleared={() => resetPerformanceFlow()}
              title="CSV Kinerja"
              description="Klik untuk memilih file penilaian kinerja"
            />
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleStartOver}>
                Kembali
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'performance-preview' && performancePreview && (
        <Card>
          <CardHeader>
            <CardTitle>Tinjau File Kinerja</CardTitle>
            <CardDescription>
              Konfirmasikan struktur yang terdeteksi dan berikan detail dataset sebelum memetakan pegawai.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Baris Terdeteksi</p>
                  <p className="text-2xl font-semibold">{performancePreview.rows.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pemisah</p>
                  <p className="text-2xl font-semibold">
                    {performancePreview.detected_delimiter === ','
                      ? 'Koma'
                      : performancePreview.detected_delimiter === '\t'
                        ? 'Tab'
                        : performancePreview.detected_delimiter}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pengkodean</p>
                  <p className="text-2xl font-semibold">{performancePreview.encoding}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Mode impor</label>
                <Select value={importMode} onValueChange={(v) => setImportMode(v as 'new' | 'append')}>
                  <SelectTrigger className="md:w-72">
                    <SelectValue placeholder="Pilih mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Buat dataset baru</SelectItem>
                    <SelectItem value="append">Tambahkan ke dataset yang ada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {importMode === 'append' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Dataset target</label>
                  <Select
                    value={targetDatasetId !== null ? String(targetDatasetId) : undefined}
                    onValueChange={(v) => setTargetDatasetId(Number(v))}
                  >
                    <SelectTrigger className="md:w-72">
                      <SelectValue placeholder="Pilih dataset" />
                    </SelectTrigger>
                    <SelectContent>
                      {datasets.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {importMode === 'new' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="dataset-name">
                    Nama dataset
                  </label>
                  <Input
                    id="dataset-name"
                    value={datasetName}
                    onChange={(event) => setDatasetName(event.target.value)}
                    placeholder="Nama dataset kinerja"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="dataset-description">
                    Deskripsi (opsional)
                  </label>
                  <Input
                    id="dataset-description"
                    value={datasetDescription}
                    onChange={(event) => setDatasetDescription(event.target.value)}
                    placeholder="Tambahkan deskripsi singkat"
                  />
                </div>
              </div>
            )}

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {performancePreview.headers.map((header, idx) => (
                      <TableHead key={idx}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performancePreview.rows.map((row, rowIdx) => (
                    <TableRow key={`performance-preview-${rowIdx}`}>
                      {row.map((cell, cellIdx) => (
                        <TableCell key={cellIdx}>{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep('performance-select')}>
                Kembali
              </Button>
              <Button onClick={() => void handlePerformancePreviewContinue()}>
                Lanjutkan ke Pemetaan Pegawai
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'performance-map' && (
        <Card>
          <CardHeader>
            <CardTitle>Selesaikan Pencocokan Pegawai</CardTitle>
            <CardDescription>
              Petakan nama pegawai yang ditemukan di file kinerja ke catatan pegawai induk atau buat entri baru.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoadingEmployees && (
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription>Memuat pegawai induk…</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              {employeeMappings.map((mapping) => {
                const currentEmployee = mapping.selectedEmployeeId
                  ? existingEmployees.find((employee) => employee.id === mapping.selectedEmployeeId)
                  : null;

                const statusBadge = mapping.selectedEmployeeId
                  ? { label: 'Terpetakan', variant: 'secondary' as const }
                  : mapping.newEmployee
                    ? { label: 'Pegawai baru', variant: 'secondary' as const }
                    : mapping.autoMatched
                      ? { label: 'Cocok otomatis', variant: 'outline' as const }
                      : { label: 'Butuh pemetaan', variant: 'destructive' as const };

                const isMatched = mapping.selectedEmployeeId !== null || mapping.autoMatched;

                const selectValue = mapping.selectedEmployeeId !== null
                  ? mapping.selectedEmployeeId.toString()
                  : mapping.newEmployee
                    ? '__new__'
                    : '__none__';

                return (
                  <Card
                    key={mapping.normalized}
                    className={isMatched ? 'border-green-200' : 'border-destructive/30'}
                  >
                    <CardContent className="space-y-4 pt-6">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Nama asli</p>
                          <p className="text-lg font-semibold">{mapping.originalName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                          {isMatched ? (
                            <Badge className="bg-green-100 text-green-800">
                              <span className="inline-flex items-center gap-1">
                                <CheckCircle className="h-3.5 w-3.5" /> Cocok
                              </span>
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <span className="inline-flex items-center gap-1">
                                <AlertCircle className="h-3.5 w-3.5" /> Tidak cocok
                              </span>
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 md:flex-row md:items-center">
                        <Select
                          value={selectValue}
                          onValueChange={(value) => handleMappingSelection(mapping.normalized, value)}
                        >
                          <SelectTrigger className="md:w-72">
                            <SelectValue placeholder="Pilih pegawai" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Tidak ditugaskan</SelectItem>
                            <SelectItem value="__new__">Buat pegawai baru</SelectItem>
                            {existingEmployees.map((employee) => (
                              <SelectItem key={employee.id} value={employee.id.toString()}>
                                {employee.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {currentEmployee && (
                          <p className="text-sm text-muted-foreground">
                            Terpilih: {currentEmployee.name}
                          </p>
                        )}
                      </div>

                      {mapping.newEmployee && (
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Nama</label>
                            <Input
                              value={mapping.newEmployee.name}
                              onChange={(event) =>
                                handleNewEmployeeFieldChange(mapping.normalized, 'name', event.target.value)
                              }
                              placeholder="Nama pegawai"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">NIP (opsional)</label>
                            <Input
                              value={mapping.newEmployee.nip ?? ''}
                              onChange={(event) =>
                                handleNewEmployeeFieldChange(mapping.normalized, 'nip', event.target.value)
                              }
                              placeholder="NIP"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Jabatan (opsional)</label>
                            <Input
                              value={mapping.newEmployee.jabatan ?? ''}
                              onChange={(event) =>
                                handleNewEmployeeFieldChange(mapping.normalized, 'jabatan', event.target.value)
                              }
                              placeholder="Jabatan"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Sub Jabatan (opsional)</label>
                            <Input
                              value={mapping.newEmployee.sub_jabatan ?? ''}
                              onChange={(event) =>
                                handleNewEmployeeFieldChange(mapping.normalized, 'sub_jabatan', event.target.value)
                              }
                              placeholder="Sub jabatan"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Golongan (opsional)</label>
                            <Input
                              value={mapping.newEmployee.gol ?? ''}
                              onChange={(event) =>
                                handleNewEmployeeFieldChange(mapping.normalized, 'gol', event.target.value)
                              }
                              placeholder="Golongan"
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep('performance-preview')}>
                Kembali
              </Button>
              <Button onClick={handlePerformanceMappingComplete}>
                Lanjutkan ke Pemetaan Peringkat
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'performance-rating' && (
        <RatingMappingConfig
          uniqueValues={uniqueScoreValues}
          onComplete={(mappings) => void handleRatingMappingComplete(mappings)}
          onBack={() => setStep('performance-map')}
        />
      )}

      {step === 'performance-validation' && (
        <Card>
          <CardHeader>
            <CardTitle>Selesaikan Masalah Validasi</CardTitle>
            <CardDescription>
              Tinjau dan atasi masalah yang terdeteksi sebelum menyelesaikan impor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">Nama Dataset</p>
                <p className="break-words text-lg font-medium">{datasetName}</p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">File Sumber</p>
                <p className="break-words text-lg font-medium">{sourceFilePath || 'Tidak diatur'}</p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">Masalah yang Belum Selesai</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={totalIssues === 0 ? 'secondary' : 'destructive'}>
                    {totalIssues} {totalIssues === 1 ? 'masalah' : 'masalah'}
                  </Badge>
                  {validationSummary && validationSummary.stats.warning_count > 0 && (
                    <Badge variant="outline">
                      {validationSummary.stats.warning_count}{' '}
                      {validationSummary.stats.warning_count === 1 ? 'peringatan' : 'peringatan'}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {validationDirty && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Perubahan terdeteksi. Jalankan ulang validasi untuk menyegarkan hasil sebelum mengimpor.
                </AlertDescription>
              </Alert>
            )}

            {isValidationLoading ? (
              <div className="flex flex-col items-center justify-center space-y-4 py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Menjalankan pemeriksaan validasi...</p>
              </div>
            ) : validationSummary ? (
              <div className="space-y-6">
                {totalIssues === 0 && !validationDirty && (
                  <Alert>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription>
                      Validasi selesai. Anda dapat melanjutkan mengimpor dataset ini.
                    </AlertDescription>
                  </Alert>
                )}

                {validationSummary.blank_employee_names.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Pegawai tanpa nama</h3>
                    <div className="space-y-3">
                      {validationSummary.blank_employee_names.map((issue) => {
                        const employee = employees[issue.employee_index];
                        return (
                          <div
                            key={`blank-${issue.employee_index}`}
                            className="space-y-2 rounded-md border p-4"
                          >
                            <p className="text-sm text-muted-foreground">Catatan {issue.employee_index + 1}</p>
                            <Input
                              value={employee?.name ?? ''}
                              placeholder="Masukkan nama pegawai"
                              onChange={(event) =>
                                handleEmployeeNameChange(issue.employee_index, event.target.value)
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {validationSummary.duplicate_employees.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Nama pegawai duplikat</h3>
                    <p className="text-sm text-muted-foreground">
                      Ubah nama atau hapus duplikat agar setiap pegawai teridentifikasi secara unik.
                    </p>
                    <div className="space-y-3">
                      {validationSummary.duplicate_employees.map((group, groupIndex) => (
                        <div key={`dup-${groupIndex}`} className="space-y-4 rounded-md border p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{group.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {group.employee_indices.length} entri terdeteksi
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            {group.employee_indices.map((index) => {
                              const employee = employees[index];
                              if (!employee) return null;
                              return (
                                <div
                                  key={`dup-${groupIndex}-${index}`}
                                  className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:gap-4"
                                >
                                  <div className="flex-1 space-y-1">
                                    <Input
                                      value={employee.name}
                                      onChange={(event) => handleEmployeeNameChange(index, event.target.value)}
                                    />
                                    <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                      {employee.nip && <span>NIP: {employee.nip}</span>}
                                      {employee.jabatan && <span>Jabatan: {employee.jabatan}</span>}
                                    </div>
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => handleRemoveEmployee(index)}>
                                    Hapus
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {validationSummary.orphan_scores.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Skor dengan pegawai tidak dikenal</h3>
                    <p className="text-sm text-muted-foreground">
                      Tetapkan setiap skor ke catatan pegawai yang valid.
                    </p>
                    <div className="space-y-3">
                      {validationSummary.orphan_scores.map((issue) => {
                        const score = scores[issue.score_index];
                        const currentIndex = getEmployeeIndexByName(score?.employee_name ?? '');
                        return (
                          <div key={`orphan-${issue.score_index}`} className="space-y-3 rounded-md border p-4">
                            <div>
                              <p className="font-medium">{issue.employee_name || 'Pegawai tanpa nama'}</p>
                              <p className="text-sm text-muted-foreground">Kompetensi: {issue.competency}</p>
                              <p className="text-sm text-muted-foreground">Skor: {score?.value ?? '-'}</p>
                            </div>
                            <div className="md:w-64">
                              <Select
                                value={currentIndex >= 0 ? currentIndex.toString() : undefined}
                                onValueChange={(value) => handleScoreEmployeeChange(issue.score_index, Number(value))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih pegawai" />
                                </SelectTrigger>
                                <SelectContent>
                                  {employeeOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {validationSummary.unmapped_ratings.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Nilai peringkat yang belum dipetakan</h3>
                    <p className="text-sm text-muted-foreground">
                      Berikan nilai numerik agar peringkat ini dapat dimasukkan dalam analitik.
                    </p>
                    <div className="space-y-3">
                      {validationSummary.unmapped_ratings.map((issue) => {
                        const existing = ratingMappings.find(
                          (mapping) => mapping.text_value.trim().toLowerCase() === issue.value.trim().toLowerCase()
                        );
                        return (
                          <div key={`rating-${issue.value}`} className="space-y-3 rounded-md border p-4">
                            <div className="flex items-center justify-between">
                              <p className="font-medium">{issue.value}</p>
                              <Badge variant="outline">
                                {issue.occurrences} {issue.occurrences === 1 ? 'kemunculan' : 'kemunculan'}
                              </Badge>
                            </div>
                            <div className="md:w-48">
                              <Input
                                type="number"
                                step="0.1"
                                value={existing?.numeric_value ?? ''}
                                onChange={(event) => handleMappingValueChange(issue.value, parseFloat(event.target.value))}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No validation results yet. Run validation to review potential issues.
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep('performance-rating')}>
                Kembali ke Pemetaan Peringkat
              </Button>
              <Button variant="secondary" onClick={() => void handleRevalidate()} disabled={isValidationLoading}>
                Jalankan Ulang Validasi
              </Button>
              <Button onClick={() => void handlePerformanceImportConfirmed()} disabled={!canImportPerformance}>
                Impor Dataset Kinerja
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'performance-importing' && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Database className="h-12 w-12 text-primary animate-pulse" />
              <p className="text-lg font-medium">Mengimpor dataset kinerja...</p>
              <Progress value={progress} className="w-64" />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'performance-complete' && importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-600" />
              Impor Kinerja Berhasil
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Pegawai Tertaut</p>
                  <p className="text-2xl font-semibold">{importResult.employee_count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Kompetensi</p>
                  <p className="text-2xl font-semibold">{importResult.competency_count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Skor Diimpor</p>
                  <p className="text-2xl font-semibold">{importResult.score_count}</p>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Nama Dataset</p>
                <p className="text-muted-foreground">{importResult.dataset.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Dibuat</p>
                <p className="text-muted-foreground">
                  {new Date(importResult.dataset.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="mt-6 flex gap-4">
              <Button onClick={handleStartOver}>Impor Dataset Lain</Button>
              <Button onClick={handleViewDashboard}>Lihat Dasbor</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
