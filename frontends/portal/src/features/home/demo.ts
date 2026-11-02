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
    {
      id: 'demo-abdomen-first',
      name: '腹部 CT · 多器官标注集',
      access: 'owner',
      ownerUsername: '本机示例',
      instanceCount: 1248,
      createdAt: '2026-10-29T02:00:00Z',
    },
    {
      id: 'demo-chest-joint',
      name: '胸部影像 · 联合整理',
      access: 'shared',
      ownerUsername: '示例协作者 A',
      instanceCount: 864,
      createdAt: '2026-10-28T02:00:00Z',
    },
    {
      id: 'demo-abdomen-contrast',
      name: '腹部增强 CT · 对照资料',
      access: 'owner',
      ownerUsername: '本机示例',
      instanceCount: 1536,
      createdAt: '2026-10-27T02:00:00Z',
    },
    {
      id: 'demo-brain-mr',
      name: '脑部 MR · 多序列样例',
      access: 'shared',
      ownerUsername: '示例协作者 B',
      instanceCount: 512,
      createdAt: '2026-10-26T02:00:00Z',
    },
    {
      id: 'demo-chest-small',
      name: '胸部 CT · 小样本整理',
      access: 'owner',
      ownerUsername: '本机示例',
      instanceCount: 248,
      createdAt: '2026-10-25T02:00:00Z',
    },
    {
      id: 'demo-abdomen-long',
      name: '跨中心腹部影像一致性研究 · 第三轮补充与复核资料集',
      access: 'owner',
      ownerUsername: '本机示例',
      instanceCount: 2048,
      createdAt: '2026-10-24T02:00:00Z',
    },
    {
      id: 'demo-head-practice',
      name: '头部影像 · 研究生练习',
      access: 'owner',
      ownerUsername: '本机示例',
      instanceCount: 192,
      createdAt: '2026-10-23T02:00:00Z',
    },
    {
      id: 'demo-spine-mr',
      name: '脊柱 MR · 观察样例',
      access: 'shared',
      ownerUsername: '示例协作者 A',
      instanceCount: 384,
      createdAt: '2026-10-22T02:00:00Z',
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
