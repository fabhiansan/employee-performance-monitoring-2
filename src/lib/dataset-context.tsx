import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Dataset } from '@/types/models';
import { listDatasets } from './api';

interface DatasetContextValue {
  datasets: Dataset[];
  loading: boolean;
  error: string | null;
  selectedDatasetId: number | null;
  selectedDataset: Dataset | null;
  refreshDatasets: () => Promise<void>;
  selectDataset: (datasetId: number | null) => void;
}

const DatasetContext = createContext<DatasetContextValue | undefined>(undefined);

const STORAGE_KEY = 'epa:selectedDatasetId';

interface DatasetProviderProps {
  children: React.ReactNode;
}

export function DatasetProvider({ children }: DatasetProviderProps) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  });

  const refreshDatasets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDatasets();
      setDatasets(data);

      if (data.length === 0) {
        setSelectedDatasetId(null);
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(STORAGE_KEY);
        }
        return;
      }

      if (selectedDatasetId === null) {
        const firstId = data[0]?.id ?? null;
        if (firstId !== null) {
          setSelectedDatasetId(firstId);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, firstId.toString());
          }
        }
      } else {
        const exists = data.some(dataset => dataset.id === selectedDatasetId);
        if (!exists) {
          const fallbackId = data[0]?.id ?? null;
          setSelectedDatasetId(fallbackId);
          if (typeof window !== 'undefined') {
            if (fallbackId === null) {
              window.localStorage.removeItem(STORAGE_KEY);
            } else {
              window.localStorage.setItem(STORAGE_KEY, fallbackId.toString());
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load datasets');
    } finally {
      setLoading(false);
    }
  }, [selectedDatasetId]);

  useEffect(() => {
    void refreshDatasets();
  }, [refreshDatasets]);

  const selectDataset = useCallback((datasetId: number | null) => {
    setSelectedDatasetId(datasetId);
    if (typeof window === 'undefined') return;
    if (datasetId === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, datasetId.toString());
    }
  }, []);

  const value = useMemo<DatasetContextValue>(() => {
    const selectedDataset = datasets.find(dataset => dataset.id === selectedDatasetId) ?? null;
    return {
      datasets,
      loading,
      error,
      selectedDatasetId,
      selectedDataset,
      refreshDatasets,
      selectDataset,
    };
  }, [datasets, loading, error, selectedDatasetId, refreshDatasets, selectDataset]);

  return (
    <DatasetContext.Provider value={value}>
      {children}
    </DatasetContext.Provider>
  );
}

export function useDatasets() {
  const context = useContext(DatasetContext);
  if (!context) {
    throw new Error('useDatasets must be used within a DatasetProvider');
  }
  return context;
}
