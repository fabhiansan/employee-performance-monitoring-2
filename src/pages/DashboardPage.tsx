import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboardOverview } from '@/lib/api';
import type { DashboardOverview } from '@/types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { Users, Database, TrendingUp, Award, ArrowUpRight } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart';

function formatNumber(value: number): string {
  return value.toLocaleString('id-ID');
}

export function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getDashboardOverview();
        setOverview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal memuat ringkasan');
        console.error('Failed to load overview:', err);
      } finally {
        setLoading(false);
      }
    };

    void loadOverview();
  }, []);

  const scoreDistributionConfig: ChartConfig = useMemo(() => ({
    count: {
      label: 'Pegawai',
      color: 'hsl(var(--chart-1))',
    },
  }), []);

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

  if (error || !overview) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? 'Data ringkasan tidak tersedia'}</AlertDescription>
      </Alert>
    );
  }

  const keyMetrics = [
    {
      title: 'Total Dataset',
      value: formatNumber(overview.total_datasets),
      description: 'Kumpulan data kinerja yang tersedia',
      icon: Database,
    },
    {
      title: 'Total Pegawai',
      value: formatNumber(overview.total_employees),
      description: 'Pegawai unik yang terekam',
      icon: Users,
    },
    {
      title: 'Kompetensi Dinilai',
      value: formatNumber(overview.total_competencies),
      description: 'Kompetensi dari seluruh dataset',
      icon: Award,
    },
    {
      title: 'Rata-rata Skor',
      value: overview.average_score.toFixed(2),
      description: 'Akumulasi rata-rata semua skor',
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dasbor Organisasi</h1>
        <p className="text-muted-foreground mt-1">
          Gambaran umum seluruh dataset kinerja pegawai.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {keyMetrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Distribusi Skor</CardTitle>
            <CardDescription>Persebaran peringkat kinerja seluruh pegawai</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={scoreDistributionConfig} className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overview.score_distribution}>
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

        <Card>
          <CardHeader>
            <CardTitle>Kompetensi Teratas</CardTitle>
            <CardDescription>Delapan kompetensi dengan skor rata-rata tertinggi</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.competency_overview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada kompetensi dengan skor numerik.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kompetensi</TableHead>
                      <TableHead className="text-right">Dataset</TableHead>
                      <TableHead className="text-right">Total Skor</TableHead>
                      <TableHead className="text-right">Rata-rata</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.competency_overview.map((item) => (
                      <TableRow key={item.competency.id}>
                        <TableCell>{item.competency.name}</TableCell>
                        <TableCell className="text-right">{formatNumber(item.dataset_count)}</TableCell>
                        <TableCell className="text-right">{formatNumber(item.score_count)}</TableCell>
                        <TableCell className="text-right">{item.average_score.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Dataset Unggulan</CardTitle>
            <CardDescription>Lima dataset dengan skor rata-rata tertinggi</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.top_datasets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada dataset yang dapat ditampilkan.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dataset</TableHead>
                      <TableHead className="text-right">Pegawai</TableHead>
                      <TableHead className="text-right">Skor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.top_datasets.map((item) => (
                      <TableRow key={item.dataset.id}>
                        <TableCell>
                          <Link
                            to={`/datasets/${item.dataset.id}`}
                            className="flex items-center gap-2 text-foreground hover:text-primary"
                          >
                            <span>{item.dataset.name}</span>
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(item.total_employees)}</TableCell>
                        <TableCell className="text-right">{item.average_score.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dataset Terbaru</CardTitle>
            <CardDescription>Lima dataset terakhir yang ditambahkan</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.recent_datasets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada dataset yang ditambahkan.</p>
            ) : (
              <ul className="space-y-4">
                {overview.recent_datasets.map((item) => (
                  <li key={item.dataset.id} className="flex items-start justify-between gap-4">
                    <div>
                      <Link
                        to={`/datasets/${item.dataset.id}`}
                        className="text-sm font-medium text-foreground hover:text-primary"
                      >
                        {item.dataset.name}
                      </Link>
                      {item.dataset.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.dataset.description}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground text-right whitespace-nowrap">
                      {new Date(item.dataset.created_at).toLocaleString('id-ID')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
