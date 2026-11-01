import type {
  CaseStatus,
  Collaborator,
  DemoUser,
  DivisionMode,
  WorkbenchCase,
  WorkbenchFilter,
} from '../types';

/**
 * Mock data for the /workbench demo page.
 *
 * These are fictional demo cases. Only MC-2026-001 carries a public demo
 * Study/Series UID (the public CT used elsewhere in this demo); the other cases
 * are UI-only placeholders without a source image, so their open buttons stay
 * disabled. No patient names, credentials or private data are used.
 */

export const DEMO_CURRENT_USER: DemoUser = {
  id: 'demo-a',
  name: '演示用户 A',
  role: '标注员',
};

const USER_B: DemoUser = {
  id: 'demo-b',
  name: '演示用户 B',
  role: '复核员',
};

const USER_C: DemoUser = {
  id: 'demo-c',
  name: '演示用户 C',
  role: '标注员',
};

export interface DivisionModeMeta {
  value: DivisionMode;
  label: string;
  shortLabel: string;
  hint: string;
  disabled?: boolean;
}

export const DIVISION_MODES: DivisionModeMeta[] = [
  {
    value: 'case',
    label: '按病例',
    shortLabel: '病例',
    hint: '以一个病例为单位分工；详情突出负责人、版本和审核状态。',
  },
  {
    value: 'series',
    label: '按序列',
    shortLabel: '序列',
    hint: '以序列为单位分工；详情突出序列与序列 UID。',
  },
  {
    value: 'block',
    label: '按切片区块',
    shortLabel: '区块',
    hint: '以层范围为区块分工；详情展示区块归属与区块插槽。',
  },
  {
    value: 'organ',
    label: '按器官（P2，禁用）',
    shortLabel: '器官',
    hint: '需要后端多标签数据模型，P2 阶段再做，本页禁用。',
    disabled: true,
  },
];

export const DIVISION_MODE_LABEL: Record<DivisionMode, string> = {
  case: '按病例',
  series: '按序列',
  block: '按切片区块',
  organ: '按器官（P2）',
};

export interface StatusMeta {
  label: string;
  className: string;
  description: string;
}

export const STATUS_META: Record<CaseStatus, StatusMeta> = {
  annotating: {
    label: '标注中',
    className: 'border-primary/40 bg-primary/15 text-primary',
    description: '演示状态：标注进行中',
  },
  review: {
    label: '待审核',
    className: 'border-highlight/40 bg-highlight/15 text-highlight',
    description: '演示状态：等待审核，审核流程未接通后端',
  },
  published: {
    label: '已发布',
    className: 'border-border bg-muted text-foreground',
    description: '演示状态：已发布（mock 版本号）',
  },
  conflict: {
    label: '冲突',
    className: 'border-destructive/40 bg-destructive/15 text-destructive',
    description: '演示状态：区块归属冲突待处理',
  },
};

export const FILTERS: { value: WorkbenchFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'mine', label: '我负责' },
  { value: 'shared', label: '共享给我' },
  { value: 'review', label: '待审核' },
];

const collaboratorsFor = (users: DemoUser[], access: string): Collaborator[] =>
  users.map(user => ({ ...user, access }));

