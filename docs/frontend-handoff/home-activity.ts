/** Backend v1 and Portal/OHIF hookup implemented and verified on 2026-11-04. */
export type ActivityDataset = {
  id: string;
  name: string;
  access: 'owner' | 'shared' | 'public';
  scope: 'personal' | 'team';
  ownerUsername: string | null;
  instanceCount: number;
  createdAt: string;
  teamId: string | null;
  teamName: string | null;
};
export type ActivityPage<T> = { items: T[]; total: number; page: number; size: number };
export type FavoriteItem = { dataset: ActivityDataset; favoritedAt: string };
export type RecentItem = { dataset: ActivityDataset; lastOpenedAt: string };
export type RecentPage = ActivityPage<RecentItem> & { generation: string; retentionDays: number; maxItems: number };
export type RecentContext = { generation: string; retentionDays: number; maxItems: number; expiresAt: string };
export type OpenRequest = { eventId: string; generation: string };
export type OpenResult = { success: true; datasetId: string; lastOpenedAt: string; duplicate: boolean };
export type FavoriteResult = { success: true; datasetId: string; favorited: boolean; favoritedAt: string | null };
export type FavoriteState = { datasetId: string; favorited: boolean; favoritedAt: string | null };
export type RecentClearResult = { success: true; generation: string };
export type ActivityError = { error: string; code?: 'INVALID_ACTIVITY_REQUEST' | 'RECENT_CONTEXT_STALE' | 'EVENT_ID_REUSED' };
