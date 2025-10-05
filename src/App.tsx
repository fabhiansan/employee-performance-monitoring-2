import { useState } from 'react';
import { FileImport } from './components/FileImport';
import { RatingMappingConfig } from './components/RatingMappingConfig';
import type { CSVPreview, CreateRatingMapping, ImportResult, ParsedEmployee, ParsedScore } from './types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Database } from 'lucide-react';
import iconUrl from '@assets/icon.png';
import { parseEmployeeCSV, parseScoresCSV, importDataset } from '@/lib/api';

type ImportStep = 'select' | 'preview' | 'mapping' | 'importing' | 'complete';

function App() {
  const [step, setStep] = useState<ImportStep>('select');
  const [preview, setPreview] = useState<CSVPreview | null>(null);
  const [filePath, setFilePath] = useState<string | File | null>(null);
  const [employees, setEmployees] = useState<ParsedEmployee[]>([]);
  const [scores, setScores] = useState<ParsedScore[]>([]);
  const [uniqueScoreValues, setUniqueScoreValues] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleFileSelected = (path: string | File, csvPreview: CSVPreview) => {
    setFilePath(path);
    setPreview(csvPreview);
    setStep('preview');
  };

  const handleContinueImport = async () => {
    if (!filePath) return;

    try {
      setError(null);
      setProgress(10);

      // Parse employees and scores from CSV
      const [parsedEmployees, parsedScores] = await Promise.all([
        parseEmployeeCSV(filePath),
        parseScoresCSV(filePath),
      ]);

      setProgress(30);
      setEmployees(parsedEmployees);
      setScores(parsedScores);

      // Extract unique score values for mapping
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
    if (!filePath) return;

    try {
      setError(null);
      setStep('importing');
      setProgress(60);

      const datasetName = `Import ${new Date().toLocaleString()}`;
      const fileName = filePath instanceof File ? filePath.name : filePath.split('/').pop();
      const sourceFile = filePath instanceof File ? filePath.name : filePath;
      const result = await importDataset({
        dataset_name: datasetName,
        dataset_description: `Imported from ${fileName}`,
        source_file: sourceFile,
        employees,
        scores,
        rating_mappings: mappings,
      });

      setProgress(100);
      setImportResult(result);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import dataset');
      setStep('mapping');
      console.error('Import error:', err);
    }
  };

  const handleStartOver = () => {
    setStep('select');
    setPreview(null);
    setFilePath(null);
    setEmployees([]);
    setScores([]);
    setUniqueScoreValues([]);
    setImportResult(null);
    setError(null);
    setProgress(0);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <img src={iconUrl} alt="Employee Performance Analytics" className="h-12 w-12 rounded-md" />
            <div>
              <h1 className="text-2xl font-bold">
                Employee Performance Analytics
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Import, analyze, and manage employee performance data
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
                <CardTitle>Get Started</CardTitle>
                <CardDescription>
                  Import your employee data CSV file to begin analyzing performance metrics.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FileImport onFileSelected={(path, preview) => {
                  handleFileSelected(path, preview);
                }} />
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-6">
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
                  <Button variant="outline">
                    View Dashboard
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
