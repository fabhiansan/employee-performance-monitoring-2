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
import { parseEmployeeCSV, parseScoresCSV, importDataset, validateImportData } from '@/lib/api';
import { useDatasets } from '@/lib/dataset-context';

type ImportStep = 'select' | 'preview' | 'mapping' | 'validation' | 'importing' | 'complete';

export function ImportPage() {
  const navigate = useNavigate();
  const { refreshDatasets, selectDataset } = useDatasets();
  const [step, setStep] = useState<ImportStep>('select');
  const [preview, setPreview] = useState<CSVPreview | null>(null);
  const [fileOrPath, setFileOrPath] = useState<File | string | null>(null);
  const [employees, setEmployees] = useState<ParsedEmployee[]>([]);
  const [scores, setScores] = useState<ParsedScore[]>([]);
  const [uniqueScoreValues, setUniqueScoreValues] = useState<string[]>([]);
  const [ratingMappings, setRatingMappings] = useState<CreateRatingMapping[]>([]);
  const [validationSummary, setValidationSummary] = useState<ImportValidationSummary | null>(null);
  const [isValidationLoading, setIsValidationLoading] = useState(false);
  const [validationDirty, setValidationDirty] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [datasetName, setDatasetName] = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');
  const [sourceFilePath, setSourceFilePath] = useState('');

  const handleFileSelected = (filePathOrFile: string | File, csvPreview: CSVPreview) => {
    setFileOrPath(filePathOrFile);
    setPreview(csvPreview);
    setDatasetName('');
    setDatasetDescription('');
    setSourceFilePath(filePathOrFile instanceof File ? filePathOrFile.name : filePathOrFile);
    setRatingMappings([]);
    setValidationSummary(null);
    setValidationDirty(false);
    setStep('preview');
  };

  const handleContinueImport = async () => {
    if (!fileOrPath) return;

    try {
      setError(null);
      setProgress(10);

      const [parsedEmployees, parsedScores] = await Promise.all([
        parseEmployeeCSV(fileOrPath),
        parseScoresCSV(fileOrPath),
      ]);

      setProgress(30);
      setEmployees(parsedEmployees);
      setScores(parsedScores);
      setRatingMappings([]);

      const uniqueValues = Array.from(new Set(parsedScores.map(s => s.value)));
      setUniqueScoreValues(uniqueValues);

      setValidationSummary(null);
      setValidationDirty(false);
      setProgress(50);
      setStep('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      console.error('Parse error:', err);
    }
  };

  const runValidation = async (
    nextEmployees: ParsedEmployee[],
    nextScores: ParsedScore[],
    nextMappings: CreateRatingMapping[],
  ): Promise<boolean> => {
    setIsValidationLoading(true);
    setError(null);
    try {
      const sanitizedEmployees = nextEmployees.map(emp => ({
        ...emp,
        name: emp.name.trim(),
      }));
      const sanitizedScores = nextScores.map(score => ({
        ...score,
        employee_name: score.employee_name.trim(),
        competency: score.competency.trim(),
        value: score.value.trim(),
      }));
      const sanitizedMappings = nextMappings.map(mapping => ({
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
      setError(err instanceof Error ? err.message : 'Failed to validate import data');
      return false;
    } finally {
      setIsValidationLoading(false);
    }
  };

  const handleMappingComplete = async (mappings: CreateRatingMapping[]) => {
    if (!fileOrPath) return;

    const cleanedMappings = mappings.map(mapping => ({
      ...mapping,
      text_value: mapping.text_value.trim(),
      numeric_value: Number(mapping.numeric_value),
    }));

    const fileName = fileOrPath instanceof File
      ? fileOrPath.name
      : fileOrPath.split('/').pop() ?? 'unknown';
    const generatedDatasetName = datasetName || `Import ${new Date().toLocaleString()}`;

    setError(null);
    setDatasetName(generatedDatasetName);
    setDatasetDescription(`Imported from ${fileName}`);
    setSourceFilePath(fileOrPath instanceof File ? fileOrPath.name : fileOrPath);
    setRatingMappings(cleanedMappings);
    setValidationDirty(false);
    setProgress(60);
    setStep('validation');

    const success = await runValidation(employees, scores, cleanedMappings);
    if (!success) {
      setStep('mapping');
    }
  };

  const handleImportConfirmed = async () => {
    if (!fileOrPath) return;
    if (validationDirty || (validationSummary && !validationSummary.stats.can_import)) {
      return;
    }

    try {
      setError(null);
      setStep('importing');
      setProgress(80);

      const finalDatasetName = datasetName || `Import ${new Date().toLocaleString()}`;
      const finalDescription = datasetDescription || null;
      const finalSourceFile = sourceFilePath || (fileOrPath instanceof File ? fileOrPath.name : fileOrPath);

      const result = await importDataset({
        dataset_name: finalDatasetName,
        dataset_description: finalDescription,
        source_file: finalSourceFile,
        employees,
        scores,
        rating_mappings: ratingMappings,
      });

      await refreshDatasets();
      selectDataset(result.dataset.id);

      setProgress(100);
      setImportResult(result);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import dataset');
      setStep('validation');
      console.error('Import error:', err);
    }
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
      setScores(prevScores =>
        prevScores.map(score =>
          score.employee_name === previousName
            ? { ...score, employee_name: value }
            : score
        ),
      );
    }

    setValidationDirty(true);
  };

  const handleScoreEmployeeChange = (scoreIndex: number, employeeIndex: number) => {
    if (scoreIndex < 0 || scoreIndex >= scores.length) return;
    const selectedEmployee = employees[employeeIndex];
    if (!selectedEmployee) return;
    setScores(prevScores => {
      const updated = [...prevScores];
      updated[scoreIndex] = {
        ...updated[scoreIndex],
        employee_name: selectedEmployee.name,
      };
      return updated;
    });
    setValidationDirty(true);
  };

  const handleMappingValueChange = (textValue: string, numericValue: number) => {
    const trimmed = textValue.trim();
    const sanitizedNumeric = Number.isFinite(numericValue) ? numericValue : 0;

    setRatingMappings(prev => {
      const updated = [...prev];
      const existingIndex = updated.findIndex(
        mapping => mapping.text_value.trim().toLowerCase() === trimmed.toLowerCase(),
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
    setEmployees(prev => prev.filter((_, idx) => idx !== index));
    setValidationDirty(true);
  };

  const handleRevalidate = async () => {
    await runValidation(employees, scores, ratingMappings);
  };

  const employeeOptions = useMemo(
    () =>
      employees.map((emp, index) => ({
        value: index.toString(),
        label: emp.name.trim() || `Employee ${index + 1}`,
      })),
    [employees],
  );

  const getEmployeeIndexByName = (name: string): number =>
    employees.findIndex(emp => emp.name === name);

  const canImport = Boolean(
    validationSummary?.stats.can_import && !validationDirty && !isValidationLoading,
  );
  const totalIssues = validationSummary?.stats.total_issues ?? 0;

  const handleStartOver = () => {
    setStep('select');
    setPreview(null);
    setFileOrPath(null);
    setEmployees([]);
    setScores([]);
    setUniqueScoreValues([]);
    setRatingMappings([]);
    setValidationSummary(null);
    setIsValidationLoading(false);
    setValidationDirty(false);
    setImportResult(null);
    setError(null);
    setProgress(0);
    setDatasetName('');
    setDatasetDescription('');
    setSourceFilePath('');
  };

  const handleViewDashboard = () => {
    if (importResult) {
      void navigate(`/dashboard/${importResult.dataset.id}`);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'select' && (
        <Card>
          <CardHeader>
            <CardTitle>Import Employee Data</CardTitle>
            <CardDescription>
              Import your employee data CSV file to begin analyzing performance metrics.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileImport onFileSelected={handleFileSelected} />
          </CardContent>
        </Card>
      )}

      {step === 'preview' && preview && (
        <Card>
          <CardHeader>
            <CardTitle>File Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-6 grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Employees Detected</p>
                  <p className="text-2xl font-semibold">{preview.employee_count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Delimiter</p>
                  <p className="text-2xl font-semibold">
                    {preview.detected_delimiter === ',' ? 'Comma' : preview.detected_delimiter === '\t' ? 'Tab' : preview.detected_delimiter}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Encoding</p>
                  <p className="text-2xl font-semibold">{preview.encoding}</p>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview.headers.map((header, idx) => (
                      <TableHead key={idx}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, rowIdx) => (
                    <TableRow key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <TableCell key={cellIdx}>{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-6 flex gap-4">
              <Button variant="outline" onClick={handleStartOver}>
                Cancel
              </Button>
              <Button onClick={() => void handleContinueImport()}>
                Continue to Mapping
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'mapping' && (
        <RatingMappingConfig
          uniqueValues={uniqueScoreValues}
          onComplete={(mappings) => void handleMappingComplete(mappings)}
          onBack={() => setStep('preview')}
        />
      )}

      {step === 'validation' && (
        <Card>
          <CardHeader>
            <CardTitle>Resolve Validation Issues</CardTitle>
            <CardDescription>
              Review and address duplicates or mismatches before importing the dataset.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">Dataset Name</p>
                <p className="break-words text-lg font-medium">{datasetName}</p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">Source File</p>
                <p className="break-words text-lg font-medium">{sourceFilePath || 'Not set'}</p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">Outstanding Issues</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={totalIssues === 0 ? 'secondary' : 'destructive'}>
                    {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'}
                  </Badge>
                  {validationSummary && validationSummary.stats.warning_count > 0 && (
                    <Badge variant="outline">
                      {validationSummary.stats.warning_count}{' '}
                      {validationSummary.stats.warning_count === 1 ? 'warning' : 'warnings'}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {validationDirty && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Changes detected. Re-run validation to refresh the results before importing.
                </AlertDescription>
              </Alert>
            )}

            {isValidationLoading ? (
              <div className="flex flex-col items-center justify-center space-y-4 py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Running validation checks...</p>
              </div>
            ) : validationSummary ? (
              <div className="space-y-6">
                {totalIssues === 0 && !validationDirty && (
                  <Alert>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription>
                      Validation is complete. You can proceed with importing this dataset.
                    </AlertDescription>
                  </Alert>
                )}

                {validationSummary.blank_employee_names.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Employees missing names</h3>
                    <div className="space-y-3">
                      {validationSummary.blank_employee_names.map(issue => {
                        const employee = employees[issue.employee_index];
                        return (
                          <div
                            key={`blank-${issue.employee_index}`}
                            className="space-y-2 rounded-md border p-4"
                          >
                            <p className="text-sm text-muted-foreground">
                              Record {issue.employee_index + 1}
                            </p>
                            <Input
                              value={employee?.name ?? ''}
                              placeholder="Enter employee name"
                              onChange={(e) => handleEmployeeNameChange(issue.employee_index, e.target.value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {validationSummary.duplicate_employees.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Duplicate employee names</h3>
                    <p className="text-sm text-muted-foreground">
                      Rename or remove duplicates so each employee is uniquely identified.
                    </p>
                    <div className="space-y-3">
                      {validationSummary.duplicate_employees.map((group, groupIndex) => (
                        <div key={`dup-${groupIndex}`} className="space-y-4 rounded-md border p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{group.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {group.employee_indices.length} entries detected
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            {group.employee_indices.map(index => {
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
                                      onChange={(e) => handleEmployeeNameChange(index, e.target.value)}
                                    />
                                    <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                      {employee.nip && <span>NIP: {employee.nip}</span>}
                                      {employee.jabatan && <span>Jabatan: {employee.jabatan}</span>}
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveEmployee(index)}
                                  >
                                    Remove
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
                    <h3 className="text-sm font-medium">Scores with unknown employees</h3>
                    <p className="text-sm text-muted-foreground">
                      Assign each score to a valid employee record.
                    </p>
                    <div className="space-y-3">
                      {validationSummary.orphan_scores.map(issue => {
                        const score = scores[issue.score_index];
                        const currentIndex = getEmployeeIndexByName(score?.employee_name ?? '');
                        return (
                          <div
                            key={`orphan-${issue.score_index}`}
                            className="space-y-3 rounded-md border p-4"
                          >
                            <div>
                              <p className="font-medium">{issue.employee_name || 'Unnamed employee'}</p>
                              <p className="text-sm text-muted-foreground">Competency: {issue.competency}</p>
                              <p className="text-sm text-muted-foreground">Score: {score?.value ?? '-'}</p>
                            </div>
                            <div className="md:w-64">
                              <Select
                                value={currentIndex >= 0 ? currentIndex.toString() : undefined}
                                onValueChange={(value) => handleScoreEmployeeChange(issue.score_index, Number(value))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select employee" />
                                </SelectTrigger>
                                <SelectContent>
                                  {employeeOptions.map(option => (
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
                    <h3 className="text-sm font-medium">Unmapped rating values</h3>
                    <p className="text-sm text-muted-foreground">
                      Provide numeric values so these ratings can be included in analytics.
                    </p>
                    <div className="space-y-3">
                      {validationSummary.unmapped_ratings.map(issue => {
                        const existing = ratingMappings.find(
                          mapping => mapping.text_value.trim().toLowerCase() === issue.value.trim().toLowerCase(),
                        );
                        return (
                          <div key={`rating-${issue.value}`} className="space-y-3 rounded-md border p-4">
                            <div className="flex items-center justify-between">
                              <p className="font-medium">{issue.value}</p>
                              <Badge variant="outline">
                                {issue.occurrences} {issue.occurrences === 1 ? 'occurrence' : 'occurrences'}
                              </Badge>
                            </div>
                            <div className="md:w-48">
                              <Input
                                type="number"
                                step="0.1"
                                value={
                                  existing && existing.numeric_value !== undefined
                                    ? existing.numeric_value
                                    : ''
                                }
                                onChange={(e) => handleMappingValueChange(issue.value, parseFloat(e.target.value))}
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
              <Button variant="outline" onClick={() => setStep('mapping')}>
                Back to Mapping
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleRevalidate()}
                disabled={isValidationLoading}
              >
                Re-run Validation
              </Button>
              <Button onClick={() => void handleImportConfirmed()} disabled={!canImport}>
                Import Dataset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'importing' && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Database className="h-12 w-12 text-primary animate-pulse" />
              <p className="text-lg font-medium">Importing dataset...</p>
              <Progress value={progress} className="w-64" />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'complete' && importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-6 w-6 text-green-600" />
              Import Successful
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Employees Imported</p>
                  <p className="text-2xl font-semibold">{importResult.employee_count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Competencies</p>
                  <p className="text-2xl font-semibold">{importResult.competency_count}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Scores Imported</p>
                  <p className="text-2xl font-semibold">{importResult.score_count}</p>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Dataset Name</p>
                <p className="text-muted-foreground">{importResult.dataset.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Created</p>
                <p className="text-muted-foreground">
                  {new Date(importResult.dataset.created_at).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mt-6 flex gap-4">
              <Button onClick={handleStartOver}>
                Import Another File
              </Button>
              <Button onClick={handleViewDashboard}>
                View Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
