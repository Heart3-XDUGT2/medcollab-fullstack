import type { Dataset } from './api';

export type ActivityDataset = Dataset & {
  scope: 'personal' | 'team';
  teamId: string | null;
  teamName: string | null;
};
export type FavoriteItem = { dataset: ActivityDataset; favoritedAt: string };
export type RecentItem = { dataset: ActivityDataset; lastOpenedAt: string };
export type ActivityPage<T> = { items: T[]; total: number; page: number; size: number };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const text = (v: unknown) => typeof v === 'string' && !!v.trim();
export function activityDataset(v: unknown): ActivityDataset {
  if (!object(v) || !text(v.id) || !text(v.name) ||
    !['owner', 'shared', 'public'].includes(v.access) || !['personal', 'team'].includes(v.scope) ||
    !(v.ownerUsername === null || typeof v.ownerUsername === 'string') ||
    !Number.isInteger(v.instanceCount) || v.instanceCount < 0 || !date(v.createdAt) ||
    !(v.teamId === null || text(v.teamId)) || !(v.teamName === null || text(v.teamName)) ||
    (v.scope === 'team' && (!text(v.teamId) || !text(v.teamName)))) throw new Error('活动数据集格式错误');
  return { ...v, ownerUsername: v.ownerUsername || '' } as ActivityDataset;
}
export function activityPage<T extends FavoriteItem | RecentItem>(
  v: unknown, kind: 'favorite' | 'recent', page: number
): ActivityPage<T> {
  if (!object(v) || !Array.isArray(v.items) || v.page !== page || v.size !== 20 ||
    !Number.isInteger(v.total) || v.total < 0 || v.items.length > v.size || v.items.length > v.total ||
    (kind === 'recent' && (!text(v.generation) || v.retentionDays !== 90 || v.maxItems !== 100))) {
    throw new Error('活动分页格式错误');
  }
  const key = kind === 'favorite' ? 'favoritedAt' : 'lastOpenedAt';
  const items = v.items.map((item: unknown) => {
    if (!object(item) || !date(item[key])) throw new Error('活动时间格式错误');
    return { dataset: activityDataset(item.dataset), [key]: item[key] } as T;
  });
  if (new Set(items.map(item => item.dataset.id)).size !== items.length) throw new Error('重复活动记录');
  return { items, total: v.total, page, size: v.size };
}
