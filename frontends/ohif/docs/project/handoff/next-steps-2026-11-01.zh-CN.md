# MedCollab 下一步实施清单

日期：2026-11-01  
基线：当前分支已包含 `/workbench` 演示页、阅片页协作状态条、切片区块组件，以及 `medcollab-workspace` 的 59 项前端测试。  
目标：把“页面能看”推进到“两个账号能真实保存、重开、发布、冲突、分区合并”。

> 本文是执行清单，不是已完成功能声明。真实 Java/BFF 未接通前，工作台仍然使用 mock 数据，保存/发布保持禁用或“待接入”，不得对外声称已完成协作闭环。

## 0. 当前真实状态

| 项目 | 状态 | 证据/位置 |
| --- | --- | --- |
| `/workbench` 页面 | 已完成（mock） | `extensions/medcollab-workbench/`；路由 `/workbench` |
| 阅片页协作状态条 | 已完成（无后端时演示态） | `extensions/medcollab-workspace/src/collaboration/` |
| 切片区块展示组件 | 已完成（不接后端） | `extensions/medcollab-workspace/src/blocks/` |
| 适配器状态机 | 已有，16 用例通过 | `AnnotationWorkspace.ts`、`AnnotationWorkspace.test.ts` |
| OHIF 影像/SEG | 单标签单序列往返有记录 | `owner-2-seg-verification-2026-10-31.zh-CN.md` |
| Java 会话/影像集/草稿/发布 | 后端已有；本机未联调 | 《医学标注服务器-前端接口交接》 |
| 真实 launch context / DICOMweb / RLE 桥 | **未实现** | 本轮最大缺口 |
| 租约、审核、评论、不可变版本 | **未实现** | 需要 BFF/Java 新增 |
| 构建 | 通过（rspack，exit 0） | `pnpm --filter @ohif/app run build:viewer` |
| 前端测试 | 59/59 通过 | 适配器 16、区块 23、状态条 20 |

## 1. 第一优先级：打通真实一条链

顺序不能反：**先有受控影像和 launch context，再谈保存；先有 RLE 往返，再谈工作台真实数据。**

### 1.1 冻结 v0.2 契约（Java 对齐）

当前适配器按“cases + lease + artifact + commit”设计，Java 实际是“datasets + workspace + RLE draft + publish”。v0.2 必须按 Java 改，而不是让 Java 再实现一套版本体系。

需要确认/新增：

- `LaunchContext`：`caseId`、`datasetId`、`seriesId`、`StudyInstanceUID`、`SeriesInstanceUID`、`FrameOfReferenceUID`、切片清单、权限、当前 `Workspace`。
- `SourceImage` 增加 `studyInstanceUID`、`seriesInstanceUID`（或由 BFF/Orthanc 查询补齐）。当前只有 Orthanc `seriesId` 和 SOP UID，OHIF 无法直接打开。
- 草稿保存改为 `PUT /draft`，请求体 `{ revision, baseVersion, label, masks }`；不再走 SEG artifact 上传。
- 发布改为 `POST /publish`，请求体 `{ draftRevision, expectedPublishedVersion }`。
- 新增只读端点 `GET .../segmentations/{seriesId}/published`，返回最新发布版 `masks`（RLE），供 P1 块合并使用；没有它，客户端只能解码 SEG。
- 租约/审核/评论放在 BFF 或 Java 新模块；不要让前端用“界面只读”冒充权限。

**验收**：一条真实病例从 `/workbench` 打开，能拿到完整 launch context；不依赖 mock 或公共 CloudFront 兜底。

### 1.2 受控影像读取入口

OHIF 需要 DICOMweb 或自定义 DataSource。优先做同源 `/dicom-web` 反向代理：

- 校验 Java session + 影像集权限；
- QIDO/WADO/metadata/frames/SEG 都走同一权限边界；
- 不把 Orthanc 地址直接暴露给浏览器；
- 处理 CORS、Cookie、CSRF、SPA fallback 和静态资源白名单。

备选：自定义 OHIF DataSource 调 Java `/instances` + `/file`，但需要补齐 DICOM metadata/几何，工作量更大、风险更高。

**验收**：未共享账号请求同一 Study 的实例被拒绝；共享账号能加载 CT；发布后的 SEG 能加载。

### 1.3 RLE ↔ labelmap 桥（最高技术风险）

先做一天 spike，不要先排 UI：

1. 在 OHIF 画一笔。
2. 从 labelmap 取像素，按 `instanceId` 编码 RLE。
3. `PUT draft`。
4. `GET workspace`。
5. 恢复为 labelmap。
6. 比对体素位置、切片顺序、方向、翻转、重采样。

必须核对：

