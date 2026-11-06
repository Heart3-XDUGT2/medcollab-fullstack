import { useRef, type ReactNode, type RefCallback } from 'react';
import { ArrowUpRight, MoreHorizontal, PencilLine, Share2, Star, Upload, Trash2 } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui';
import type { Dataset } from './api';
import { useConfirmedFeedback, useReflowMotion } from '../../ui/motion';

export type ResourceFields = { owner: boolean; instances: boolean; createdAt: boolean };
type ResourceAction = 'rename' | 'share' | 'upload' | 'delete';
type Props = {
  presentation?: 'standard' | 'desk';
  datasets: Dataset[];
  layout: 'rows' | 'list' | 'cards';
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

export const sourceLabels = { owner: '我拥有的', shared: '与我共享', public: '公共示例' };
const sourceDescriptions = {
  owner: '包括你上传及收到的独立副本',
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
  onAction,
  onFavorite,
  favoriteIds,
  favoriteDisabled,
  layout,
}: { dataset: Dataset } & Pick<
  Props,
  'onAction' | 'onFavorite' | 'favoriteIds' | 'favoriteDisabled' | 'layout'
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
        {onFavorite && layout === 'list' && (
          <DropdownMenuItem
            disabled={favoriteDisabled}
            onSelect={() => onFavorite(dataset.id)}
            data-cy="home-menu-favorite"
          >
            <Star size={16} />
            {favoriteIds?.includes(dataset.id) ? '取消收藏' : '收藏到首页'}
          </DropdownMenuItem>
        )}
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
        {dataset.access === 'owner' && dataset.canDelete === true && dataset.scope !== 'team' && (
          <DropdownMenuItem onSelect={() => onAction('delete', dataset, origin())} data-cy="home-menu-delete">
            <Trash2 size={16} />删除个人数据集
          </DropdownMenuItem>
        )}
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
      data-motion-item={`dataset:${dataset.id}`}
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

function DeskResource({ dataset, ...props }: { dataset: Dataset } & Props) {
  return (
    <article className={`mc-desk-resource ${dataset.id === props.selectedId ? 'is-selected' : ''}`}
      data-cy="home-dataset-row" data-motion-item={`dataset:${dataset.id}`}
      data-has-facts={props.fields.instances || props.fields.createdAt}>
      <div className="mc-desk-resource-identity">
        <NameButton dataset={dataset} selected={dataset.id === props.selectedId}
          onSelect={props.onSelect} registerTrigger={props.registerTrigger} />
        <div className="mc-desk-resource-context">
          <SourceLabel access={dataset.access} />
          {props.fields.owner && <span>{dataset.ownerUsername || '未提供'}</span>}
          {props.onFavorite && <FavoriteButton dataset={dataset}
            active={!!props.favoriteIds?.includes(dataset.id)} disabled={props.favoriteDisabled}
            onToggle={props.onFavorite} />}
        </div>
      </div>
      {(props.fields.instances || props.fields.createdAt) && <div className="mc-desk-resource-facts">
        {props.fields.instances && <span>{number.format(dataset.instanceCount)} <small>实例</small></span>}
        {props.fields.createdAt && <time dateTime={dataset.createdAt}>{date.format(new Date(dataset.createdAt))}</time>}
      </div>}
      {props.renderCoverage && <div className="mc-resource-coverage">{props.renderCoverage(dataset)}</div>}
      <div className="mc-desk-resource-actions">
        <Button variant="ghost" size="icon" onClick={() => props.onOpen(dataset)}
          title={`打开 ${dataset.name}`} aria-label={`打开 ${dataset.name}`} dataCY="home-row-open"><ArrowUpRight size={18} /></Button>
        <ResourceMenu dataset={dataset} {...props} />
      </div>
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
  const trigger = useRef<HTMLButtonElement>(null);
  useConfirmedFeedback(trigger, active, !disabled);
  return (
    <Button
      ref={trigger}
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
  const separateCoverage = props.presentation === 'desk' && !!props.renderCoverage;
  const columnCount = 2 + Object.values(fields).filter(Boolean).length + Number(separateCoverage);
  return (
    <table className="mc-resource-table" data-cy="home-datasets">
      <thead>
        <tr>
          <th>数据集</th>
          {fields.owner && <th data-field="owner">创建者</th>}
          {fields.instances && <th data-field="instances">实例数</th>}
          {fields.createdAt && <th data-field="createdAt">创建时间</th>}
          {separateCoverage && <th>CT 共享画布</th>}
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
              data-motion-item={`dataset:${dataset.id}`}
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
                {props.renderCoverage && !separateCoverage && (
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
              {separateCoverage && <td className="mc-desk-table-coverage">{props.renderCoverage?.(dataset)}</td>}
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
  const surface = useRef<HTMLDivElement>(null);
  useReflowMotion(
    surface,
    JSON.stringify([
      props.layout,
      props.density,
      props.grouped,
      props.fields,
      props.selectedId,
      props.datasets.map((dataset) => dataset.id),
    ])
  );
  if (props.layout === 'list')
    return (
      <div className={`mc-resource-table-scroll ${props.presentation === 'desk' ? 'mc-desk-table' : ''}`} ref={surface}>
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
    <div className={`mc-resource-index ${props.layout === 'rows' ? 'mc-desk-index' : props.presentation === 'desk' ? 'mc-desk-cards' : ''}`} data-cy="home-datasets" ref={surface}>
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
            data-resource-count={group.items.length}
          >
            {group.items.map((dataset) => (
              props.layout === 'rows'
                ? <DeskResource key={dataset.id} dataset={dataset} {...props} />
                : <ResourceCard key={dataset.id} dataset={dataset} {...props} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
