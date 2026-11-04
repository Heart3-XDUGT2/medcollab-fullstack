import { useRef, type ReactNode, type RefCallback } from 'react';
import { ArrowUpRight, Info, MoreHorizontal, PencilLine, Share2, Star, Upload } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui';
import type { Dataset } from './api';

export type ResourceFields = { owner: boolean; instances: boolean; createdAt: boolean };
type ResourceAction = 'rename' | 'share' | 'upload';
type Props = {
  datasets: Dataset[];
  layout: 'list' | 'cards';
  density: 'comfortable' | 'compact';
  grouped: boolean;
  fields: ResourceFields;
  selectedId: string | null;
  onSelect: (id: string, trigger?: HTMLButtonElement) => void;
  onOpen: (dataset: Dataset) => void;
  onAction: (kind: ResourceAction, dataset: Dataset, trigger?: HTMLButtonElement) => void;
  registerTrigger: (id: string, element: HTMLButtonElement | null) => void;
  favoriteIds?: readonly string[];
  favoriteDisabled?: boolean;
  onFavorite?: (id: string) => void;
  renderCoverage?: (dataset: Dataset) => ReactNode;
};

export const sourceLabels = { owner: '我创建的', shared: '与我共享', public: '公共示例' };
const sourceDescriptions = {
  owner: '由你创建与整理',
  shared: '研究伙伴的协作资料',
  public: '所有登录用户可访问',
};
const date = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const number = new Intl.NumberFormat('zh-CN');

export function SourceLabel({ access }: { access: Dataset['access'] }) {
  return (
    <span className={`mc-resource-source is-${access}`}>
      <i aria-hidden="true" />
      {sourceLabels[access]}
    </span>
  );
}

