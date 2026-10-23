import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader } from '../../components/ui.jsx';
import ArticlesTab from './ArticlesTab.jsx';
import CategoriesTab from './CategoriesTab.jsx';
import InsightsTab from './InsightsTab.jsx';

const TABS = [
  ['articles', 'Articles'],
  ['categories', 'Categories'],
  ['insights', 'Search gaps'],
];

export default function FaqManagerPage() {
  const { projects, activeProjectId } = useAuth();
  const [tab, setTab] = useState('articles');
  const active =
    activeProjectId === 'ALL'
      ? 'All projects'
      : (projects.find((p) => p.id === activeProjectId)?.name ?? '—');

  return (
    <div>
      <PageHeader
        title="FAQ manager"
        subtitle={`Showing content for: ${active}. Change it with the project switcher in the header.`}
      />
      <div
        role="tablist"
        aria-label="FAQ management"
        className="mb-6 flex gap-1 border-b border-slate-200"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === key ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'articles' && <ArticlesTab />}
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'insights' && <InsightsTab />}
      </div>
    </div>
  );
}
