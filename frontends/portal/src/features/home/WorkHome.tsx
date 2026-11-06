import type { HomeActivity } from './useHomeActivity';
import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  ChevronDown,
  Files,
  Info,
  Star,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui';
import type { Dataset, Team } from './api';
import { SourceLabel } from './DatasetCollection';
import type { DemoActivity } from './demo-work';
import type { HomeComposition, HomeModule } from './preferences/model';
import { HOME_MODULE_LABELS, homeModuleGroups } from './preferences/model';
import { MotionRegion, useReflowMotion } from '../../ui/motion';

const moduleIcons = {
  library: Files,
  continue: ArrowUpRight,
  favorites: Star,
  recent: Clock3,
  teams: UsersRound,
};

type Props = {
  datasets: Dataset[];
  availableDatasets?: Dataset[];
  activity?: HomeActivity;
  selectedId: string | null;
  composition: HomeComposition;
  demoActivity: DemoActivity | null;
  teams: Team[];
  teamState: 'loading' | 'ready' | 'failed';
  onRetryTeams: () => void;
  onChoose: (id: string) => void;
  onSelect: (id: string, trigger?: HTMLButtonElement) => void;
  onOpen: (dataset: Dataset) => void;
  onFavorite: (id: string) => void;
  onRemoveRecent: (id?: string) => void;
  onBrowseAll: () => void;
  onLeaveHome?: (event: MouseEvent<HTMLAnchorElement>) => void;
  renderCoverage?: (dataset: Dataset) => ReactNode;
  collection: ReactNode;
  collectionCount: number;
  collectionTools?: ReactNode;
  collectionPresentation?: ReactNode;
  collectionQuery?: string;
  onClearCollectionQuery?: () => void;
};
const openedDate = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export default function WorkHome(props: Props) {
  const sections = useRef<HTMLDivElement>(null);
  useReflowMotion(
    sections,
    JSON.stringify([props.composition.order, props.composition.hidden]),
    ':scope > .mc-work-lane > section'
  );
  const { datasets, selectedId, composition, demoActivity, renderCoverage } = props;
  const available = props.availableDatasets || datasets;
  const selected =
    available.find((item) => item.id === selectedId) ||
    (!selectedId ? props.activity?.recent.items[0]?.dataset : undefined);
  const favorites = demoActivity
    ? datasets.filter((item) => demoActivity.favorites.includes(item.id))
    : props.activity?.favorites.items.map((item) => item.dataset) || [];
  const demoRecent = (demoActivity?.recent || []).flatMap((record) => {
    const dataset = datasets.find((item) => item.id === record.datasetId);
    return dataset ? [{ dataset, openedAt: record.openedAt }] : [];
  });
  const recent = demoActivity
    ? demoRecent
    : props.activity?.recent.items.map((item) => ({
        dataset: item.dataset,
        openedAt: item.lastOpenedAt,
      })) || [];
  const selectedRecent = recent.find(item => item.dataset.id === selected?.id);
  function record(dataset: Dataset, context: 'favorite' | 'recent', openedAt?: string) {
    return (
      <article
        key={dataset.id}
        className="mc-work-record"
        data-cy={`work-${context}-record`}
        data-motion-item={`${context}:${dataset.id}`}
      >
        <div className="mc-work-record-identity">
          <button
            type="button"
            className="mc-work-name"
            title={dataset.name}
            data-cy={`work-${context}-detail`}
            onClick={(event) => props.onSelect(dataset.id, event.currentTarget)}
          >
            <strong>{dataset.name}</strong>
          </button>
          <div className="mc-work-byline">
            {dataset.scope === 'team' ? (
              <span>团队 · {dataset.teamName || dataset.teamId}</span>
            ) : (
              <SourceLabel access={dataset.access} />
            )}
            <span>{dataset.ownerUsername || '未提供'}</span>
          {openedAt && (
            <time className="mc-work-opened" dateTime={openedAt}>
              {demoActivity ? '示例记录 · ' : ''}
              {openedDate.format(new Date(openedAt))}
            </time>
          )}
          </div>
        </div>
        <div className="mc-work-record-actions">
          <Button
            variant="ghost"
            size="icon"
            title={`打开 ${dataset.name}`}
            aria-label={`打开 ${dataset.name}`}
            onClick={() => props.onOpen(dataset)}
          >
            <ArrowUpRight size={18} />
          </Button>
          {context === 'favorite' ? (
            <Button
              variant="ghost"
              size="icon"
              title={`取消收藏 ${dataset.name}`}
              aria-label={`取消收藏 ${dataset.name}`}
              disabled={props.activity?.favoriteDisabled}
              onClick={() => props.onFavorite(dataset.id)}
            >
              <Star size={16} fill="currentColor" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              title={`移除记录 ${dataset.name}`}
              aria-label={`移除记录 ${dataset.name}`}
              disabled={props.activity?.busy}
              onClick={() => props.onRemoveRecent(dataset.id)}
            >
              <X size={16} />
            </Button>
          )}
        </div>
      </article>
    );
  }
  const modules: Record<HomeModule, ReactNode> = {
    continue: (
      <>
        {selected ? (
          <article
            className="mc-work-continue-target"
            data-cy="work-continue-target"
            aria-labelledby="work-continue-title"
          >
            <div className="mc-work-current-identity">
              <button type="button" className="mc-work-name" data-cy="work-continue-detail"
                onClick={(event) => props.onSelect(selected.id, event.currentTarget)}>
                <strong id="work-continue-title">{selected.name}</strong>
              </button>
              <div className="mc-work-byline">
                {selected.scope === 'team' ? <span>团队 · {selected.teamName || selected.teamId}</span> : <SourceLabel access={selected.access} />}
                <span>{selected.ownerUsername || '未提供'}</span>
                <span>{selected.instanceCount.toLocaleString()} 实例</span>
                <span className="mc-work-return-scope">返回数据集，未恢复序列、视角或本机草稿。</span>
              </div>
            </div>
            <div className="mc-work-coverage" aria-label={`${selected.name} 的 CT 帧覆盖率`}>{renderCoverage?.(selected)}</div>
            <Button variant="outline" className="mc-library-secondary" onClick={() => props.onOpen(selected)} dataCY="work-continue-open">
              打开数据集<ArrowUpRight size={16} />
            </Button>
          </article>
        ) : (
          <div className="mc-work-empty">
            <p>{datasets.length ? '选择一份资料，返回它的工作台入口。' : '暂无可继续的数据集。'}</p>
            {!demoActivity && <small>{props.activity?.recent.status === 'unsupported'
              ? '当前服务未提供最近打开记录；不恢复序列、视角或本机草稿。'
              : '成功打开 CT 后会记录最近访问；不会恢复上次视角。'}</small>}
          </div>
        )}
      </>
    ),
    favorites:
      demoActivity || props.activity?.favorites.status === 'ready' ? (
        favorites.length ? (
          <MotionRegion revision={JSON.stringify(favorites.map((dataset) => dataset.id))}>
            {favorites.map((dataset) => record(dataset, 'favorite'))}
          </MotionRegion>
        ) : (
          <div className="mc-work-empty">
            <p>{demoActivity ? '还没有收藏的示例资料。' : '还没有收藏的数据集。'}</p>
            <Button variant="ghost" onClick={props.onBrowseAll}>
              去资料库收藏
              <Star size={15} />
            </Button>
          </div>
        )
      ) : (
        <div className="mc-work-unavailable">
          <Star size={18} />
          <div>
            <strong>
              {props.activity?.favorites.status === 'unsupported'
                ? props.activity.favorites.error
                : props.activity?.favorites.status === 'loading'
                ? '正在读取收藏…'
                : '收藏暂时无法读取'}
            </strong>
            {props.activity?.favorites.status !== 'unsupported' && <>
            {props.activity?.favorites.error && <p>{props.activity.favorites.error}</p>}
            <Button variant="ghost" onClick={props.activity?.refresh}>
              重新读取
            </Button>
            </>}
          </div>
        </div>
      ),
    recent:
      demoActivity || props.activity?.recent.status === 'ready' ? (
        recent.length ? (
          <MotionRegion revision={JSON.stringify(recent.map((item) => item.dataset.id))}>
            {recent.map((item) => record(item.dataset, 'recent', item.openedAt))}
          </MotionRegion>
        ) : (
          <div className="mc-work-empty">
            <p>{demoActivity ? '示例最近记录已清空。' : '暂无最近打开记录。'}</p>
            <small>清理记录不删除数据集或收藏。</small>
          </div>
        )
      ) : (
        <div className="mc-work-unavailable">
          <Clock3 size={18} />
          <div>
            <strong>
              {props.activity?.recent.status === 'unsupported'
                ? props.activity.recent.error
                : props.activity?.recent.status === 'loading'
                ? '正在读取最近记录…'
                : '最近记录暂时无法读取'}
            </strong>
            {props.activity?.recent.status !== 'unsupported' && <>
            {props.activity?.recent.error && <p>{props.activity.recent.error}</p>}
            <Button variant="ghost" onClick={props.activity?.refresh}>
              重新读取
            </Button>
            </>}
          </div>
        </div>
      ),
    library: props.collectionCount ? (
      <div className="mc-work-dataset-preview">
        {props.collectionTools}
        {props.collection}
        <footer>
          <span>
            显示前 {Math.min(6, props.collectionCount)} / {props.collectionCount} 份资料
          </span>
          {props.collectionCount > 6 && <Button variant="ghost" onClick={props.onBrowseAll} dataCY="work-browse-all">
            查看此范围全部
            <ArrowRight size={15} />
          </Button>}
        </footer>
      </div>
    ) : (
      <div className="mc-work-empty">
        {props.collectionTools}
        <p>{props.collectionQuery ? '没有匹配的数据集。' : '当前范围还没有数据集。'}</p>
        {props.collectionQuery && <Button variant="ghost" onClick={props.onClearCollectionQuery}>清空首页搜索</Button>}
      </div>
    ),
    teams: demoActivity ? (
      <div className="mc-work-empty">
        <p>演示空间不连接真实团队。</p>
        <small>退出演示后可访问本人团队影像库。</small>
      </div>
    ) : props.teamState === 'loading' ? (
      <div className="mc-work-loading" role="status">
        正在读取本人团队…
      </div>
    ) : props.teamState === 'failed' ? (
      <div className="mc-work-empty">
        <p>团队暂时未能读取。</p>
        <Button variant="ghost" onClick={props.onRetryTeams}>
          重试读取
        </Button>
        <Link to="/teams" onClick={props.onLeaveHome}>
          前往团队影像库
          <ArrowUpRight size={14} />
        </Link>
      </div>
    ) : !props.teams.length ? (
      <div className="mc-work-empty">
        <p>还没有加入团队。</p>
        <Link to="/teams" onClick={props.onLeaveHome}>
          查找或创建团队
          <ArrowRight size={15} />
        </Link>
      </div>
    ) : (
      <div className="mc-work-teams">
        {props.teams.slice(0, 6).map((team) => (
          <Link
            key={team.id}
            to={`/teams?team=${encodeURIComponent(team.id)}`}
            className="mc-work-team"
            onClick={props.onLeaveHome}
          >
            <UsersRound size={18} />
            <div>
              <strong>{team.name}</strong>
              <span>
                {team.role === 'leader' ? '组长' : '成员'} · {team.memberCount} 位成员
              </span>
            </div>
            <ArrowUpRight size={16} />
          </Link>
        ))}
        <Link className="mc-work-all-teams" to="/teams" onClick={props.onLeaveHome}>
          全部团队
          <ArrowRight size={15} />
        </Link>
      </div>
    ),
  };
  const visible = composition.order.filter((module) => !composition.hidden.includes(module));
  const lanes = homeModuleGroups(composition);
  // Tablet pairs one reference with continuation without reordering either lane.
  const tabletPositions: Partial<Record<HomeModule, { row: number; column: string }>> = {};
  let nextRow = 1, nextReference = 0;
  for (const module of lanes.primary) {
    tabletPositions[module] = { row: nextRow, column: module === 'continue' && lanes.reference.length ? '1' : '1 / -1' };
    if (module === 'continue' && lanes.reference.length) {
      tabletPositions[lanes.reference[0]] = { row: nextRow, column: '2' };
      nextReference = 1;
    }
    nextRow++;
  }
  lanes.reference.slice(nextReference).forEach((module, index) => {
    tabletPositions[module] = { row: nextRow + Math.floor(index / 2), column: String(index % 2 + 1) };
  });
  return (
    <div className="mc-work-home" data-cy="work-home">
      {demoActivity && (
        <p className="mc-work-fixture-note">
          <Info size={14} />
          收藏和时间均为演示记录；打开按钮不产生真实访问历史。
        </p>
      )}
      {!visible.length && (
        <div className="mc-work-empty">
          <p>首页内容已全部隐藏。</p>
          <small>完整资料库仍可从顶部进入，首页设置可恢复内容。</small>
        </div>
      )}
      {props.activity?.error && (
        <p role="alert">
          {props.activity.error}{' '}
          <Button variant="ghost" onClick={props.activity.refresh}>
            重新读取
          </Button>
        </p>
      )}
      <div className="mc-work-modules" ref={sections}
        data-has-primary={!!lanes.primary.length} data-has-reference={!!lanes.reference.length}>
        {([['primary', lanes.primary], ['reference', lanes.reference]] as const).map(([lane, laneModules]) =>
          laneModules.length ? <div className={`mc-work-lane mc-work-${lane}`} key={lane}>
        {laneModules.map((module) => (
          <section
            key={module}
            style={{ '--desk-tablet-row': tabletPositions[module]?.row, '--desk-tablet-column': tabletPositions[module]?.column } as CSSProperties}
            className={`mc-work-module is-${module} ${
              !demoActivity &&
              ((module === 'favorites' && props.activity?.favorites.status !== 'ready') ||
                (module === 'recent' && props.activity?.recent.status !== 'ready'))
                ? 'is-unavailable'
                : ''
            } ${!demoActivity && ((module === 'favorites' && props.activity?.favorites.status === 'unsupported') || (module === 'recent' && props.activity?.recent.status === 'unsupported')) ? 'is-unsupported' : ''}`}
            data-cy={`work-module-${module}`}
            aria-label={HOME_MODULE_LABELS[module]}
            data-motion-item={`module:${module}`}
          >
            <header>
              <h2>
                {(() => {
                  const Icon = moduleIcons[module];
                  return <Icon size={17} aria-hidden="true" />;
                })()}
                {module === 'library' ? '数据集' : module === 'continue' ? '继续研究' : HOME_MODULE_LABELS[module]}
                {module === 'library' && <span className="mc-desk-library-count">{props.collectionCount}</span>}
              </h2>
              {module === 'continue' && <>
                {selectedRecent && <time className="mc-desk-continue-date" dateTime={selectedRecent.openedAt}>
                  {demoActivity ? '示例记录 · ' : '上次访问 · '}{openedDate.format(new Date(selectedRecent.openedAt))}
                </time>}
                <div className="mc-work-continue-picker">
                  <label htmlFor="work-continue-dataset">{demoActivity ? '继续示例资料' : '选择数据集'}</label>
                  <select id="work-continue-dataset" value={selected?.id || ''} title={selected?.name || '选择一份可访问资料'}
                    onChange={event => props.onChoose(event.target.value)} data-cy="work-continue-select">
                    <option value="">选择一份可访问资料</option>
                    {available.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" />
                </div>
              </>}
              {module === 'favorites' &&
                (demoActivity || props.activity?.favorites.status === 'ready') && (
                  <span>{props.activity?.favorites.total ?? favorites.length} 份</span>
                )}
              {module === 'library' && props.collectionPresentation}
              {module === 'recent' &&
                (demoActivity || props.activity?.recent.status === 'ready') && (
                  <div>
                    <span>{props.activity?.recent.total ?? recent.length} 份</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="清空最近记录"
                      aria-label="清空最近记录"
                      disabled={!recent.length || props.activity?.busy}
                      onClick={() => props.onRemoveRecent()}
                      dataCY="work-clear-recent"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                )}
              {module === 'teams' && !demoActivity && props.teamState === 'ready' && (
                <span>{props.teams.length} 个</span>
              )}
            </header>
            {modules[module]}
            {props.activity &&
              (module === 'favorites' || module === 'recent') &&
              (() => {
                const kind = module === 'favorites' ? 'favorite' : 'recent';
                const list = kind === 'favorite' ? props.activity.favorites : props.activity.recent;
                if (list.status === 'ready' && list.error) return <div className="mc-work-list-error" role="alert">
                  <p>{list.error}</p>
                  <Button variant="ghost" disabled={props.activity.busy} onClick={() => { void props.activity?.loadMore(kind); }}>重试加载</Button>
                </div>;
                return list.status === 'ready' && list.items.length < list.total ? (
                  <Button
                    variant="ghost"
                    disabled={props.activity.busy}
                    onClick={() => {
                      void props.activity?.loadMore(kind);
                    }}
                  >
                    加载更多
                  </Button>
                ) : null;
              })()}
          </section>
        ))}
        </div> : null)}
      </div>
    </div>
  );
}