function ResourceMenu({
  dataset,
  onSelect,
  onOpen,
  onAction,
  onFavorite,
  favoriteIds,
  favoriteDisabled,
}: { dataset: Dataset } & Pick<
  Props,
  'onSelect' | 'onOpen' | 'onAction' | 'onFavorite' | 'favoriteIds' | 'favoriteDisabled'
>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const origin = () =>
    trigger.current
      ?.closest('[data-cy="home-dataset-row"]')
      ?.querySelector<HTMLButtonElement>('[data-cy="home-dataset-select"]') || undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="icon"
          className="mc-resource-menu-trigger"
          aria-label={`${dataset.name} 的更多操作`}
          title="更多操作"
          dataCY="home-dataset-more"
        >
          <MoreHorizontal size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="mc-library-menu">
        {onFavorite && (
          <DropdownMenuItem disabled={favoriteDisabled} onSelect={() => onFavorite(dataset.id)} data-cy="home-menu-favorite">
            <Star size={16} />
            {favoriteIds?.includes(dataset.id) ? '取消收藏' : '收藏到首页'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onSelect(dataset.id, origin())}>
          <Info size={16} />
          资料概览
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onAction('upload', dataset, origin())}
          data-cy="home-menu-append"
        >
          <Upload size={16} />
          追加文件
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onAction('rename', dataset, origin())}
          data-cy="home-menu-rename"
        >
          <PencilLine size={16} />
          重命名
        </DropdownMenuItem>
        {dataset.access !== 'public' && (
          <DropdownMenuItem
            onSelect={() => onAction('share', dataset, origin())}
            data-cy="home-menu-share"
          >
            <Share2 size={16} />
            按账号共享
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onOpen(dataset)} data-cy="home-menu-open">
          <ArrowUpRight size={16} />
          打开工作界面
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NameButton({
  dataset,
  selected,
  onSelect,
  registerTrigger,
  children,
}: { dataset: Dataset; selected: boolean; children?: ReactNode } & Pick<
  Props,
  'onSelect' | 'registerTrigger'
>) {
  const ref: RefCallback<HTMLButtonElement> = (element) => registerTrigger(dataset.id, element);
  return (
    <button
      type="button"
      ref={ref}
      className="mc-resource-name"
      data-cy="home-dataset-select"
      aria-pressed={selected}
      title={`查看 ${dataset.name} 的资料概览`}
      onClick={(event) => onSelect(dataset.id, event.currentTarget)}
    >
      <strong>{dataset.name}</strong>
      {children}
    </button>
  );
}

function ResourceCard({ dataset, ...props }: { dataset: Dataset } & Props) {
  const selected = dataset.id === props.selectedId;
  const fields = props.fields;
  return (
    <article
      className={`mc-resource-card ${selected ? 'is-selected' : ''}`}
      data-cy="home-dataset-row"
      data-has-facts={fields.instances || fields.createdAt}
    >
      <div className="mc-resource-card-title">
        <NameButton
          dataset={dataset}
          selected={selected}
          onSelect={props.onSelect}
          registerTrigger={props.registerTrigger}
        />
        <ResourceMenu dataset={dataset} {...props} />
      </div>
      <div className="mc-resource-card-byline">
        <SourceLabel access={dataset.access} />
        {fields.owner && (
          <span
            className="mc-resource-creator"
            title={`创建者：${dataset.ownerUsername || '未提供'}`}
          >
            {dataset.ownerUsername || '未提供'}
          </span>
        )}
      </div>
      {(fields.instances || fields.createdAt) && (
        <dl className="mc-resource-card-facts">
          {fields.instances && (
            <div>
              <dt>实例数</dt>
              <dd className={dataset.instanceCount > 9999999 ? 'is-long-number' : ''}>
                {number.format(dataset.instanceCount)}
              </dd>
            </div>
          )}
          {fields.createdAt && (
            <div>
              <dt>创建时间</dt>
              <dd>
                <time dateTime={dataset.createdAt}>{date.format(new Date(dataset.createdAt))}</time>
              </dd>
            </div>
          )}
        </dl>
      )}
      {props.renderCoverage && (
        <div className="mc-resource-coverage">{props.renderCoverage(dataset)}</div>
      )}
      <footer className="mc-resource-card-footer">
        <Button
          variant="ghost"
          onClick={() => props.onOpen(dataset)}
          className="mc-resource-open"
          dataCY="home-row-open"
        >
          {dataset.instanceCount ? '进入工作台' : '打开'}
          <ArrowUpRight size={16} />
        </Button>
        <button
          type="button"
          className="mc-resource-detail-link"
          onClick={(event) => props.onSelect(dataset.id, event.currentTarget)}
          aria-label={`查看 ${dataset.name} 的资料概览`}
        >
          <Info size={15} />
          详情
        </button>
        {props.onFavorite && (
          <FavoriteButton
            dataset={dataset}
            active={!!props.favoriteIds?.includes(dataset.id)}
            disabled={props.favoriteDisabled}
            onToggle={props.onFavorite}
          />
        )}
      </footer>
    </article>
  );
}

function FavoriteButton({
  dataset,
  active,
  onToggle,
  disabled,
}: {
  dataset: Dataset;
  active: boolean;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={`${active ? '取消收藏' : '收藏'} ${dataset.name}`}
      aria-label={`${active ? '取消收藏' : '收藏'} ${dataset.name}`}
      aria-pressed={active}
      dataCY="home-favorite"
      disabled={disabled}
      onClick={() => onToggle(dataset.id)}
    >
      <Star size={16} fill={active ? 'currentColor' : 'none'} />
    </Button>
  );
}
function ResourceTable({ datasets, ...props }: Props) {
  const { fields } = props;
  const groups = props.grouped
    ? (['owner', 'shared', 'public'] as const)
        .map((access) => ({ access, items: datasets.filter((item) => item.access === access) }))
        .filter((group) => group.items.length)
    : [{ access: null, items: datasets }];
  const columnCount = 2 + Object.values(fields).filter(Boolean).length;
  return (
    <table className="mc-resource-table" data-cy="home-datasets">
      <thead>
        <tr>
          <th>数据集</th>
          {fields.owner && <th data-field="owner">创建者</th>}
          {fields.instances && <th data-field="instances">实例数</th>}
          {fields.createdAt && <th data-field="createdAt">创建时间</th>}
          <th data-field="actions">
            <span className="sr-only">操作</span>
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.access || 'all'}>
          {group.access && (
            <tr className="mc-resource-table-group">
              <th colSpan={columnCount} scope="rowgroup">
                <SourceLabel access={group.access} />
                <span>{group.items.length} 个数据集</span>
              </th>
            </tr>
          )}
          {group.items.map((dataset) => (
            <tr
              key={dataset.id}
              className={dataset.id === props.selectedId ? 'is-selected' : ''}
              data-cy="home-dataset-row"
            >
              <td className="mc-resource-name-cell">
                <NameButton
                  dataset={dataset}
                  selected={dataset.id === props.selectedId}
                  onSelect={props.onSelect}
                  registerTrigger={props.registerTrigger}
                >
                  <SourceLabel access={dataset.access} />
                </NameButton>
                {props.renderCoverage && (
                  <div className="mc-resource-coverage">{props.renderCoverage(dataset)}</div>
                )}
              </td>
              {fields.owner && (
                <td className="mc-resource-owner-cell" title={dataset.ownerUsername || '未提供'}>
                  <span className="mc-resource-mobile-label">创建者</span>
                  {dataset.ownerUsername || '未提供'}
                </td>
              )}
              {fields.instances && (
                <td className="mc-resource-instance-cell">
                  <span className="mc-resource-mobile-label">实例数</span>
                  {number.format(dataset.instanceCount)}
                </td>
              )}
              {fields.createdAt && (
                <td className="mc-resource-date-cell">
                  <span className="mc-resource-mobile-label">创建时间</span>
                  <time dateTime={dataset.createdAt}>
                    {date.format(new Date(dataset.createdAt))}
                  </time>
                </td>
              )}
              <td className="mc-resource-actions-cell">
                <div>
                  <Button
                    variant="ghost"
                    className="mc-resource-open"
                    onClick={() => props.onOpen(dataset)}
                    dataCY="home-row-open"
                  >
                    打开
                    <ArrowUpRight size={15} />
                  </Button>
                  <ResourceMenu dataset={dataset} {...props} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

export default function DatasetCollection(props: Props) {
  if (props.layout === 'list')
    return (
      <div className="mc-resource-table-scroll">
        <ResourceTable {...props} />
      </div>
    );
  const groups = props.grouped
    ? (['owner', 'shared', 'public'] as const)
        .map((access) => ({
          access,
          items: props.datasets.filter((item) => item.access === access),
        }))
        .filter((group) => group.items.length)
    : [{ access: null, items: props.datasets }];
  return (
    <div className="mc-resource-index" data-cy="home-datasets">
      {groups.map((group) => (
        <section
          key={group.access || 'all'}
          className="mc-resource-index-section"
          aria-label={group.access ? sourceLabels[group.access] : '资料索引'}
        >
          {group.access && (
            <header className="mc-resource-index-section-title">
              <div>
                <h2>{sourceLabels[group.access]}</h2>
                <p>{sourceDescriptions[group.access]}</p>
              </div>
              <span>{group.items.length} 个数据集</span>
            </header>
          )}
          <div
            className={`mc-resource-card-grid ${group.items.length <= 3 ? 'is-small-collection' : ''}`}
          >
            {group.items.map((dataset) => (
              <ResourceCard key={dataset.id} dataset={dataset} {...props} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
