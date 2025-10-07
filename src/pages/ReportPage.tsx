import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listEmployees, getEmployeePerformance, exportEmployeeReport, isTauri } from '@/lib/api';
import type {
  EmployeeListResult,
  EmployeePerformance,
  EmployeeWithStats,
  ScoreWithCompetency,
} from '@/types/models';
import type { CompetencyScore, EmployeeScoreRecap } from '@/types/scoring';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useDatasets } from '@/lib/dataset-context';
import { generateEmployeeRecap } from '@/services/scoringService';
import { Download, FileText, Info, Award, User2 } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';

interface CompetencyDetail {
  id: number;
  name: string;
  normalizedScore: number;
  originalScore: number;
}

interface ReportComputation {
  performance: EmployeePerformance;
  recap: EmployeeScoreRecap;
  competencies: CompetencyDetail[];
  normalizationScale: number;
}

const PERILAKU_CAP = 25.5;
const KUALITAS_CAP = {
  eselon: 42.5,
  staff: 70,
} as const;
const LEADERSHIP_CAP = 20;
const TOTAL_CAP = 85;

const RATING_BANDS = [
  { label: 'Sangat Baik', threshold: '≥ 80.00' },
  { label: 'Baik', threshold: '70.00 – 79.99' },
  { label: 'Kurang Baik', threshold: '60.00 – 69.99' },
  { label: 'Perlu Pembinaan', threshold: '< 60.00' },
];

const SCORE_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

