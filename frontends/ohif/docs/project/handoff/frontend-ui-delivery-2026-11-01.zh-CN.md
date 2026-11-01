# MedCollab 前端 UI 交付说明（演示页）

日期：2026-11-01  
范围：`/workbench` 协作工作台、阅片页协作状态条、切片区块分工组件。  
状态：**前端页面已落地并在本机浏览器验证；真实 Java 后端闭环仍未接通。**

## 1. 这轮交付了什么

| 页面/组件 | 入口 | 当前能力 | 真实性 |
| --- | --- | --- | --- |
| 协作工作台 | `/workbench` | 4 个演示病例、分工方式切换（病例/序列/切片区块/器官禁用）、筛选/搜索、病例详情、协作者、版本历史、区块分工面板、打开标注/只读查看 | 页面真实；数据为 mock |
| 阅片页协作状态条 | 任意阅片页，`/medcollab` 无会话时显示演示态 | 病例/会话、编辑/只读、未保存/保存中/已保存、版本、租约、区块、保存/发布按钮、冲突提示 | 组件真实；无后端时只显示演示态 |
| 切片区块分工组件 | 工作台详情内嵌 | 120 层按 1–40/41–80/81–120 展示、负责人、状态、覆盖率、边界规则 | 组件真实；不读取/写入后端 |
| 工作台入口 | 阅片页 Header“工作台” | 返回 `/workbench` | 真实 |

## 2. 本地验证结果

- 构建：`pnpm --filter @ohif/app run build:viewer` 通过（rspack，exit 0；仅有原有 entrypoint 体积警告）。
- 单测：`medcollab-workspace` 3 个套件 **59/59 通过**（适配器 16、区块 23、协作状态 20）。
- 浏览器：Playwright 打开 `/workbench`、切换“按切片区块”、选择冲突病例、点击“打开标注”跳转 `/medcollab`，均无 `pageerror` / console error。
- 响应式：1280px 下无横向溢出。
- 截图：`output/medcollab-workbench.png`、`output/medcollab-viewer.png`（工作区根目录 `output/`，不是源码）。

## 3. 怎么跑

```bash
cd medcollab-ohif
OHIF_OPEN=false pnpm --filter @ohif/app run dev --host 127.0.0.1
```

- 工作台：`http://127.0.0.1:3000/workbench?lng=zh`
- 阅片页：`http://127.0.0.1:3000/medcollab?StudyInstanceUIDs=...&SeriesInstanceUIDs=...&lng=zh`

工作台“打开标注”在 mock 病例上只做页面跳转，并显示“演示导航：未接后端，不代表保存成功”。

## 4. 真实/模拟边界

**真实**

- 路由、页面渲染、筛选/搜索、分工方式切换、病例选择、区块可视化。
- 阅片页跳转、Header 工作台入口、协作状态条的 UI 状态机。
- 59 个前端单测、生产构建。

**模拟/未接**

- 4 个病例、协作者、版本历史、区块归属均为本地 mock。
- `annotationWorkspaceService.openCase` 的真实后端分支已写好，但 mock 病例没有 `backendCaseId`，本轮未执行。
- 保存/发布按钮在无后端时是禁用/“待接入”状态，不会伪造成功。
- 真实 Java session、RLE 草稿、发布、409 冲突、租约、审核仍未接。

## 5. 文件

- 工作台扩展：`extensions/medcollab-workbench/`
  - `src/WorkbenchPage.tsx`、`src/components/*`、`src/data/mockCases.ts`
  - 路由注册：`src/index.ts`，`routes.customRoutes` `$push` `/workbench`
- 协作状态条：`extensions/medcollab-workspace/src/collaboration/`
- 区块组件：`extensions/medcollab-workspace/src/blocks/`
- 阅片页 Header：`extensions/default/src/ViewerLayout/ViewerHeader.tsx`
- 插件注册：`platform/app/pluginConfig.json`（workbench 在 default 之后）
- 适配器测试修复：`extensions/medcollab-workspace/babel.config.js`（仅 test env 去掉冗余 regenerator 插件）

## 6. 已知限制

1. 工作台数据是 mock；不能作为“已接后端”证据。
2. 工作台 `openCase` 真实分支未联调；需要 Java/BFF 返回 `LaunchContext`。
3. 协作状态条在无会话时只显示“未绑定协作病例 · 演示模式”；保存/发布按钮不出现，避免误导。
4. 区块组件只做展示，没有区间裁剪、合并、发布校验；P1 后端增量见计划文档。
5. `pnpm-lock.yaml` 已补 workbench/medcollab importer；`pnpm install --frozen-lockfile` 的离线环境仍可能因本地 metadata 缓存缺包失败，联网环境应正常。
6. 测试修复只作用于 `medcollab-workspace` 的 test env；根 Babel 仍对其它包强制 regenerator，其他包含 `async` + `catch {}` 的测试可能遇到同一 Babel bug。

## 7. 下一步

详细执行清单见[下一步实施清单](./next-steps-2026-11-01.zh-CN.md)。

1. 接 Java/BFF：`GET session` → 工作台真实病例 → `openCase` launch context。
2. 接 RLE 草稿桥：保存/恢复/发布/409；状态条从 mock 切到真实事件。
3. 把区块组件接到真实区块分配与 `GET published`，实现块替换合并。
4. 补一条端到端 Playwright：A 保存 → 重开恢复 → 发布 → B 看到 → 409。
