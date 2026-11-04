import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, RefreshCw } from 'lucide-react';
import { Button } from '../../../ui';
import { formatCoverage } from './contract';
import type { AnnotationProgress } from './contract';
import { useDatasetStatistics } from './hooks';
import type { StatisticsModel, StatisticsStatus } from './store';
import './statistics.css';

const messages: Record<StatisticsStatus, string> = {
  idle: '统计尚未读取',
  queued: '统计等待读取',
  loading: '正在读取统计',
  ready: '',
  unconfigured: '统计服务未配置',
  unauthenticated: '登录后可读取统计',
  unsupported: '当前服务未提供统计',
  forbidden: '当前账号无法读取统计',
  missing: '资料不存在或已无访问权限',
  busy: '统计版本正在变化，请稍后重读',
  error: '统计读取失败，请稍后重读',
  deferred: '统计读取已暂缓，可手动重读',
  'demo-missing': '此演示资料未提供合成统计',
};
const count = new Intl.NumberFormat('zh-CN');

function CoverageLine({ label, progress }: { label: string; progress: AnnotationProgress }) {
  return (
    <div className="mc-coverage-line">
      <span className="mc-coverage-label">{label}</span>
      <span className="mc-coverage-count">
        {count.format(progress.annotatedSlices)} / {count.format(progress.totalSlices)} 帧
      </span>
      <span className="mc-coverage-percent">{formatCoverage(progress)}</span>
    </div>
  );
}

export default function DatasetCoverage({
  model,
  datasetId,
  variant = 'compact',
  active,
}: {
  model: StatisticsModel;
  datasetId: string;
  variant?: 'compact' | 'detail';
  active?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [observed, setObserved] = useState<{
    model: StatisticsModel;
    id: string;
    near: boolean;
  } | null>(null);
  const enabled =
    active ?? (observed?.model === model && observed.id === datasetId && observed.near);
  useEffect(() => {
    if (active !== undefined || !element.current) return;
    if (!('IntersectionObserver' in globalThis)) {
      setObserved({ model, id: datasetId, near: true });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setObserved({ model, id: datasetId, near: entries.some((entry) => entry.isIntersecting) });
      },
      { rootMargin: '160px' }
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [active, model, datasetId]);
  const stats = useDatasetStatistics(model, datasetId, { enabled });
  const { data, status, source, stale } = stats;
  const loading = status === 'loading' || status === 'queued';
  const canRefresh =
    active !== false &&
    !loading &&
    !['unconfigured', 'unauthenticated', 'forbidden', 'missing', 'demo-missing'].includes(status) &&
    source !== 'synthetic';
  const archiveErrors = data?.series.some((series) => !!series.archiveError);
  const published = data?.series.filter((series) => series.publishedVersion > 0).length ?? 0;
  const empty = data?.progress.totalSlices === 0;
  const content = (
    <>
      <div className="mc-coverage-heading">
        <span>CT 帧覆盖率</span>
        {source === 'synthetic' && <span className="mc-coverage-synthetic">合成示例</span>}
        {canRefresh && (
          <Button
            variant="ghost"
            size="icon"
            className="mc-coverage-refresh"
            title="重新读取统计"
            aria-label="重新读取统计"
            onClick={(event) => {
              event.stopPropagation();
              stats.refresh();
            }}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        )}
      </div>
      {data ? (
        <>
          <CoverageLine label="共享画布" progress={data.progress} />
          <CoverageLine label="已归档" progress={data.publishedProgress} />
          {empty ? (
            <p className="mc-coverage-meta">无受支持的单帧 CT，覆盖率不适用</p>
          ) : (
            <p className="mc-coverage-meta">
              {published === 0
                ? '尚未发布 SEG'
                : published < data.seriesCount
                  ? `${published} / ${data.seriesCount} 个 CT 序列已有归档`
                  : '已有 SEG 归档'}
              {data.pendingArchive && ' · 有操作待归档'}
            </p>
          )}
          {archiveErrors && (
            <p className="mc-coverage-warning">
              <AlertCircle aria-hidden="true" />
              归档异常，归档值未代表最新画布
            </p>
          )}
          {(stale || loading) && (
            <p className="mc-coverage-warning">
              {loading ? '正在重读，暂显示上次结果' : '上次结果，尚未更新'}
            </p>
          )}
          {!loading && status !== 'ready' && (
            <p className="mc-coverage-meta" role="status">
              {messages[status]}
            </p>
          )}
          <p className="mc-coverage-meta">
            非空掩码 CT 帧 / 受支持 CT 总帧，不代表医学质量或审核结论
          </p>
          <p className="mc-coverage-meta">
            统计生成于{' '}
            <time dateTime={data.generatedAt}>
              {new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false })}
            </time>
          </p>
        </>
      ) : (
        <p className={`mc-coverage-meta${loading ? ' mc-coverage-loading' : ''}`} role="status">
          {messages[status]}
        </p>
      )}
    </>
  );
  return (
    <div
      ref={element}
      className={`mc-coverage mc-coverage--${variant}`}
      data-cy="dataset-coverage"
      data-status={status}
      aria-label="CT 帧覆盖率"
      aria-busy={loading}
    >
      {variant === 'compact' ? (
        <details key={datasetId} className="mc-coverage-disclosure">
          <summary
            data-cy="coverage-summary"
            title="CT 统计详情"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            }}
          >
            <span className="mc-coverage-summary-content">
              {data ? (
                empty ? (
                  <span>无可标注 CT</span>
                ) : (
                  <>
                    <span className="mc-coverage-summary-value">
                      CT 共享画布 <strong>{formatCoverage(data.progress)}</strong>
                    </span>
                    <span className="mc-coverage-summary-value">
                      {published === 0 ? (
                        '尚未发布 SEG'
                      ) : (
                        <>
                          已归档 <strong>{formatCoverage(data.publishedProgress)}</strong>
                        </>
                      )}
                    </span>
                    {data.pendingArchive && (
                      <span className="mc-coverage-summary-note">待归档</span>
                    )}
                  </>
                )
              ) : (
                <span role="status">{messages[status]}</span>
              )}
              {source === 'synthetic' && <span className="mc-coverage-synthetic">合成示例</span>}
              {archiveErrors && <span className="mc-coverage-summary-warning">归档异常</span>}
              {data && (stale || loading) && (
                <span className="mc-coverage-summary-warning">
                  {loading ? '重读中 · 旧值' : '旧值'}
                </span>
              )}
              {data && !loading && status !== 'ready' && (
                <span className="mc-coverage-summary-warning" role="status">
                  {messages[status]}
                </span>
              )}
            </span>
            <ChevronDown className="mc-coverage-disclosure-icon" aria-hidden="true" />
          </summary>
          <div className="mc-coverage-expanded">{content}</div>
        </details>
      ) : (
        content
      )}
    </div>
  );
}
