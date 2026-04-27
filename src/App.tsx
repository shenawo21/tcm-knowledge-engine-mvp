import { useState } from 'react';
import { Dashboard } from './pages/Dashboard';
import { IngestionPage } from './pages/IngestionPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { GraphPage } from './pages/GraphPage';
import { ReviewPage } from './pages/ReviewPage';
import { ModelSettingsPage } from './pages/ModelSettingsPage';
import { Sidebar } from './components/Sidebar';

export type PageKey = 'dashboard' | 'ingestion' | 'review' | 'knowledge' | 'graph' | 'model-settings';

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard');

  return (
    <div className="app">
      <Sidebar active={page} onChange={setPage} />
      <main className="main">
        {page === 'dashboard' && <Dashboard />}
        {page === 'ingestion' && <IngestionPage />}
        {page === 'review' && <ReviewPage />}
        {page === 'knowledge' && <KnowledgePage />}
        {page === 'graph' && <GraphPage />}
        {page === 'model-settings' && <ModelSettingsPage />}
      </main>
    </div>
  );
}
