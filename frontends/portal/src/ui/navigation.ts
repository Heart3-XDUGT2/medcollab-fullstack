import { Files, UserRound, Share2, Globe2 } from 'lucide-react';

export const personalNavigation = [
  { id: 'all', label: '全部数据集', icon: Files },
  { id: 'owner', label: '我拥有的', icon: UserRound },
  { id: 'shared', label: '与我共享', icon: Share2 },
  { id: 'public', label: '公共示例', icon: Globe2 },
] as const;
