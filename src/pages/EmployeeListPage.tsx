import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { listAllEmployees, listEmployees, bulkDeleteEmployees, bulkUpdateEmployees } from '@/lib/api';
import type { Employee, EmployeeListResult, EmployeeWithStats } from '@/types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, ChevronRight, Users } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function EmployeeListPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const [data, setData] = useState<EmployeeListResult | null>(null);
  const [masterEmployees, setMasterEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  const [bulkJabatan, setBulkJabatan] = useState('');
  const [bulkSubJabatan, setBulkSubJabatan] = useState('');
  const isDatasetView = Boolean(datasetId);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!datasetId) return;

    const parsed = Number(datasetId);
    if (!Number.isFinite(parsed)) {
      setError('ID dataset tidak valid');
      setLoading(false);
      return;
    }

    const fetchEmployees = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listEmployees(
          parsed,
          debouncedSearch || undefined,
          pageSize,
          page * pageSize
        );
        setData(result);
        setSelectedIds([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal memuat pegawai');
        setData(null);
        console.error('Failed to load employees:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchEmployees();
  }, [datasetId, debouncedSearch, pageSize, page, refreshTick]);

  useEffect(() => {
    // Reset page when search changes
    setPage(0);
  }, [debouncedSearch, datasetId]);

  useEffect(() => {
    if (datasetId) return;

    const fetchMaster = async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await listAllEmployees();
        setMasterEmployees(list);
        setSelectedIds([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal memuat pegawai');
        setMasterEmployees([]);
        console.error('Failed to load employees:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchMaster();
  }, [datasetId]);

  const filteredMasterEmployees = useMemo(() => {
    if (isDatasetView) return [];
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return masterEmployees;
    return masterEmployees.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.nip ? e.nip.toLowerCase().includes(q) : false) ||
      (e.jabatan ? e.jabatan.toLowerCase().includes(q) : false) ||
      (e.sub_jabatan ? e.sub_jabatan.toLowerCase().includes(q) : false)
    );
  }, [debouncedSearch, isDatasetView, masterEmployees]);

  const getScoreColor = (score: number) => {
    if (score >= 3) return 'text-green-600 bg-green-50';
    if (score >= 2) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getPositionStatus = (jabatan?: string | null, sub?: string | null, gol?: string | null) => {
    const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, '');

    const STAFF_KEYWORDS = ['staff', 'staf'];
    const ESELON_KEYWORDS = [
      'eselon',
      'kepala',
      'sekretaris',
      'kabid',
      'kabag',
      'kasubag',
      'kepala seksi',
      'kasi',
      'koordinator',
      'pengawas',
      'sub bagian',
      'subbagian',
      'subbidang',
      'sub bidang',
    ];

    const combined = `${jabatan ?? ''} ${sub ?? ''}`;
    const normalized = normalize(combined);
    if (normalized) {
      if (STAFF_KEYWORDS.map(normalize).some((k) => normalized.includes(k))) return 'Staf';
      if (ESELON_KEYWORDS.map(normalize).some((k) => normalized.includes(k))) return 'Eselon';
    }
    const golUpper = (gol ?? '').trim().toUpperCase();
    if (golUpper.startsWith('IV')) return 'Eselon';
    return 'Staf';
  };

  const currentPageEmployees = useMemo(() => {
    if (isDatasetView) return data?.employees ?? [];
    const start = page * pageSize;
    const end = start + pageSize;
    return filteredMasterEmployees.slice(start, end);
  }, [isDatasetView, data, filteredMasterEmployees, page, pageSize]);

  const totalCount = isDatasetView ? (data?.total_count ?? 0) : filteredMasterEmployees.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const allVisibleSelected = currentPageEmployees.every((e) => selectedIds.includes(e.id));

  const hasStats = (e: Employee | EmployeeWithStats): e is EmployeeWithStats =>
    'average_score' in e && 'score_count' in e;

  const toggleSelectAllVisible = (checked: boolean) => {
    const ids = currentPageEmployees.map((e) => e.id);
    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    } else {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    }
  };

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      setLoading(true);
      await bulkDeleteEmployees(selectedIds);
      setSelectedIds([]);
      if (isDatasetView) {
        setRefreshTick((x) => x + 1);
      } else {
        const list = await listAllEmployees();
        setMasterEmployees(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus pegawai');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmBulkUpdate = async () => {
    const updates = selectedIds.map((id) => ({
      id,
      jabatan: bulkJabatan === '' ? undefined : bulkJabatan || null,
      sub_jabatan: bulkSubJabatan === '' ? undefined : bulkSubJabatan || null,
    }));
    try {
      setLoading(true);
      await bulkUpdateEmployees(updates);
      setShowBulkUpdate(false);
      setBulkJabatan('');
      setBulkSubJabatan('');
      if (isDatasetView) {
        setRefreshTick((x) => x + 1);
      } else {
        const list = await listAllEmployees();
        setMasterEmployees(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui pegawai');
    } finally {
      setLoading(false);
    }
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
          <h1 className="text-3xl font-bold">Pegawai</h1>
          <p className="text-muted-foreground mt-1">
            Lihat dan kelola data kinerja pegawai
          </p>
        </div>
        {(isDatasetView ? Boolean(data) : masterEmployees.length > 0) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>
              {isDatasetView ? (data?.total_count ?? 0) : masterEmployees.length} pegawai
            </span>
          </div>
        )}
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Cari Pegawai</CardTitle>
          <CardDescription>Temukan pegawai berdasarkan nama</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Cari berdasarkan nama..."
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
          <CardTitle>{isDatasetView ? 'Kinerja Pegawai' : 'Pegawai'}</CardTitle>
          <CardDescription>
            {loading
              ? 'Memuat...'
              : `Menampilkan ${currentPageEmployees.length} dari ${totalCount} pegawai`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3 mb-3">
            {selectedIds.length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{selectedIds.length} dipilih</span>
                <Button variant="destructive" size="sm" onClick={() => void handleBulkDelete()} disabled={loading}>
                  Hapus yang Dipilih
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowBulkUpdate(true)} disabled={loading}>
                  Perbarui Massal
                </Button>
              </div>
            ) : <div />}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Baris per halaman</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
                <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10,25,50,100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Sebelumnya</Button>
                <span className="text-sm text-muted-foreground">Halaman {page + 1} / {pageCount}</span>
                <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : currentPageEmployees.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">Tidak ada pegawai yang ditemukan</p>
              <p className="text-sm text-muted-foreground mt-1">
                {search ? 'Coba istilah pencarian yang berbeda' : 'Impor data induk pegawai untuk memulai'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={currentPageEmployees.length > 0 && allVisibleSelected}
                        onChange={(e) => toggleSelectAllVisible(e.currentTarget.checked)}
                      />
                    </TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>NIP</TableHead>
                    <TableHead>Jabatan</TableHead>
                    <TableHead>Status</TableHead>
                    {isDatasetView && (
                      <>
                        <TableHead className="text-right">Skor Rata-rata</TableHead>
                        <TableHead className="text-right">Skor</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentPageEmployees.map((employee) => (
                    <TableRow key={employee.id} className="hover:bg-muted/50">
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={selectedIds.includes(employee.id)}
                          onChange={(e) => toggleSelectOne(employee.id, e.currentTarget.checked)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {employee.nip ?? '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {employee.jabatan ?? '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {getPositionStatus(employee.jabatan, employee.sub_jabatan, employee.gol)}
                      </TableCell>
                      {isDatasetView && hasStats(employee) && (
                        <>
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
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showBulkUpdate} onOpenChange={(open) => setShowBulkUpdate(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Perbarui Massal Pegawai</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Biarkan bidang kosong untuk mempertahankan nilai yang ada. Pembaruan berlaku untuk {selectedIds.length} pegawai yang dipilih.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Jabatan</label>
                <Input value={bulkJabatan} onChange={(e) => setBulkJabatan(e.target.value)} placeholder="e.g., Kepala Seksi" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Sub Jabatan</label>
                <Input value={bulkSubJabatan} onChange={(e) => setBulkSubJabatan(e.target.value)} placeholder="e.g., Administrasi" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkUpdate(false)}>Batal</Button>
            <Button onClick={() => void handleConfirmBulkUpdate()} disabled={loading}>Terapkan Pembaruan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
