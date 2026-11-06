import type { Dataset } from './api';
import type { ReactNode } from 'react';

export type DatasetScope = 'all' | Dataset['access'];
export function sourceCounts(datasets: readonly Dataset[]) {
  return datasets.reduce(
    (result, item) => {
      result[item.access]++;
      return result;
    },
    { all: datasets.length, owner: 0, shared: 0, public: 0 }
  );
}
const sources = [
  { value: 'owner', label: '我创建的' },
  { value: 'shared', label: '与我共享' },
  { value: 'public', label: '公共示例' },
] as const;

export default function ScopeOverview({
  datasets,
  scope,
  onChange,
  utilities,
  compact = false,
}: {
  datasets: readonly Dataset[];
  scope: DatasetScope;
  onChange: (scope: DatasetScope) => void;
  utilities?: ReactNode;
  compact?: boolean;
}) {
  const counts = sourceCounts(datasets);
  if (compact) return (
    <div className="mc-desk-sources" role="group" aria-label="按来源查看">
      {[{ value: 'all', label: '全部' }, ...sources].map(source => (
        <button key={source.value} type="button"
          aria-pressed={scope === source.value}
          aria-label={source.value === 'all' ? `全部数据集 ${counts.all} 份` : `${source.label} ${counts[source.value as DatasetScope]}`}
          data-cy={`home-scope-${source.value}`}
          onClick={() => onChange(source.value as DatasetScope)}>
          {source.label}<span>{counts[source.value as DatasetScope].toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
  return (
    <section className="mc-scope-overview" aria-label="个人资料来源分布">
      <div className="mc-scope-summary-head">
        <button
          type="button"
          className="mc-scope-total"
          aria-pressed={scope === 'all'}
          aria-label={`全部数据集 ${counts.all} 份`}
          data-cy="home-scope-all"
          onClick={() => onChange('all')}
        >
          <strong>{counts.all.toLocaleString()}</strong>
          <span>
            份可访问数据集<small>个人资料库</small>
          </span>
        </button>
        {utilities}
      </div>
      <div className="mc-scope-breakdown">
        <div className="mc-scope-bar" aria-hidden="true">
          {sources.map((source) => (
            <span
              key={source.value}
              className={`is-${source.value}`}
              style={{ width: counts.all ? `${(counts[source.value] / counts.all) * 100}%` : '0%' }}
            />
          ))}
        </div>
        <div className="mc-scope-legend" role="group" aria-label="按来源查看">
          {sources.map((source) => (
            <button
              key={source.value}
              type="button"
              aria-pressed={scope === source.value}
              data-cy={`home-scope-${source.value}`}
              onClick={() => onChange(source.value)}
            >
              <i className={`is-${source.value}`} aria-hidden="true" />
              <span>{source.label}</span>
              <strong>{counts[source.value].toLocaleString()}</strong>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
