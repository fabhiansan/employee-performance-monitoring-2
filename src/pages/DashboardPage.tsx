import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getDatasetStats, exportDataset, isTauri } from '@/lib/api';
import type { DatasetStats } from '@/types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { Users, FileText, TrendingUp, Award, Download } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart';

export function DashboardPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    if (!datasetId) return;

    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getDatasetStats(parseInt(datasetId));
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal memuat statistik');
        console.error('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchStats();
  }, [datasetId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? 'Data tidak tersedia'}</AlertDescription>
      </Alert>
    );
  }

  const exportFeedback = exportError ?? exportMessage;

  const bestCompetency = stats.competency_stats.reduce<DatasetStats['competency_stats'][number] | null>((best, current) => {
    if (!best || current.average_score > best.average_score) {
      return current;
    }
    return best;
  }, null);

  const weakestCompetency = stats.competency_stats.reduce<DatasetStats['competency_stats'][number] | null>((worst, current) => {
    if (!worst || current.average_score < worst.average_score) {
      return current;
    }
    return worst;
  }, null);

  const mostEvaluatedCompetency = stats.competency_stats.reduce<DatasetStats['competency_stats'][number] | null>((most, current) => {
    if (!most || current.employee_count > most.employee_count) {
      return current;
    }
    return most;
  }, null);

  const dominantScoreRange = stats.score_distribution.reduce<DatasetStats['score_distribution'][number] | null>((most, current) => {
    if (!most || current.count > most.count) {
      return current;
    }
    return most;
  }, null);

  const insightItems: { title: string; value: string; description: string }[] = [];

  if (bestCompetency) {
    insightItems.push({
      title: 'Kompetensi Teratas',
      value: bestCompetency.competency.name,
      description: `Skor rata-rata ${bestCompetency.average_score.toFixed(2)}`,
    });
  }

  if (weakestCompetency) {
    insightItems.push({
      title: 'Butuh Perhatian',
      value: weakestCompetency.competency.name,
      description: `Skor rata-rata ${weakestCompetency.average_score.toFixed(2)}`,
    });
  }

  if (mostEvaluatedCompetency) {
    insightItems.push({
      title: 'Paling Banyak Dinilai',
      value: mostEvaluatedCompetency.competency.name,
      description: `${mostEvaluatedCompetency.employee_count} pegawai dinilai`,
    });
  }

  if (dominantScoreRange) {
    insightItems.push({
      title: 'Rentang Peringkat Umum',
      value: dominantScoreRange.range,
      description: `${dominantScoreRange.count} pegawai dalam rentang ini`,
    });
  }

  const scoreDistributionConfig: ChartConfig = {
    count: {
      label: 'Pegawai',
      color: 'hsl(var(--chart-1))',
    },
  };

  const competencyChartData = stats.competency_stats.map((stat) => ({
    ...stat,
    roundedAverage: Number(stat.average_score.toFixed(2)),
  }));

  const maxAverageScore = competencyChartData.reduce((max, stat) => (
    stat.roundedAverage > max ? stat.roundedAverage : max
  ), 0);

  const competencyAxisMax = maxAverageScore === 0
    ? 5
    : Math.ceil(maxAverageScore / 5) * 5;

  const formatAxisNumber = (value: number) => {
    if (value >= 100) {
      return value.toLocaleString('id-ID', { maximumFractionDigits: 0 });
    }
    if (value >= 10) {
      return value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
    }
    return value.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  };

  interface CompetencyTickProps {
    x?: number;
    y?: number;
    payload?: {
      value?: unknown;
    };
  }

  const renderCompetencyTick = (props: CompetencyTickProps) => {
    const { x = 0, y = 0, payload } = props;
    const rawValue = payload?.value;
    const valueText = typeof rawValue === 'string'
      ? rawValue
      : typeof rawValue === 'number'
        ? rawValue.toString()
        : '';

    const words = valueText.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';
    const maxChars = 24;

    words.forEach((word) => {
      const prospective = currentLine.length === 0
        ? word
        : `${currentLine} ${word}`;

      if (prospective.length > maxChars) {
        if (currentLine.length > 0) {
          lines.push(currentLine);
        }
        currentLine = word;
      } else {
        currentLine = prospective;
      }
    });

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return (
      <text x={x} y={y} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize={12}>
        {lines.map((line, index) => (
          <tspan key={index} x={x} dy={index === 0 ? 0 : 14}>
            {line}
          </tspan>
        ))}
      </text>
    );
  };

  const competencyAverageConfig: ChartConfig = {
    roundedAverage: {
      label: 'Skor Rata-rata',
      color: 'hsl(var(--chart-2))',
    },
  };

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!datasetId || !isTauri()) return;
    try {
      setExportLoading(true);
      setExportError(null);
      setExportMessage(null);
      const extension = format === 'xlsx' ? 'xlsx' : format;
      const filePath = await save({
        title: 'Ekspor Dataset',
        defaultPath: `${stats.dataset.name.replace(/\s+/g, '_').toLowerCase()}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!filePath) {
        setExportLoading(false);
        return;
      }
      await exportDataset(parseInt(datasetId), format, filePath);
      setExportMessage(`Dataset diekspor sebagai ${extension.toUpperCase()}.`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Gagal mengekspor dataset');
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{stats.dataset.name}</h1>
        <p className="text-muted-foreground mt-1">
          {stats.dataset.description ?? 'Dasbor analitik kinerja'}
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Pegawai</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_employees}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Di semua kompetensi
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Skor Rata-rata</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.average_score.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Peringkat kinerja keseluruhan
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Kompetensi</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_competencies}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Keterampilan dinilai
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Skor</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_scores}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Catatan kinerja
            </p>
          </CardContent>
        </Card>
      </div>

      {insightItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Wawasan</CardTitle>
            <CardDescription>Sorotan yang berasal dari dataset saat ini</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {insightItems.map((item) => (
                <div key={item.title} className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs uppercase text-muted-foreground">{item.title}</p>
                  <p className="mt-2 text-lg font-semibold leading-tight">{item.value}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Distribusi Skor</CardTitle>
            <CardDescription>Distribusi peringkat kinerja pegawai</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={scoreDistributionConfig} className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.score_distribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" />
                  <YAxis allowDecimals={false} />
                  <ChartTooltip cursor={{ fillOpacity: 0.08 }} />
                  <ChartLegend />
                  <Bar dataKey="count" fill="var(--color-count)" name="Pegawai" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Competency Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Kinerja Kompetensi</CardTitle>
            <CardDescription>Skor rata-rata berdasarkan kompetensi</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={competencyAverageConfig} className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={competencyChartData.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
                  barCategoryGap={12}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, competencyAxisMax]}
                    tickFormatter={formatAxisNumber}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    dataKey="competency.name"
                    type="category"
                    width={220}
                    tickLine={false}
                    axisLine={false}
                    tick={renderCompetencyTick}
                  />
                  <ChartTooltip
                    cursor={{ fillOpacity: 0.08 }}
                    formatter={(value: number, name: string) => [
                      Number(value).toLocaleString('id-ID', { maximumFractionDigits: 2 }),
                      name,
                    ]}
                  />
                  <ChartLegend />
                  <Bar
                    dataKey="roundedAverage"
                    fill="var(--color-roundedAverage)"
                    name="Skor Rata-rata"
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Competency Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detail Kompetensi</CardTitle>
          <CardDescription>Rincian kinerja berdasarkan kompetensi</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Kompetensi</th>
                  <th className="p-3 text-right font-medium">Skor Rata-rata</th>
                  <th className="p-3 text-right font-medium">Jumlah Pegawai</th>
                </tr>
              </thead>
              <tbody>
                {stats.competency_stats.map((stat) => (
                  <tr key={stat.competency.id} className="border-b last:border-0">
                    <td className="p-3">{stat.competency.name}</td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${
                        stat.average_score >= 3 ? 'text-green-600' :
                        stat.average_score >= 2 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {stat.average_score.toFixed(2)}
                      </span>
                    </td>
                    <td className="p-3 text-right">{stat.employee_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Tindakan Cepat</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button asChild>
              <Link to={`/employees/${datasetId}`}>
                <Users className="mr-2 h-4 w-4" />
                Lihat Semua Pegawai
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/import">
                <FileText className="mr-2 h-4 w-4" />
                Impor Dataset Baru
              </Link>
            </Button>
            {isTauri() && (
              <>
                <Button
                  variant="outline"
                  disabled={exportLoading}
                  onClick={() => void handleExport('csv')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Ekspor CSV
                </Button>
                <Button
                  variant="outline"
                  disabled={exportLoading}
                  onClick={() => void handleExport('xlsx')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Ekspor Excel
                </Button>
                <Button
                  variant="outline"
                  disabled={exportLoading}
                  onClick={() => void handleExport('pdf')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Ekspor PDF
                </Button>
              </>
            )}
          </div>
          {exportFeedback && (
            <Alert className="mt-4" variant={exportError ? 'destructive' : 'default'}>
              <AlertDescription>{exportFeedback}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
