type Resource = {
  id: string;
  name: string;
  source: 'owner' | 'shared' | 'public';
  creator: string;
  instances: number;
  createdAt: string;
  ctFrames: number;
  canvasFrames: number;
  archiveFrames: number;
};

// Synthetic test data; independent of the local design preview.
const names = [
  '跨中心腹部影像一致性研究',
  '胸部 CT · 肺部结构整理',
  '头颈部影像 · 联合研究',
  '腹部 CT · 多器官标注集',
  '脑部 MR · 多序列资料',
  '公开教学 · 胸部 CT',
  '盆腔影像 · 第一轮整理',
  '心胸部 CT · 研究资料',
  '公开练习 · 影像标注入门',
  '腹部 CT · 第三轮补充与复核',
  '头颈部 CT · 研究伙伴共享',
  '公开教学 · 骨骼影像',
];

export function specimens(count = 12): Resource[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `preview-dataset-${index + 1}`,
    name: names[index % names.length] + (index >= 12 ? ` · ${index + 1}` : ''),
    source: (['owner', 'shared', 'public'] as const)[index % 3],
    creator: ['林知遥', '陈予安', '公共影像'][index % 3],
    instances: [1248, 864, 326, 2048, 612, 120][index % 6],
    createdAt: `2026-11-${String(5 - (index % 5)).padStart(2, '0')}`,
    ctFrames: index % 5 === 4 ? 0 : 120,
    canvasFrames: index % 5 === 4 ? 0 : [78, 24, 0, 48, 0, 120][index % 6],
    archiveFrames: index % 5 === 4 ? 0 : [60, 24, 0, 36, 0, 120][index % 6],
  }));
}
