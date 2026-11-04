export type DemoActivity = Readonly<{
  favorites: readonly string[];
  recent: readonly { datasetId: string; openedAt: string }[];
}>;

/** Illustrative activity, not observations of a real workspace or account. */
export function createDemoActivity(): DemoActivity {
  return {
    favorites: ['demo-abdomen-first', 'demo-chest-joint', 'demo-abdomen-long'],
    recent: [
      { datasetId: 'demo-abdomen-first', openedAt: '2026-11-03T03:10:00Z' },
      { datasetId: 'demo-chest-joint', openedAt: '2026-11-02T08:30:00Z' },
      { datasetId: 'demo-abdomen-long', openedAt: '2026-11-01T02:15:00Z' },
    ],
  };
}
export function toggleDemoFavorite(activity: DemoActivity, id: string): DemoActivity {
  return {
    ...activity,
    favorites: activity.favorites.includes(id)
      ? activity.favorites.filter((value) => value !== id)
      : [...activity.favorites, id],
  };
}
export function removeDemoRecent(activity: DemoActivity, id?: string): DemoActivity {
  return { ...activity, recent: id ? activity.recent.filter((item) => item.datasetId !== id) : [] };
}
