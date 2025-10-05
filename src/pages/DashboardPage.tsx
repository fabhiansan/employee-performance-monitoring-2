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
        setError(err instanceof Error ? err.message : 'Failed to load stats');
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
        <AlertDescription>{error ?? 'No data available'}</AlertDescription>
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
      title: 'Top Competency',
      value: bestCompetency.competency.name,
      description: `Average score ${bestCompetency.average_score.toFixed(2)}`,
    });
  }

  if (weakestCompetency) {
    insightItems.push({
      title: 'Needs Attention',
      value: weakestCompetency.competency.name,
      description: `Average score ${weakestCompetency.average_score.toFixed(2)}`,
    });
  }

  if (mostEvaluatedCompetency) {
    insightItems.push({
      title: 'Most Assessed',
      value: mostEvaluatedCompetency.competency.name,
      description: `${mostEvaluatedCompetency.employee_count} employees evaluated`,
    });
  }

  if (dominantScoreRange) {
    insightItems.push({
      title: 'Common Rating Band',
      value: dominantScoreRange.range,
      description: `${dominantScoreRange.count} employees in this range`,
    });
  }

  const scoreDistributionConfig: ChartConfig = {
    count: {
      label: 'Employees',
      color: 'hsl(var(--chart-1))',
    },
  };

  const competencyAverageConfig: ChartConfig = {
    average_score: {
      label: 'Average Score',
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
        title: 'Export Dataset',
        defaultPath: `${stats.dataset.name.replace(/\s+/g, '_').toLowerCase()}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!filePath) {
        setExportLoading(false);
        return;
      }
      await exportDataset(parseInt(datasetId), format, filePath);
      setExportMessage(`Dataset exported as ${extension.toUpperCase()}.`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export dataset');
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{stats.dataset.name}</h1>
        <p className="text-muted-foreground mt-1">
          {stats.dataset.description ?? 'Performance analytics dashboard'}
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_employees}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Across all competencies
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.average_score.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Overall performance rating
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Competencies</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_competencies}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Skills assessed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Scores</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_scores}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Performance records
            </p>
          </CardContent>
        </Card>
      </div>

      {insightItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Insights</CardTitle>
            <CardDescription>Highlights derived from the current dataset</CardDescription>
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
            <CardTitle>Score Distribution</CardTitle>
            <CardDescription>Distribution of employee performance ratings</CardDescription>
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
                  <Bar dataKey="count" fill="var(--color-count)" name="Employees" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Competency Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Competency Performance</CardTitle>
            <CardDescription>Average scores by competency</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={competencyAverageConfig} className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.competency_stats.slice(0, 8)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 4]} />
                  <YAxis dataKey="competency.name" type="category" width={140} />
                  <ChartTooltip cursor={{ fillOpacity: 0.08 }} />
                  <ChartLegend />
                  <Bar dataKey="average_score" fill="var(--color-average_score)" name="Avg Score" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Competency Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>Competency Details</CardTitle>
          <CardDescription>Detailed performance breakdown by competency</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Competency</th>
                  <th className="p-3 text-right font-medium">Average Score</th>
                  <th className="p-3 text-right font-medium">Employee Count</th>
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
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button asChild>
              <Link to={`/employees/${datasetId}`}>
                <Users className="mr-2 h-4 w-4" />
                View All Employees
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/import">
                <FileText className="mr-2 h-4 w-4" />
                Import New Dataset
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
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  disabled={exportLoading}
                  onClick={() => void handleExport('xlsx')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export Excel
                </Button>
                <Button
                  variant="outline"
                  disabled={exportLoading}
                  onClick={() => void handleExport('pdf')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export PDF
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
