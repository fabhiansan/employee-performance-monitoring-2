import { useState } from 'react';
import { FileImport } from './components/FileImport';
import { RatingMappingConfig } from './components/RatingMappingConfig';
import type {
  CSVPreview,
  CreateRatingMapping,
  ImportResult,
  ParsedEmployee,
  ParsedScore,
  EmployeeImportResult,
} from './types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Database } from 'lucide-react';
import iconUrl from '@/assets/icon.png';
import {
  parseEmployeeCSV,
  parseScoresCSV,
  importEmployees,
  importPerformanceDataset,
} from '@/lib/api';

type ImportStep = 'select' | 'preview' | 'mapping' | 'importing' | 'complete';

function App() {
  const [step, setStep] = useState<ImportStep>('select');
  const [employeePreview, setEmployeePreview] = useState<CSVPreview | null>(null);
  const [performancePreview, setPerformancePreview] = useState<CSVPreview | null>(null);
  const [employeeFile, setEmployeeFile] = useState<File | string | null>(null);
  const [performanceFile, setPerformanceFile] = useState<File | string | null>(null);
  const [employeeFileKey, setEmployeeFileKey] = useState(0);
  const [performanceFileKey, setPerformanceFileKey] = useState(0);
  const [employees, setEmployees] = useState<ParsedEmployee[]>([]);
  const [scores, setScores] = useState<ParsedScore[]>([]);
  const [uniqueScoreValues, setUniqueScoreValues] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [employeeImportSummary, setEmployeeImportSummary] = useState<EmployeeImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const resetImportState = () => {
    setEmployees([]);
    setScores([]);
    setUniqueScoreValues([]);
    setImportResult(null);
    setEmployeeImportSummary(null);
    setProgress(0);
  };

  const handleEmployeeFileSelected = (file: string | File, csvPreview: CSVPreview) => {
    resetImportState();
    setEmployeeFile(file);
    setEmployeePreview(csvPreview);
    setError(null);
    setStep('select');
  };

  const handleEmployeeFileCleared = () => {
    resetImportState();
    setEmployeeFile(null);
    setEmployeePreview(null);
    setEmployeeFileKey((key) => key + 1);
    setError(null);
    setStep('select');
  };

  const handlePerformanceFileSelected = (file: string | File, csvPreview: CSVPreview) => {
    resetImportState();
    setPerformanceFile(file);
    setPerformancePreview(csvPreview);
    setError(null);
    setStep('select');
  };

  const handlePerformanceFileCleared = () => {
    resetImportState();
    setPerformanceFile(null);
    setPerformancePreview(null);
    setPerformanceFileKey((key) => key + 1);
    setError(null);
    setStep('select');
  };

  const handleProceedToPreview = () => {
    if (!employeePreview || !performancePreview) {
      return;
    }
    setError(null);
    setStep('preview');
  };

  const handleContinueImport = async () => {
    if (!employeeFile || !performanceFile) return;

    try {
      setError(null);
      setProgress(10);

      const parsedEmployees = await parseEmployeeCSV(employeeFile);
      setProgress(25);
      const parsedScores = await parseScoresCSV(performanceFile);

      setProgress(40);
      setEmployees(parsedEmployees);
      setScores(parsedScores);

      const uniqueValues = Array.from(new Set(parsedScores.map(s => s.value)));
      setUniqueScoreValues(uniqueValues);

      setProgress(50);
      setStep('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      console.error('Parse error:', err);
    }
  };

  const handleMappingComplete = async (mappings: CreateRatingMapping[]) => {
    if (!performanceFile) return;

    try {
      setError(null);
      setStep('importing');
      setProgress(60);
      setEmployeeImportSummary(null);

      const datasetName = `Import ${new Date().toLocaleString()}`;
      const fileName = performanceFile instanceof File
        ? performanceFile.name
        : performanceFile.split('/').pop();
      const sourceFile = performanceFile instanceof File ? performanceFile.name : performanceFile;
      const employeeImport = await importEmployees({ employees });
      setEmployeeImportSummary(employeeImport);

      setProgress(75);

      const result = await importPerformanceDataset({
        dataset_name: datasetName,
        dataset_description: `Imported from ${fileName}`,
        source_file: sourceFile,
        employee_names: employees
          .map(employee => employee.name.trim())
          .filter(name => name.length > 0),
        scores,
        rating_mappings: mappings,
      });

      setProgress(100);
      setImportResult(result);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import data');
      setStep('mapping');
      console.error('Import error:', err);
    }
  };

  const handleStartOver = () => {
    setStep('select');
    setEmployeePreview(null);
    setPerformancePreview(null);
    setEmployeeFile(null);
    setPerformanceFile(null);
    setEmployeeFileKey((key) => key + 1);
    setPerformanceFileKey((key) => key + 1);
    resetImportState();
    setError(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <img src={iconUrl} alt="Analitik Kinerja Pegawai" className="h-12 w-12 rounded-md" />
            <div>
              <h1 className="text-2xl font-bold">
                Analitik Kinerja Pegawai
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Impor, analisis, dan kelola data kinerja pegawai
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step === 'select' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Impor Berkas Data</CardTitle>
                <CardDescription>
                  Sediakan file CSV terpisah untuk data induk pegawai dan skor kinerja.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Data Induk Pegawai</h3>
                  <p className="text-sm text-muted-foreground">
                    Unggah daftar resmi pegawai (nama, NIP, jabatan, sub-jabatan).
                  </p>
                  <FileImport
                    key={employeeFileKey}
                    onFileSelected={handleEmployeeFileSelected}
                    onFileCleared={handleEmployeeFileCleared}
                    title="Employee CSV"
                    description="Select the employee master data file"
                  />
                </div>
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Data Kinerja Pegawai</h3>
                  <p className="text-sm text-muted-foreground">
                    Unggah skor kinerja yang merujuk pada pegawai berdasarkan nama.
                  </p>
                  <FileImport
                    key={performanceFileKey}
                    onFileSelected={handlePerformanceFileSelected}
                    onFileCleared={handlePerformanceFileCleared}
                    title="Performance CSV"
                    description="Select the performance data file"
                  />
                </div>
                <div className="flex justify-end gap-4">
                  <Button variant="outline" onClick={handleStartOver}>
                    Hapus Pilihan
                  </Button>
                  <Button onClick={handleProceedToPreview} disabled={!employeePreview || !performancePreview}>
                    Tinjau Berkas
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'preview' && employeePreview && performancePreview && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Tinjau Berkas Terpilih</CardTitle>
                <CardDescription>
                  Konfirmasikan struktur yang terdeteksi sebelum memetakan nilai kinerja.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold">Data Induk Pegawai</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Pegawai Terdeteksi</p>
                        <p className="text-2xl font-semibold">{employeePreview.employee_count}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Delimiter</p>
                        <p className="text-2xl font-semibold">
                          {employeePreview.detected_delimiter === ','
                            ? 'Comma'
                            : employeePreview.detected_delimiter === '\t'
                              ? 'Tab'
                              : employeePreview.detected_delimiter}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Encoding</p>
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
                          <TableRow key={`employee-${rowIdx}`}>
                            {row.map((cell, cellIdx) => (
                              <TableCell key={cellIdx}>{cell}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold">Data Kinerja Pegawai</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Baris Terdeteksi</p>
                        <p className="text-2xl font-semibold">{performancePreview.rows.length}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Delimiter</p>
                        <p className="text-2xl font-semibold">
                          {performancePreview.detected_delimiter === ','
                            ? 'Comma'
                            : performancePreview.detected_delimiter === '\t'
                              ? 'Tab'
                              : performancePreview.detected_delimiter}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Encoding</p>
                        <p className="text-2xl font-semibold">{performancePreview.encoding}</p>
                      </CardContent>
                    </Card>
                  </div>
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
                          <TableRow key={`performance-${rowIdx}`}>
                            {row.map((cell, cellIdx) => (
                              <TableCell key={cellIdx}>{cell}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>

                <div className="flex gap-4">
                  <Button variant="outline" onClick={() => setStep('select')}>
                    Kembali
                  </Button>
                  <Button onClick={() => void handleContinueImport()}>
                    Lanjutkan ke Pemetaan
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'mapping' && (
          <RatingMappingConfig
            uniqueValues={uniqueScoreValues}
            onComplete={(mappings) => void handleMappingComplete(mappings)}
            onBack={() => setStep('preview')}
          />
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
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  Impor Berhasil
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Pegawai Diimpor</p>
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
                  {employeeImportSummary && (
                    <>
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
                    </>
                  )}
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
                  <Button onClick={handleStartOver}>
                    Impor Berkas Lain
                  </Button>
                  <Button variant="outline">
                    Lihat Dasbor
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
