import { describe, expect, test } from 'vitest';
import { Files, UserRound, Share2, Globe2 } from 'lucide-react';
import { personalNavigation } from './navigation';

describe('shared personal library navigation', () => {
  test('keeps scope labels and the same icon references for both library surfaces', () => {
    expect(personalNavigation.map((item) => item.id)).toEqual(['all', 'owner', 'shared', 'public']);
    expect(personalNavigation.map((item) => item.label)).toEqual([
      '全部数据集',
      '我拥有的',
      '与我共享',
      '公共示例',
    ]);
    expect(personalNavigation.map((item) => item.icon)).toEqual([Files, UserRound, Share2, Globe2]);
  });
});