- SOP UID ↔ Java `instanceId` 的映射（来自 `SourceImage.sopInstanceUID`）。
- 只提交自己区间的掩码；区间外必须为零。
- 保存串行；请求发出后又画的笔画保留为新的 dirty。
- 409/423/超时保留本地内容，不静默覆盖。
- 发布前等待草稿保存成功，再传 `draftRevision` 与 `expectedPublishedVersion`。

**验收**：关闭页面重开，体素与源图位置一致；A 的私有草稿 B 看不到；A 发布后 B 能看到。

### 1.4 把工作台从 mock 切到真实数据

- 增加 `MedCollabApi` 客户端：session、datasets、sources、workspace、draft、publish、status、shares。
- 用真实 `datasetId + seriesId + backendCaseId` 替换 `MOCK_CASES`；保留 `VITE`/环境变量开关，无后端时回退 mock，但横幅必须明确。
- 登录：`/auth/login`、`/api/session`、CSRF、401 重登、退出清理。
- 工作台需要 loading/empty/error/403/404 状态，不能只展示成功路径。
- “打开标注”优先调用 `annotationWorkspaceService.openCase`；mock 回退只用于 UI 彩排。

**验收**：真实账号 A 登录后只看到自己有权限的病例；B 未被共享时看不到私有病例。

## 2. 第二优先级：发布、冲突、租约

### 2.1 适配器补 `publishDraft`

当前 `CollaborationBar` 检测 `workspace.publishDraft`，但适配器没有这个方法，所以按钮显示“待接入”。需要：

- `AnnotationWorkspace.publishDraft()`：先 `saveDraft`，再 `POST publish`，返回 `Workspace`。
- 成功事件带 `publishedVersion`、`orthancId`、`publishedBy`。
- 423 有界重试；超时先查 `GET status`，不要重复发布。
- 状态条显示发布中/已发布/失败，区分“草稿已保存”和“已发布”。

### 2.2 单写者租约（弱保证 → 强保证）

Java 目前没有租约。两条路：

- **薄 BFF**：`POST/PUT/DELETE /api/v1/cases/{caseId}/edit-leases`，表存 `leaseId/generation/expiresAt`；前端已有 `acquireLease/renewLease/releaseLease` 逻辑。
- **暂不做强租约**：保留“界面占用提示 + 发布 409”的弱保证，演示时明确说明。

无论哪条，服务端必须拒绝过期代次写入；`readOnly` 只是 UI 提示。

**验收**：A 持有租约时 B 只读；租约过期后旧代次写入被拒；B 接管后基于最新版本继续。

### 2.3 409/423 的用户路径

- 409：展示“有人先发布了新版本”，保留本地掩码，提供“重新载入并合并”/“放弃本地”。
- 412/版本不匹配（如 BFF 采用）：同 409。
- 423：短重试，不弹“保存成功”。
- 401：保留未保存内容，重新登录后恢复。
- 网络超时：用同一 `operationId` 查询/重试，避免重复版本。

## 3. 第三优先级：切片区块并行（P1）

前置：`GET published` + 区块分配表 + 发布校验。

### 3.1 区块分配

- 120 层拆 3 段：`1–40`、`41–80`、`81–120`。
- 每段一个 owner；同一段不能两个 owner。
- 边界规则：相邻段各多看 2 层作为上下文，只有归属者能写；跨边界结构按中心层/多数层归属，边界层由下一段 owner 复核。
- 前端在工作台显示 owner/状态；阅片页显示“我的区块”和越界提示。

### 3.2 块替换合并

```text
M[slice] = L[slice]   if a <= slice <= b
M[slice] = P[slice]   otherwise
```

- `P` = 最新发布版 RLE（`GET published`）
- `L` = 本人本地掩码（只含自己区间）
- 不能用并集：本人擦除的一笔会被旧发布版复活。
- 409 后重新拉 `P`，重新合并，最多 2–3 次；仍失败保留本地并提示。
- 服务端校验越界像素和 owner；不能只靠前端裁剪。

### 3.3 前端增量

- 区块指示、他人区块只读叠加、边界层标记。
- 保存前裁剪越界像素；画笔/擦除后立即提示。
- 合并状态：`仅我的区块` / `已合并他人最新版` / `冲突待处理`。
- 验收：A 擦除自己区间的一笔，B 的区块不受影响；边界结构连续；同一区块不能双写。

## 4. 第四优先级：审核与评论（P2）

需要后端新增，不是前端开关：

- 不可变 submission 版本（当前只有最新 `publishedVersion` 计数器）。
- 版本列表、固定版本重开。
- 评论锚点（版本 + 世界坐标/ROI）。
- 角色权限、通过/退回状态机、审计。
- 前端：版本选择、只读审核模式、评论面板、定位跳转。

验收：A 提交 → B 打开固定版本 → 评论/退回 → A 基于退回版本修改 → 重新提交；旧版本和原评论不变。

## 5. 部署与安全

