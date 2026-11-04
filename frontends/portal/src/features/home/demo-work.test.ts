import { describe, expect, test } from 'vitest';
import { createDemoActivity, removeDemoRecent, toggleDemoFavorite } from './demo-work';

describe('ephemeral demo activity, not a real navigation recorder', () => {
  test('favorite toggling is reversible and does not change recent records', () => {
    const initial = createDemoActivity(),
      original = JSON.stringify(initial);
    const removed = toggleDemoFavorite(initial, initial.favorites[0]);
    expect(removed.favorites).not.toContain(initial.favorites[0]);
    expect(toggleDemoFavorite(removed, initial.favorites[0]).favorites).toContain(
      initial.favorites[0]
    );
    const added = toggleDemoFavorite(initial, 'demo-own-empty');
    expect(added.favorites).toContain('demo-own-empty');
    expect(added.recent).toEqual(initial.recent);
    expect(JSON.stringify(initial)).toBe(original);
  });
  test('remove/clear changes only illustrative recent records; a new demo resets them', () => {
    const initial = createDemoActivity();
    expect(removeDemoRecent(initial, initial.recent[0].datasetId).recent).toHaveLength(
      initial.recent.length - 1
    );
    expect(removeDemoRecent(initial).recent).toEqual([]);
    expect(removeDemoRecent(initial).favorites).toEqual(initial.favorites);
    expect(createDemoActivity()).toEqual(initial);
  });
});
