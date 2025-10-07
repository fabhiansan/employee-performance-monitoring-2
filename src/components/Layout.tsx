import { useEffect, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FileUp, Users, Home, GitCompare, Database, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDatasets } from '@/lib/dataset-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import iconUrl from '@/assets/icon.png';

const navigation = [
  { name: 'Dasbor', href: '/dashboard', icon: Home },
  { name: 'Dataset', href: '/datasets', icon: Database, requiresDataset: true },
  { name: 'Pegawai', href: '/employees', icon: Users, requiresDataset: false },
  { name: 'Bandingkan', href: '/compare', icon: GitCompare },
  { name: 'Laporan', href: '/report', icon: FileText, requiresDataset: true },
  { name: 'Kelola Data', href: '/data-management', icon: Database },
  { name: 'Impor', href: '/import', icon: FileUp },
];

export function Layout() {
  const { datasetId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    datasets,
    selectedDatasetId,
    selectDataset,
    selectedDataset,
    loading,
  } = useDatasets();

  useEffect(() => {
    if (!datasetId) return;
    const parsed = Number(datasetId);
    if (!Number.isFinite(parsed)) return;
    if (selectedDatasetId !== parsed) {
      selectDataset(parsed);
    }
  }, [datasetId, selectDataset, selectedDatasetId]);

  const handleDatasetChange = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    selectDataset(parsed);
    const datasetAwarePrefixes = ['/employees', '/datasets', '/report'];
    const matchedPrefix = datasetAwarePrefixes.find((prefix) =>
      location.pathname.startsWith(prefix)
    );
    const basePath = matchedPrefix ?? '/datasets';
    void navigate(`${basePath}/${parsed}`);
  };

  const navigationItems = useMemo(() => {
    return navigation.map((item) => {
      const requiresDataset = Boolean(item.requiresDataset);
      const datasetPath = selectedDatasetId !== null ? `${item.href}/${selectedDatasetId}` : null;
      const shouldAppendDataset =
        (item.href === '/employees' || item.href === '/datasets' || item.href === '/report') &&
        datasetPath !== null;
      const isDisabled = requiresDataset && !selectedDatasetId;
      const targetHref = shouldAppendDataset
        ? datasetPath
        : requiresDataset && datasetPath
          ? datasetPath
          : item.href;

      const isActive = item.href === '/employees'
        ? location.pathname === item.href || (datasetPath ? location.pathname.startsWith(datasetPath) : false)
        : item.href === '/datasets'
          ? datasetPath ? location.pathname.startsWith(datasetPath) : false
          : requiresDataset && datasetPath
            ? location.pathname.startsWith(datasetPath)
            : location.pathname === item.href;

      return {
        ...item,
        targetHref,
        isDisabled,
        isActive,
      };
    });
  }, [location.pathname, selectedDatasetId]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="flex items-center gap-6 px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <img src={iconUrl} alt="Analitik Kinerja Pegawai" className="h-8 w-8 rounded-md" />
            <div>
              <h1 className="text-xl font-bold">Analitik Kinerja Pegawai</h1>
              <p className="text-xs text-muted-foreground">
                Impor, analisis, dan kelola data kinerja
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Dataset</span>
              <Select
                value={selectedDatasetId ? selectedDatasetId.toString() : undefined}
                onValueChange={handleDatasetChange}
                disabled={loading || datasets.length === 0}
              >
                <SelectTrigger className="w-64">
                  <SelectValue
                    placeholder={
                      loading
                        ? 'Memuat dataset...'
                        : 'Tidak ada dataset tersedia'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {datasets.length === 0 ? (
                    <SelectItem value="placeholder" disabled>
                      Tidak ada dataset tersedia
                    </SelectItem>
                  ) : (
                    datasets.map((dataset) => (
                      <SelectItem key={dataset.id} value={dataset.id.toString()}>
                        {dataset.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            {selectedDataset && (
              <div className="hidden md:block text-right text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{selectedDataset.name}</p>
                <p>Diperbarui {new Date(selectedDataset.updated_at).toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex">
        <nav className="w-64 border-r bg-card min-h-[calc(100vh-73px)] p-4">
          <div className="space-y-2">
            {navigationItems.map((item) => (
              <Link
                key={item.name}
                to={item.isDisabled ? '#' : item.targetHref}
                className={cn(
                  'flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                  item.isDisabled
                    ? 'text-muted-foreground cursor-not-allowed opacity-50'
                    : item.isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                onClick={(e) => item.isDisabled && e.preventDefault()}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            ))}
          </div>
        </nav>

        <main className="flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