- 统一入口：优先同源反向代理；Java 目前无 CORS、无通用 SPA fallback，OHIF 静态资源白名单需补。
- Keycloak 回调固定 `8080`，跨端口会跳回 Java 首页；演示/正式都要确认登录落点。
- Cookie `MEDICAL_DEMO_SESSION`、CSRF、30 分钟空闲超时；401/403 不能靠隐藏按钮。
- 不把 token 放 URL；不在日志/截图/仓库放凭证。
- 影像数据只使用已确认的公开/脱敏样例；公开样例再分发条款需第三人确认。

## 6. 测试与 CI

必须补的端到端用例：

1. A 登录 → 工作台 → 打开真实 CT。
2. 画一笔 → 保存 → 关闭 → 重开，体素一致。
3. B 登录同一病例，看不到 A 的私有草稿。
4. A 发布 → B 轮询/刷新看到发布版。
5. A/B 都基于 v0，A 先发布，B 发布得 409，本地内容不丢。
6. 未共享账号 403/404；撤销共享后像素/SEG 不可读。
7. P1：A 只改 1–40，B 只改 41–80；A 发布后 B 合并，A 区块不丢。
8. 构建 + 59 项前端单测 + 新 E2E 全绿。

测试环境注意：

- 适配器测试的 Babel 修复只作用于 `medcollab-workspace` 的 test env；根配置仍对其它包强制 regenerator，其他含 `async + catch {}` 的测试可能复现同一 bug。
- 不要在无备份的沙箱里直接跑 `pnpm install --frozen-lockfile`；本轮曾清空 `node_modules`，已从原 pnpm store 恢复。CI 应使用独立缓存/工作目录。

## 7. 建议的两周排期

| 时间 | 负责人 | 交付 |
| --- | --- | --- |
| 第 1 天 | 第三人 | 两个真实账号、私有数据集、`SourceImage` 补 UID、`GET published` 草案 |
| 第 1–2 天 | 第二人 | RLE 往返 spike（画→RLE→PUT→GET→恢复→像素比对） |
| 第 2–3 天 | 第二/第三人 | 同源 `/dicom-web` 代理或自定义 DataSource；真实 CT 在 OHIF 打开 |
| 第 3–5 天 | 第一人 | 工作台接真实 session/datasets；错误/空态；打开真实病例 |
| 第 5–7 天 | 第二/第一人 | 状态条接真实保存/发布/409；关闭重开恢复 |
| 第 8–10 天 | 三人 | 区块分配 + 块替换合并 + 边界验收 |
| 第 11–14 天 | 三人 | 审核/评论最小闭环、E2E、部署与演示彩排 |

如果周一仍要演示：先做“单写者 + 真实保存/发布/409”，同图区块只演示 UI/录屏，不要用假合并。Go/No-Go 判据见 `collaboration-plan-2026-11-01.zh-CN.md` 第 5.2 节。

## 8. 今天就能开始的三件事

1. **第三人**：给 `SourceImage` 补 `studyInstanceUID/seriesInstanceUID`，并提供一条真实病例的 launch context；同时给出 `GET .../published` 的返回样例。
2. **第二人**：做 1.3 的 RLE spike，先用一条真实切片，不接工作台；通过后再改 `OHIFWorkspaceDriver`。
3. **第一人**：把工作台的 `MOCK_CASES` 抽成 `MedCollabApi` 接口 + mock 实现，保留环境开关；先接 `/api/session` 和 `/api/datasets`，不接保存。

## 9. 不要现在做

- 不要做 2D 网格/瓦片分工（CT 结构跨块，接缝不可控）。
- 不要做多器官多标签（需要 Java 数据模型升级，P2）。
- 不要让前端直接解码/编码 SEG 来做草稿（先走 RLE；SEG 只用于发布/只读）。
- 不要把“界面禁用画笔”当服务端权限。
- 不要在未确认 `baseVersion` 语义前假设块替换一定能发布；先 spike 再排期。
- 不要用 mock 保存成功撑演示；宁可显示“未接通”。

## 10. 相关文件

- 分工与前端计划：`docs/project/handoff/collaboration-plan-2026-11-01.zh-CN.md`
- 前端 UI 交付说明：`docs/project/handoff/frontend-ui-delivery-2026-11-01.zh-CN.md`
- 共同契约 v0.1（草案）：`docs/project/handoff/integration-contract-v0.1.zh-CN.md`
- 适配器：`extensions/medcollab-workspace/src/AnnotationWorkspace.ts`
- 驱动：`extensions/medcollab-workspace/src/OHIFWorkspaceDriver.ts`
- 工作台：`extensions/medcollab-workbench/src/WorkbenchPage.tsx`
- 状态条：`extensions/medcollab-workspace/src/collaboration/CollaborationBar.tsx`
- 区块组件：`extensions/medcollab-workspace/src/blocks/BlockAssignmentPanel.tsx`