export const MOCK_CASES: WorkbenchCase[] = [
  {
    caseId: 'MC-2026-001',
    name: '公开 CT 胸部演示',
    modality: 'CT',
    seriesDescription: '胸部 CT · 肺窗',
    studyInstanceUID: '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5',
    seriesInstanceUID: '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.11',
    seriesCount: 1,
    sliceCount: 120,
    status: 'annotating',
    owner: DEMO_CURRENT_USER,
    divisionMode: 'block',
    version: 'v3',
    updatedAt: '2026-11-01 09:42',
    collaborators: [
      { ...USER_B, access: '区块 41–80 · 编辑' },
      { ...USER_C, access: '区块 81–120 · 编辑' },
    ],
    versions: [
      {
        version: 'v3',
        author: '演示用户 B',
        createdAt: '2026-11-01 09:42',
        note: '区块 41–80 草稿更新（演示记录）',
      },
      {
        version: 'v2',
        author: '演示用户 A',
        createdAt: '2026-10-31 18:05',
        note: '区块 1–40 发布（演示记录）',
      },
      {
        version: 'v1',
        author: '演示用户 A',
        createdAt: '2026-10-31 15:20',
        note: '初始发布（演示记录）',
      },
    ],
    blocks: [
      {
        blockId: 'block-1',
        sliceRange: '1–40',
        ownerId: DEMO_CURRENT_USER.id,
        ownerName: DEMO_CURRENT_USER.name,
        note: '当前用户负责',
      },
      { blockId: 'block-2', sliceRange: '41–80', ownerId: USER_B.id, ownerName: USER_B.name },
      { blockId: 'block-3', sliceRange: '81–120', ownerId: USER_C.id, ownerName: USER_C.name },
    ],
    description: '公开胸部 CT 演示数据（120 层），用于验证按切片区块分工的界面跳转。',
  },
  {
    caseId: 'MC-2026-002',
    name: '腹部 CT 复查',
    modality: 'CT',
    seriesDescription: '腹部 CT · 门脉期',
    studyInstanceUID: '',
    seriesInstanceUID: '',
    seriesCount: 1,
    sliceCount: 88,
    status: 'review',
    owner: USER_B,
    divisionMode: 'case',
    version: 'v1',
    updatedAt: '2026-10-31 20:18',
    collaborators: collaboratorsFor([DEMO_CURRENT_USER, USER_C], '共享 · 只读'),
    versions: [
      {
        version: 'v1',
        author: '演示用户 B',
        createdAt: '2026-10-31 20:18',
        note: '提交审核（演示记录）',
      },
    ],
    description: '腹部 CT 复查演示病例，按病例分工；当前等待审核（审核流程未接通后端）。',
  },
  {
    caseId: 'MC-2026-003',
    name: '胸部 CT 教学例',
    modality: 'CT',
    seriesDescription: '胸部 CT · 纵隔窗',
    studyInstanceUID: '',
    seriesInstanceUID: '',
    seriesCount: 2,
    sliceCount: 60,
    status: 'published',
    owner: DEMO_CURRENT_USER,
    divisionMode: 'series',
    version: 'v4',
    updatedAt: '2026-10-30 16:00',
    collaborators: collaboratorsFor([USER_B], '共享 · 只读'),
    versions: [
      {
        version: 'v4',
        author: '演示用户 A',
        createdAt: '2026-10-30 16:00',
        note: '教学例发布（演示记录）',
      },
      {
        version: 'v3',
        author: '演示用户 B',
        createdAt: '2026-10-29 11:12',
        note: '序列 2 修订（演示记录）',
      },
    ],
    description: '胸部 CT 教学演示病例，按序列分工；已发布版本仅用于界面展示。',
  },
  {
    caseId: 'MC-2026-004',
    name: '骨盆 CT 协作例',
    modality: 'CT',
    seriesDescription: '骨盆 CT · 骨窗',
    studyInstanceUID: '',
    seriesInstanceUID: '',
    seriesCount: 1,
    sliceCount: 60,
    status: 'conflict',
    owner: USER_C,
    divisionMode: 'block',
    version: 'v2',
    updatedAt: '2026-11-01 08:15',
    collaborators: [
      { ...USER_B, access: '区块 31–60 · 编辑 · 冲突' },
      { ...DEMO_CURRENT_USER, access: '共享 · 只读' },
    ],
    versions: [
      {
        version: 'v2',
        author: '演示用户 C',
        createdAt: '2026-11-01 08:15',
        note: '区块 1–30 发布（演示记录）',
      },
      {
        version: 'v2',
        author: '演示用户 B',
        createdAt: '2026-11-01 08:10',
        note: '区块 31–60 发布冲突（演示记录）',
      },
      {
        version: 'v1',
        author: '演示用户 C',
        createdAt: '2026-10-31 10:30',
        note: '初始发布（演示记录）',
      },
    ],
    blocks: [
      {
        blockId: 'block-4',
        sliceRange: '1–30',
        ownerId: USER_C.id,
        ownerName: USER_C.name,
      },
      {
        blockId: 'block-5',
        sliceRange: '31–60',
        ownerId: USER_B.id,
        ownerName: USER_B.name,
        note: '归属冲突待处理',
      },
    ],
    description: '骨盆 CT 协作演示病例；区块 31–60 归属冲突，仅用于界面展示。',
  },
];
