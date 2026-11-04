import type { HomeActivity } from './useHomeActivity';
import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Clock3, Info, Star, Trash2, UsersRound, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui';
import type { Dataset, Team } from './api';
import { SourceLabel } from './DatasetCollection';
import type { DemoActivity } from './demo-work';
import type { HomeComposition, HomeModule } from './preferences/model';
import { HOME_MODULE_LABELS } from './preferences/model';

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
  onLibrary: () => void;
  renderCoverage?: (dataset: Dataset) => ReactNode;
};
const openedDate = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export default function WorkHome(props: Props) {
  const { datasets, selectedId, composition, demoActivity, renderCoverage } = props;
  const available = props.availableDatasets || datasets;
  const selected = available.find((item) => item.id === selectedId) ||
    (!selectedId ? props.activity?.recent.items[0]?.dataset : undefined);
  const favorites = demoActivity ? datasets.filter((item) => demoActivity.favorites.includes(item.id)) : (props.activity?.favorites.items.map(item => item.dataset) || []);
  const demoRecent = (demoActivity?.recent || []).flatMap((record) => {
    const dataset = datasets.find((item) => item.id === record.datasetId);
    return dataset ? [{ dataset, openedAt: record.openedAt }] : [];
  });
  const recent = demoActivity ? demoRecent : (props.activity?.recent.items.map(item => ({ dataset: item.dataset, openedAt: item.lastOpenedAt })) || []);
  function record(dataset: Dataset, context: 'favorite' | 'recent', openedAt?: string) {
    return (
      <article key={dataset.id} className="mc-work-record" data-cy={`work-${context}-record`}>
        <div className="mc-work-record-identity">
          <button
            type="button"
            className="mc-work-name"
            data-cy={`work-${context}-detail`}
            onClick={(event) => props.onSelect(dataset.id, event.currentTarget)}
          >
            <strong>{dataset.name}</strong>
          </button>
          <div className="mc-work-byline">
            {dataset.scope === 'team' ? <span>团队 · {dataset.teamName || dataset.teamId}</span> : <SourceLabel access={dataset.access} />}
            <span>{dataset.ownerUsername || '未提供'}</span>
          </div>
          {openedAt && (
            <time className="mc-work-opened" dateTime={openedAt}>
              {demoActivity ? '示例记录 · ' : ''}{openedDate.format(new Date(openedAt))}
            </time>
          )}
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
        <div className="mc-work-continue-picker">
          <label htmlFor="work-continue-dataset">
            {demoActivity ? '继续示例资料' : '选择数据集'}
          </label>
          <select
            id="work-continue-dataset"
            value={selected?.id || ''}
            onChange={(event) => props.onChoose(event.target.value)}
            data-cy="work-continue-select"
          >
            <option value="">选择一份可访问资料</option>
            {available.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
        </div>
        {selected ? (
          <article className="mc-work-continue-target" data-cy="work-continue-target">
            <div>
              <button
                type="button"
                className="mc-work-name"
                data-cy="work-continue-detail"
                onClick={(event) => props.onSelect(selected.id, event.currentTarget)}
              >
                <strong>{selected.name}</strong>
              </button>
              <div className="mc-work-byline">
                {selected.scope === 'team' ? <span>团队 · {selected.teamName || selected.teamId}</span> : <SourceLabel access={selected.access} />}
                <span>{selected.ownerUsername || '未提供'}</span>
                <span>{selected.instanceCount.toLocaleString()} 实例</span>
              </div>
              <p className="mc-work-return-scope">返回数据集，未恢复序列、视角或本机草稿。</p>
              <Button
                className="mc-library-primary"
                onClick={() => props.onOpen(selected)}
                dataCY="work-continue-open"
              >
                打开数据集
                <ArrowUpRight size={16} />
              </Button>
            </div>
            <div className="mc-work-coverage">{renderCoverage?.(selected)}</div>
          </article>
        ) : (
          <div className="mc-work-empty">
            <p>{datasets.length ? '选择一份资料，返回它的工作台入口。' : '暂无可继续的数据集。'}</p>
            {!demoActivity && <small>成功打开 CT 后会记录最近访问；不会恢复上次视角。</small>}
            <Button variant="ghost" onClick={props.onLibrary}>
              前往资料库
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
      </>
    ),
    favorites: demoActivity || props.activity?.favorites.status === 'ready' ? (
      favorites.length ? (
        <div>{favorites.map((dataset) => record(dataset, 'favorite'))}</div>
      ) : (
        <div className="mc-work-empty">
          <p>{demoActivity ? '还没有收藏的示例资料。' : '还没有收藏的数据集。'}</p>
          <Button variant="ghost" onClick={props.onLibrary}>
            去资料库收藏
            <Star size={15} />
          </Button>
        </div>
      )
    ) : (
      <div className="mc-work-unavailable">
        <Star size={18} />
        <div>
          <strong>{props.activity?.favorites.status === 'loading' ? '正在读取收藏…' : '收藏暂时无法读取'}</strong>
          <p>{props.activity?.favorites.error}</p>
          <Button variant="ghost" onClick={props.activity?.refresh}>重新读取</Button>
        </div>
      </div>
    ),
    recent: demoActivity || props.activity?.recent.status === 'ready' ? (
      recent.length ? (
        <div>{recent.map((item) => record(item.dataset, 'recent', item.openedAt))}</div>
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
          <strong>{props.activity?.recent.status === 'loading' ? '正在读取最近记录…' : '最近记录暂时无法读取'}</strong>
          <p>{props.activity?.recent.error}</p>
          <Button variant="ghost" onClick={props.activity?.refresh}>重新读取</Button>
        </div>
      </div>
    ),
    library: (
      <div className="mc-work-library-entry">
        <p>
          <strong>{datasets.length}</strong> 份个人范围资料<span>含我创建的、共享与公共示例</span>
        </p>
        <Button variant="outline" className="mc-library-secondary" onClick={props.onLibrary}>
          完整资料库
          <ArrowRight size={16} />
        </Button>
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
        <Link to="/teams">
          前往团队影像库
          <ArrowUpRight size={14} />
        </Link>
      </div>
    ) : !props.teams.length ? (
      <div className="mc-work-empty">
        <p>还没有加入团队。</p>
        <Link to="/teams">
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
        <Link className="mc-work-all-teams" to="/teams">
          全部团队
          <ArrowRight size={15} />
        </Link>
      </div>
    ),
  };
  const visible = composition.order.filter((module) => !composition.hidden.includes(module));
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
      {props.activity?.error && <p role="alert">{props.activity.error} <Button variant="ghost" onClick={props.activity.refresh}>重新读取</Button></p>}
      <div className="mc-work-modules">
        {visible.map((module) => (
          <section
            key={module}
            className={`mc-work-module is-${module}`}
            data-cy={`work-module-${module}`}
          >
            <header>
              <h2>{HOME_MODULE_LABELS[module]}</h2>
              {module === 'favorites' && (demoActivity || props.activity?.favorites.status === 'ready') && <span>{props.activity?.favorites.total ?? favorites.length} 份</span>}
              {module === 'recent' && (demoActivity || props.activity?.recent.status === 'ready') && (
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
            {props.activity && (module === 'favorites' || module === 'recent') && (() => {
              const kind = module === 'favorites' ? 'favorite' : 'recent';
              const list = kind === 'favorite' ? props.activity.favorites : props.activity.recent;
              return list.status === 'ready' && list.items.length < list.total ?
                <Button variant="ghost" disabled={props.activity.busy} onClick={() => { void props.activity?.loadMore(kind); }}>加载更多</Button> : null;
            })()}
          </section>
        ))}
      </div>
    </div>
  );
}
