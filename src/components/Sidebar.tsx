import type { PageKey } from '../App';

const items: { key: PageKey; label: string }[] = [
  { key: 'dashboard', label: '📊 Dashboard' },
  { key: 'ingestion', label: '📥 采集任务' },
  { key: 'review', label: '🧠 AI审核' },
  { key: 'knowledge', label: '📚 知识库' },
  { key: 'graph', label: '🔗 知识图谱' },
  { key: 'model-settings', label: '⚙️ 模型设置' },
];

export function Sidebar({ active, onChange }: { active: PageKey; onChange: (p: PageKey) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">中医知识引擎</div>
      {items.map(item => (
        <button
          key={item.key}
          className={active === item.key ? 'nav active' : 'nav'}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </aside>
  );
}