function parseNumericScore(score: ScoreWithCompetency): number {
  if (typeof score.score.numeric_value === 'number' && !Number.isNaN(score.score.numeric_value)) {
    return score.score.numeric_value;
  }
  const parsed = parseFloat(score.score.raw_value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function determineScale(values: number[]): number {
  const max = values.reduce((current, value) => Math.max(current, value), 0);
  if (max <= 0) {
    return 100;
  }
  if (max <= 5) {
    return 4;
  }
  if (max <= 10) {
    return 10;
  }
  if (max <= 20) {
    return 20;
  }
  if (max <= 100) {
    return 100;
  }
  return max;
}

function toNormalizedCompetencies(scores: ScoreWithCompetency[]): {
  competencies: CompetencyDetail[];
  normalizationScale: number;
  recapScores: CompetencyScore[];
} {
  const originalValues = scores.map(parseNumericScore);
  const normalizationScale = determineScale(originalValues);
  const competencies = scores.map((entry, index) => {
    const original = originalValues[index] ?? 0;
    const normalized = normalizationScale <= 0
      ? 0
      : Math.max(0, Math.min(100, (original / normalizationScale) * 100));
    return {
      id: entry.competency.id,
      name: entry.competency.name,
      originalScore: original,
      normalizedScore: normalized,
    } satisfies CompetencyDetail;
  });

  const recapScores: CompetencyScore[] = competencies.map((detail) => ({
    competencyId: detail.id,
    name: detail.name,
    rawScore: detail.normalizedScore,
  }));

  return { competencies, normalizationScale, recapScores };
}

function formatScore(value: number): string {
  return value.toLocaleString('id-ID', SCORE_FORMAT);
}

export function ReportPage() {
  const { datasetId, employeeId: routeEmployeeId } = useParams<{
    datasetId?: string;
    employeeId?: string;
  }>();
  const navigate = useNavigate();
  const { selectedDataset } = useDatasets();

  const [employeesResult, setEmployeesResult] = useState<EmployeeListResult | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(routeEmployeeId ?? null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportComputation | null>(null);

  const [exportStatus, setExportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedEmployeeId(routeEmployeeId ?? null);
  }, [routeEmployeeId]);

  useEffect(() => {
    if (!datasetId) {
      setEmployeesResult(null);
      return;
    }

    let cancelled = false;
    const numericDataset = Number(datasetId);
    if (!Number.isFinite(numericDataset)) {
      setEmployeesError('Invalid dataset identifier.');
      setEmployeesResult(null);
      return;
    }

    setEmployeesLoading(true);
    setEmployeesError(null);

    void listEmployees(numericDataset, undefined, 500, 0)
      .then((result) => {
        if (cancelled) return;
        setEmployeesResult(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEmployeesError(err instanceof Error ? err.message : 'Failed to load employees');
        setEmployeesResult(null);
      })
      .finally(() => {
        if (!cancelled) {
          setEmployeesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId || !selectedEmployeeId) {
      setReportData(null);
      return;
    }

    const numericDataset = Number(datasetId);
    const numericEmployee = Number(selectedEmployeeId);
    if (!Number.isFinite(numericDataset) || !Number.isFinite(numericEmployee)) {
      setReportError('Invalid identifier provided.');
      setReportData(null);
      return;
    }

    let cancelled = false;
    setReportLoading(true);
    setReportError(null);

    void getEmployeePerformance(numericDataset, numericEmployee)
      .then((performance) => {
        if (cancelled) return;
        const { competencies, recapScores, normalizationScale } = toNormalizedCompetencies(performance.scores);
        const recap = generateEmployeeRecap(performance.employee, recapScores);
        setReportData({
          performance,
          recap,
          competencies,
          normalizationScale,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReportError(err instanceof Error ? err.message : 'Failed to load performance data');
        setReportData(null);
      })
      .finally(() => {
        if (!cancelled) {
          setReportLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [datasetId, selectedEmployeeId]);

  useEffect(() => {
    if (!datasetId || !employeesResult || !selectedEmployeeId) {
      return;
    }
    const exists = employeesResult.employees.some((entry) => entry.id === Number(selectedEmployeeId));
    if (!exists) {
      setSelectedEmployeeId(null);
      if (routeEmployeeId) {
        void navigate(`/report/${datasetId}`, { replace: true });
      }
    }
  }, [datasetId, employeesResult, navigate, routeEmployeeId, selectedEmployeeId]);

  const employees: EmployeeWithStats[] = employeesResult?.employees ?? [];
  const componentSections = useMemo(() => {
    if (!reportData) return [];
    const { recap } = reportData;
    const kualitasCap = recap.positionType === 'eselon' ? KUALITAS_CAP.eselon : KUALITAS_CAP.staff;

    const sections = [
      {
        id: 'perilaku',
        title: 'Perilaku Kerja (30%)',
        cap: PERILAKU_CAP,
        subtotal: recap.perilakuKinerja.subtotal,
        breakdown: recap.perilakuKinerja.breakdown,
      },
      {
        id: 'kualitas',
        title: 'Kualitas Kerja',
        cap: kualitasCap,
        subtotal: recap.kualitasKerja.subtotal,
        breakdown: recap.kualitasKerja.breakdown,
      },
    ];

    if (recap.penilaianPimpinan) {
      sections.push({
        id: 'leadership',
        title: 'Penilaian Pimpinan',
        cap: LEADERSHIP_CAP,
        subtotal: recap.penilaianPimpinan.weightedScore,
        breakdown: [
          {
            parameter: recap.penilaianPimpinan.applied ? 'Nilai Pimpinan' : 'Tidak diaplikasikan',
            rawScore: recap.penilaianPimpinan.rawScore,
            weightPercentage: 20,
            weightedScore: recap.penilaianPimpinan.weightedScore,
          },
        ],
      });
    }

    return sections;
  }, [reportData]);

  const handleEmployeeChange = (value: string) => {
    if (!datasetId) return;
    setSelectedEmployeeId(value);
    void navigate(`/report/${datasetId}/${value}`);
  };

  const handleExport = async () => {
    if (!datasetId || !selectedEmployeeId || !reportData || !isTauri()) {
      return;
    }
    try {
      setExportStatus('loading');
      setExportMessage(null);
      const employeeName = reportData.performance.employee.name.replace(/\s+/g, '_').toLowerCase();
      const filePath = await save({
        title: 'Export Employee Report',
        defaultPath: `report-${employeeName}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!filePath) {
        setExportStatus('idle');
        return;
      }
      await exportEmployeeReport(Number(datasetId), Number(selectedEmployeeId), filePath);
      setExportStatus('success');
      setExportMessage('Report exported successfully.');
    } catch (error) {
      console.error('Failed to export report:', error);
      setExportStatus('error');
      setExportMessage(error instanceof Error ? error.message : 'Failed to export report');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileText className="h-8 w-8 text-primary" />
          Pembuat Laporan
        </h1>
        <p className="text-muted-foreground mt-2">
          Pilih seorang pegawai untuk membuat laporan kinerja terstruktur dan mengekspornya ke PDF.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parameter Laporan</CardTitle>
          <CardDescription>
            Pilih seorang pegawai dari dataset aktif{selectedDataset ? ` “${selectedDataset.name}”` : ''} untuk membuat laporan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {employeesError && (
            <Alert variant="destructive">
              <AlertDescription>{employeesError}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Pegawai</span>
              {employeesLoading ? (
                <Skeleton className="h-10" />
              ) : employees.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Tidak ada pegawai yang ditemukan di dataset ini.
                </div>
              ) : (
                <Select value={selectedEmployeeId ?? undefined} onValueChange={handleEmployeeChange}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Pilih seorang pegawai" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {employees.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id.toString()}>
                        <div className="flex flex-col">
                          <span className="font-medium">{entry.name}</span>
                          <span className="text-xs text-muted-foreground">
                            NIP: {entry.nip ?? 'N/A'} • Rata-rata {formatScore(entry.average_score)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Dataset</span>
              <div className="rounded-md border bg-muted/40 p-4 text-sm">
                <p className="font-medium">{selectedDataset?.name ?? 'Tidak ada dataset yang dipilih'}</p>
                <p className="text-muted-foreground">
                  {selectedDataset?.description ?? 'Deskripsi dataset tidak tersedia.'}
                </p>
              </div>
            </div>
          </div>
          {isTauri() ? (
            <Button
              onClick={() => void handleExport()}
              disabled={!selectedEmployeeId || !reportData || exportStatus === 'loading'}
            >
              <Download className="h-4 w-4 mr-2" />
              Ekspor PDF
            </Button>
          ) : (
            <Alert>
              <AlertDescription>
                Ekspor PDF tersedia di aplikasi desktop.
              </AlertDescription>
            </Alert>
          )}
          {exportMessage && (
            <Alert variant={exportStatus === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{exportMessage}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {reportError && (
        <Alert variant="destructive">
          <AlertDescription>{reportError}</AlertDescription>
        </Alert>
      )}

      {reportLoading && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-96" />
          </CardContent>
        </Card>
      )}

      {!reportLoading && selectedEmployeeId && !reportData && !reportError && (
        <Alert>
          <AlertDescription>Tidak ada data kinerja yang tersedia untuk pegawai ini.</AlertDescription>
        </Alert>
      )}

      {!selectedEmployeeId && employees.length > 0 && (
        <Alert>
          <AlertDescription>
            Pilih seorang pegawai untuk melihat pratinjau struktur laporan dan mengekspornya sebagai PDF.
          </AlertDescription>
        </Alert>
      )}

      {reportData && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/40">
            <CardTitle className="flex items-center gap-2">
              <User2 className="h-5 w-5" />
              {reportData.performance.employee.name}
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-3 text-sm">
              <span>NIP: {reportData.performance.employee.nip ?? 'N/A'}</span>
              <span>Jabatan: {reportData.performance.employee.jabatan ?? 'N/A'}</span>
              {reportData.performance.employee.sub_jabatan && (
                <span>Sub Jabatan: {reportData.performance.employee.sub_jabatan}</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid lg:grid-cols-[260px_1fr]">
              <div className="border-r space-y-6 p-6">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Dataset</p>
                  <p className="text-sm font-medium">{selectedDataset?.name ?? 'Tanpa nama'}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedDataset?.description ?? 'Tidak ada deskripsi dataset.'}
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Ringkasan</p>
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Total Nilai</span>
                      <span className="font-semibold">{formatScore(reportData.recap.totalNilai)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Predikat</span>
                      <span className="font-semibold">{reportData.recap.rating}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Posisi</span>
                      <span className="font-semibold capitalize">{reportData.recap.positionType}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Rata-rata Kompetensi</span>
                      <span className="font-semibold">{formatScore(reportData.performance.average_score)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Award className="h-4 w-4 text-primary" />
                    Rentang Predikat
                  </div>
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    {RATING_BANDS.map((band) => (
                      <div
                        key={band.label}
                        className={`flex items-center justify-between ${band.label === reportData.recap.rating ? 'font-semibold text-primary' : ''}`}
                      >
                        <span>{band.label}</span>
                        <span>{band.threshold}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Catatan</p>
                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    Skor kompetensi dinormalisasi ke skala 0–100 menggunakan nilai maksimum {formatScore(reportData.normalizationScale)} yang ditemukan pada data asli.
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Kekuatan</p>
                  <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
                    {reportData.performance.strengths.length > 0 ? (
                      reportData.performance.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))
                    ) : (
                      <li className="text-muted-foreground">Belum ada kekuatan utama teridentifikasi.</li>
                    )}
                  </ul>
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Area Pengembangan</p>
                  <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
                    {reportData.performance.gaps.length > 0 ? (
                      reportData.performance.gaps.map((item) => (
                        <li key={item}>{item}</li>
                      ))
                    ) : (
                      <li className="text-muted-foreground">Tidak ada area pengembangan yang tercatat.</li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Ringkasan Komponen Nilai
                  </p>
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/70">
                        <tr>
                          <th className="p-3 text-left font-medium w-12">No</th>
                          <th className="p-3 text-left font-medium">Komponen / Kriteria</th>
                          <th className="p-3 text-right font-medium w-28">Bobot</th>
                          <th className="p-3 text-right font-medium w-28">Nilai</th>
                        </tr>
                      </thead>
                      <tbody>
                        {componentSections.map((section, index) => (
                          <Fragment key={section.id}>
                            <tr className="border-b bg-muted/40">
                              <td className="p-3 align-top text-left font-semibold">{index + 1}</td>
                              <td className="p-3 font-semibold">{section.title}</td>
                              <td className="p-3 text-right font-semibold">{formatScore(section.cap)}</td>
                              <td className="p-3 text-right font-semibold">{formatScore(section.subtotal)}</td>
                            </tr>
                            {section.breakdown.map((row) => (
                              <tr key={`${section.id}-${row.parameter}`} className="border-b last:border-0">
                                <td className="p-2 text-left align-top text-muted-foreground">•</td>
                                <td className="p-2 pr-4">
                                  <div className="flex flex-col">
                                    <span>{row.parameter}</span>
                                    <span className="text-xs text-muted-foreground">
                                      Skor {formatScore(row.rawScore)} (Bobot {formatScore(row.weightPercentage)}%)
                                    </span>
                                  </div>
                                </td>
                                <td className="p-2 text-right text-muted-foreground">{formatScore(row.weightPercentage)}%</td>
                                <td className="p-2 text-right font-medium">{formatScore(row.weightedScore)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                        <tr className="bg-primary/5 font-semibold">
                          <td className="p-3" colSpan={2}>Total Nilai</td>
                          <td className="p-3 text-right">{formatScore(TOTAL_CAP)}</td>
                          <td className="p-3 text-right">{formatScore(reportData.recap.totalNilai)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Info className="h-4 w-4 text-primary" />
                    Nilai Kompetensi Terukur
                  </div>
                  <div className="rounded-lg border p-3 text-sm">
                    {reportData.competencies.length === 0 ? (
                      <p className="text-muted-foreground">Tidak ada data kompetensi numerik.</p>
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {reportData.competencies.slice(0, 8).map((detail) => (
                          <li key={detail.id} className="flex flex-col">
                            <span className="font-medium leading-tight">{detail.name}</span>
                            <span className="text-xs text-muted-foreground">
                              Asli: {formatScore(detail.originalScore)} • Normalisasi: {formatScore(detail.normalizedScore)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
