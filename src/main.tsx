import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ImportPage } from './pages/ImportPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeeListPage } from './pages/EmployeeListPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { DatasetComparisonPage } from './pages/DatasetComparisonPage';
import { DataManagementPage } from './pages/DataManagementPage';
import { ReportPage } from './pages/ReportPage';
import { DatasetProvider } from './lib/dataset-context';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DatasetProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/import" replace />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="data-management" element={<DataManagementPage />} />
            <Route path="dashboard/:datasetId" element={<DashboardPage />} />
            <Route path="employees" element={<EmployeeListPage />} />
            <Route path="employees/:datasetId" element={<EmployeeListPage />} />
            <Route path="employees/:datasetId/:employeeId" element={<EmployeeDetailPage />} />
            <Route path="report/:datasetId" element={<ReportPage />} />
            <Route path="report/:datasetId/:employeeId" element={<ReportPage />} />
            <Route path="compare" element={<DatasetComparisonPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </DatasetProvider>
  </React.StrictMode>,
);
