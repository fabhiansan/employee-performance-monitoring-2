import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { listEmployees } from '@/lib/api';
import type { EmployeeListResult } from '@/types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, ChevronRight, Users } from 'lucide-react';

export function EmployeeListPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const [data, setData] = useState<EmployeeListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!datasetId) return;

    const fetchEmployees = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listEmployees(
          parseInt(datasetId),
          debouncedSearch || undefined,
          100,
          0
        );
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load employees');
        console.error('Failed to load employees:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchEmployees();
  }, [datasetId, debouncedSearch]);

  const getScoreColor = (score: number) => {
    if (score >= 3) return 'text-green-600 bg-green-50';
    if (score >= 2) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Employees</h1>
          <p className="text-muted-foreground mt-1">
            View and manage employee performance data
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{data.total_count} employees</span>
          </div>
        )}
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Search Employees</CardTitle>
          <CardDescription>Find employees by name</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Employee Table */}
      <Card>
        <CardHeader>
          <CardTitle>Employee Performance</CardTitle>
          <CardDescription>
            {loading ? 'Loading...' : `Showing ${data?.employees.length ?? 0} of ${data?.total_count ?? 0} employees`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !data || data.employees.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No employees found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {search ? 'Try a different search term' : 'Import data to get started'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>NIP</TableHead>
                    <TableHead>Jabatan</TableHead>
                    <TableHead className="text-right">Avg Score</TableHead>
                    <TableHead className="text-right">Scores</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.employees.map((employee) => (
                    <TableRow key={employee.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {employee.nip ?? '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {employee.jabatan ?? '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-semibold ${getScoreColor(
                            employee.average_score
                          )}`}
                        >
                          {employee.average_score.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {employee.score_count}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="h-8 w-8 p-0"
                        >
                          <Link to={`/employees/${datasetId}/${employee.id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
