import type { Dataset, User } from './api';

export const demoUsers: User[] = [
  { subject: 'demo-collaborator-a', username: '示例协作者 A' },
  { subject: 'demo-collaborator-b', username: '示例协作者 B' },
];

export function createDemoLibrary() {
  let sequence = 0;
  let datasets: Dataset[] = [
    {
      id: 'public-ctchest',
      name: 'CTChest 胸部 CT',
      access: 'public',
      ownerUsername: '公共影像',
      instanceCount: 139,
      createdAt: '2026-10-31T00:00:00Z',
    },
    {
      id: 'public-ctpelvis',
      name: 'CTPelvis 骨盆 CT',
      access: 'public',
      ownerUsername: '公共影像',
      instanceCount: 60,
      createdAt: '2026-10-31T00:00:00Z',
    },
    {
      id: 'demo-own-empty',
      name: '待导入的影像集',
      access: 'owner',
      ownerUsername: '本机示例',
      instanceCount: 0,
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'demo-shared-empty',
      name: '协作资料（空集）',
      access: 'shared',
      ownerUsername: '示例协作者 A',
      instanceCount: 0,
      createdAt: '2026-10-31T06:00:00Z',
    },
  ];
  const shares = new Map<string, User[]>();
  const list = () => datasets.map((item) => ({ ...item }));
  return {
    list,
    create(name: string) {
      const item: Dataset = {
        id: `demo-created-${++sequence}`,
        name: name.trim(),
        access: 'owner',
        ownerUsername: '本机示例',
        instanceCount: 0,
        createdAt: new Date().toISOString(),
      };
      datasets = [item, ...datasets];
      return { ...item };
    },
    rename(id: string, name: string) {
      datasets = datasets.map((item) => (item.id === id ? { ...item, name: name.trim() } : item));
    },
    listShares(id: string) {
      return (shares.get(id) || []).map((user) => ({ ...user }));
    },
    addShare(id: string, user: User) {
      const current = shares.get(id) || [];
      if (!current.some((item) => item.subject === user.subject))
        shares.set(id, [...current, { ...user }]);
    },
    removeShare(id: string, subject: string) {
      throw new Error('个人共享一经确认不可撤销');
    },
  };
}
export type DemoLibrary = ReturnType<typeof createDemoLibrary>;
