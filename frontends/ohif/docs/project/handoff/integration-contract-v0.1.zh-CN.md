# 三人共用联调契约 v0.1

日期：2026-10-31  
状态：**提议稿，供第一、第二、第三人确认；接口未实现、地址未部署，不得当成现有 API 文档。**

目标：让工作台、OHIF 和后端操作同一个病例与同一份结果。先服务一个演示闭环，不预先设计多人同时修改同一体素的算法。

## 1. 唯一共同样例

已有公开测试影像可用于对齐：

| 字段 | 约定/状态 |
| --- | --- |
| 建议业务病例 ID | `demo-case-001`，仅示例业务 ID，尚未创建，不是 DICOM UID |
| 公开 StudyInstanceUID | `1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5` |
| 初始目标序列 | 已用于 ROI 测试的 CT，描述 `Body 3.0 CE`、SeriesNumber `2` |
| 实际 SeriesInstanceUID | 由第二人从真实影像提取、第三人在开发影像服务确认；禁止自行编造 |
| 源 manifest | 记录真实 Study/Series/SOP/frame、FoR、方向/间距/尺寸、内容版本或校验信息；第二、第三人共同确认 |
| 首个标注 | 一个“演示区域 A”分割，不代表解剖诊断或真实治疗建议 |
| 测试身份 | A＝标注员，B＝审核员；第三人创建并安全提供登录方式，文档不保存密码 |
| 数据分发 | 队友应使用同一已确认副本/服务；不能依赖当前电脑的 localhost |

公开样例的图像可浏览，不代表已确认团队再分发权利。第三人需核对对应数据条款，才将其镜像进团队服务。不得换成真实患者数据来省去联调准备。

将源 manifest 命名为 `demo-source-001` 只是业务标识建议，不替代真实 UID/几何清单。单靠序列描述或 SeriesNumber 不足以在所有数据中唯一定位序列。

## 2. 联调信息卡：必须由负责人回填

| 信息 | 负责人 | 当前值 |
| --- | --- | --- |
| 前端工作台开发地址 | 第一人 | 待实现 |
| 工作台使用的病例 ID | 第一、第三人 | 建议 `demo-case-001`，待创建确认 |
| API 基地址及版本 | 第三人 | 待提供 |
| DICOMweb QIDO/WADO/STOW 地址与各自能力 | 第三人 | 待提供，不默认 STOW 已启用 |
| 认证方式、会话获取、CORS/CSRF 约束 | 第三人 | 待提供；凭证不写进本文 |
| 机构/病例权限测试身份 | 第三人 | 待提供 |
| OHIF 构建基线、可访问地址及子路径 | 第二人 | 本机仅有 `http://127.0.0.1:3000/`，不是团队地址 |
| 注册的数据源 ID | 第二、第三人 | 待确认；不是任意 URL |
| 源 Series/FoR/SOP 清单 | 第二、第三人 | 待从共同数据提取 |
| 标注保存路径 | 第二、第三人 | 在“受控 STOW”与“后端受控工件接收”中明确首轮采用哪一种 |
| 一次保存成功与重开响应 | 第三人 | 待提供真实样例 |
| OHIF 适配层暴露形式 | 第一、第二人 | 默认建议同源路由/宿主集成，待确认；不默认为 iframe |
| ROI 补丁正式生效状态 | 第二人 | 查阅同期修复报告维护记录 |

信息卡未填完前，允许第一人使用遵循本文字段的 mock；mock 必须与真实联调验收区分。

## 3. 身份和数据对象

| 名称 | 含义与负责方 |
| --- | --- |
| `caseId` | 后端业务病例 ID；不等于患者 ID 或 Study UID |
| `sourceManifestId` | 绑定不可变源影像清单；第二人负责正确引用，第三人负责存储与授权 |
| `dataSourceId` | 第二人登记、第三人授权的数据源配置 ID；客户端不能借它任意访问服务器 |
| `draftVersionId` | 一次成功持久化的草稿快照 ID，不是浏览器内存对象 ID |
| `submissionVersionId` | 已提交审核的不可变版本 ID；后续修改产生新草稿/提交，不能覆盖已审核内容 |
| `artifactId` | 后端确认已持久化的结果工件 ID，可对应 SEG/SR/RTSTRUCT/工程元数据；不是临时 Blob URL |
| `revision` | 后端病例写版本，用于比较并交换；不能拿客户端本地时间充当 |
| `leaseId/generation` | 服务端编辑租约及代次；旧租约过期后，旧代次写入必须被拒绝 |

最小病例列表对象示意：

```json
{
  "caseId": "demo-case-001",
  "displayName": "公开 CT 演示病例",
  "sourceManifestId": "demo-source-001",
  "status": "assigned",
  "revision": "case-rev-1",
  "assigneeId": "annotator-a",
  "latestDraftVersionId": null,
  "latestSubmissionVersionId": null,
  "permissions": {
    "canView": true,
    "canEdit": true,
    "canSubmit": true,
    "canReview": false
  }
}
```

示例 ID 尚未在任何后端创建。`permissions` 仅供界面显示，后端必须对每次请求独立授权。

## 4. 工作台进入 OHIF：第一人与第二人的约定

建议第一人只提供以下入口意图，不直接拼接 Cornerstone 或 DICOM 参数：

```ts
type OpenCaseRequest = {
  caseId: string;
  intent: 'edit' | 'review' | 'view';
  versionId?: string;
  locale: 'zh' | 'en-US';
};

interface AnnotationWorkspaceBridge {
  openCase(request: OpenCaseRequest): Promise<void>;
  getEditState(): {
    dirty: boolean;
    saving: boolean;
    leaseValid: boolean;
  };
  saveDraft(): Promise<{
    draftVersionId: string;
    revision: string;
    persistedAt: string;
  }>;
  prepareToLeave(): Promise<'saved' | 'discard-confirmed' | 'stay'>;
}
```

这只是适配层契约草案，不是 OHIF 现有 API，也不要求把函数挂到 `window`。

第二人负责：

- 根据 caseId 获取授权的 launch context 和真实源 manifest。
- 将 `intent` 映射到受支持的 OHIF mode，配置只读行为，加载指定版本。
- `review` 必须固定到一个提交版本；未传 versionId 时先由后端返回明确的 submissionVersionId 再打开，不能一边审核一边自动跟随最新草稿。
- `edit` 以服务端返回的草稿和 revision 为起点；`view/review` 不因前端传入意图就获得写权限。
- 用经过确认的 Study/Series UID 和已登记数据源进入 OHIF，不把患者名当检索键。
- 保护未保存工作。`openCase`、返回工作台、语言刷新等路径不能默默丢弃标注。
- 保留合法 URL 参数和部署子路径；不能把访问 token 放进 URL。
- 在保存时复用 OHIF 的原生结果生成链，再对接第三人的持久化协议。
- 真正离开工作站时清理会话并尝试释放租约；断线/关页不能保证释放请求送达，所以服务端租约必须能自行过期。取消离开时不能提前丢弃会话。

状态通知建议最少有 `ready`、`dirtyChanged`、`saveStarted`、`saveSucceeded`、`saveFailed`、`leaseLost`。事件应带 `caseId` 和会话标识，防止切换病例后旧请求刷新新病例界面。

同源集成可使用受控回调/事件适配。若最终选 iframe，另行约定带版本的消息协议，固定 origin/source 校验和会话握手；不能使用无校验的 `postMessage('*')`。

## 5. 最小后端接口草案

以下路径是供第三人确认的业务 API，不是 OHIF 原生接口。所有时间用带时区的 ISO 8601，服务器为准。

| 操作 | 建议路径 | 关键返回 |
| --- | --- | --- |
| 病例列表 | `GET /api/v1/cases` | 授权过滤后的列表与分页 |
| 开启上下文 | `GET /api/v1/cases/{caseId}/launch-context?intent=edit` | 源 manifest、允许的数据源配置 ID、权限、revision、当前版本 |
| 获取版本 | `GET /api/v1/cases/{caseId}/versions/{versionId}` | 不可变版本描述、工件与源引用 |
| 获取编辑租约 | `POST /api/v1/cases/{caseId}/edit-leases` | leaseId、generation、expiresAt、续期规则 |
| 续租/释放 | `PUT` / `DELETE /api/v1/cases/{caseId}/edit-leases/{leaseId}` | 当前有效期或释放结果 |
| 持久化工件 | 首轮需确认一种实现，见下节 | 后端可验证的 artifactId，不是仅本地路径 |
| 提交草稿快照 | `POST /api/v1/cases/{caseId}/draft-versions` | draftVersionId、revision、persistedAt |
| 提交审核 | `POST /api/v1/cases/{caseId}/submissions` | 固定 submissionVersionId、新 status/revision |
| 定位评论 | `GET` / `POST /api/v1/cases/{caseId}/comments` | commentId、版本与定位锚点 |
| 审核决定 | `POST /api/v1/cases/{caseId}/reviews` | 针对指定提交版本的 approve/return 结果 |

`versionId` 作为 URL 中的业务标识不是授权凭证。后端仍校验当前身份能否读取该病例和版本，跨病例引用必须拒绝。

首轮不要求 CRDT、多人同时画同一分割、复杂任务引擎或通知系统全部实现。工作台不能据此提前展示这些功能已经可用。

## 6. 保存协议：第二人与第三人必须共同实现

保存的逻辑闭环固定，传输实现二选一并记录到信息卡：

1. 第二人从 OHIF 生成实际结果字节和结果描述，绑定源 manifest。
2. 若采用 DICOMweb，向批准的 STOW 服务存储，检查响应中的逐实例成功/失败，后端登记并验证实例；若采用工件接收接口，后端提供受控上传并校验结果。
3. 第三人将真实持久化对象登记为 `artifactId`。第三人需给出这一步的可运行请求示例，不能只回复“文件上传成功”。
4. 第二人调用草稿提交接口，传入已登记 artifactId、源 manifest、幂等键及当前 revision/租约。
5. 后端完成授权、对象完整性、源引用、租约和版本检查，原子提交版本索引后返回成功。
6. 第一人此时才显示“远端已保存”，再次打开应能获得这些工件。

两条存储路径不应都由第一人重复实现，也不能出现两套互相不知情的标注真相。源图和标注工件可分别存储，但来源与版本索引必须一致。

示意请求：

```http
POST /api/v1/cases/demo-case-001/draft-versions
If-Match: "case-rev-1"
Idempotency-Key: demo-save-operation-001
X-Edit-Lease-Id: demo-lease-001
X-Edit-Lease-Generation: 1
Content-Type: application/json
```

```json
{
  "sourceManifestId": "demo-source-001",
  "baseDraftVersionId": null,
  "artifactIds": ["demo-artifact-001"],
  "clientSchemaVersion": "annotation-workspace-v0.1"
}
```

只有此前上传/登记完成、归属正确的工件才允许提交；示例 artifactId 不是已存在对象。身份凭证由约定会话机制携带，此处不提供真实凭证。

成功响应建议：

```json
{
  "caseId": "demo-case-001",
  "draftVersionId": "demo-draft-001",
  "revision": "case-rev-2",
  "persistedAt": "2026-10-31T08:00:00Z"
}
```

每次保存使用一个唯一操作 ID；网络超时后，用同一幂等键查询或重试以确认结果。后端需检查同一键的载荷是否一致，不能把同键不同内容当成功。

工件写入和版本索引跨存储时，不假定自动具备数据库事务：允许暂存/未引用工件，但不能在索引提交或完整性确认失败时返回“版本已保存”。第三人定义清理与恢复策略。

## 7. 并发、状态和错误

建议首轮使用病例级单编辑租约。服务器校验身份、持有者、有效期和代次；锁图标只反映结果，不提供安全保证。另一用户可以按权限查看固定版本或评论，不能绕过租约写入。

- 草稿/提交流程写操作携带 `If-Match`；租约保护的写入还携带当前租约 ID/代次。
- 租约失效后立即停止远端写入，界面提示并保留可恢复的本地修改；重新获租约后仍需核对 revision，不能盲目覆盖。
- review、submit、assignment 等状态转换由后端事务决定，第一人不在浏览器中自行“设成通过”。
- 评论独立保存并绑定固定版本，不因一条新评论就改动标注内容版本。
- WebSocket 可以推送成员、租约或版本变更，但数据库/存储的成功响应才是持久化依据。

建议业务状态：`assigned -> in_progress -> submitted -> approved`；审核退回为 `returned`，再次编辑形成新草稿后重新提交。`in_progress` 不等于租约永不过期；历史提交在退回后仍保留。

| HTTP/错误码 | 含义 | 界面行为 |
| --- | --- | --- |
| `401 AUTH_REQUIRED` | 会话无效 | 重新认证，保留未保存状态；不循环重试写入 |
| `403 CASE_FORBIDDEN` | 无病例/操作权限 | 明确拒绝，不靠隐藏按钮代替 |
| `409 CASE_BUSY` | 其他人正在编辑 | 显示占用，可按权限只读进入 |
| `409 LEASE_EXPIRED` | 租约或代次失效 | 停止写入，进入恢复/冲突处理 |
| `412 REVISION_MISMATCH` | 版本已变化 | 显示新旧版本信息，不静默覆盖 |
| `422 INVALID_ARTIFACT` | 工件/源引用不完整 | 保留当前工作，指出不能保存的原因 |
| `5xx` 或网络超时 | 服务异常/结果未知 | 不显示已保存，按幂等协议确认结果 |

示意错误体：

```json
{
  "error": {
    "code": "REVISION_MISMATCH",
    "message": "病例已有更新，请比较版本后再保存。",
    "requestId": "demo-request-001",
    "currentRevision": "case-rev-3"
  }
}
```

## 8. 评论与审核的最小数据

评论必须包含 `caseId`、固定 `versionId`、文本及服务端记录的作者/时间。身份不得由客户端任填 authorId 冒充。

定位锚点至少记录：

- 实际 `FrameOfReferenceUID` 与患者 LPS 坐标（毫米），不能只存屏幕像素。
- 能获取时记录源 SOPInstanceUID/帧号、SeriesInstanceUID。
- 与特定分割区域有关时记录结果工件 ID 和该版本内的 segment 标识。
- 无法精确恢复定位时要提示，不能静默跳到另一结构。

第一人提供“点击评论定位”的交互，第二人负责从世界坐标恢复到正确影像/视口，第三人负责存储与版本权限。

审核对象必须是固定 `submissionVersionId`，决定为 `approve` 或 `return`。退回理由必填；过期审核、被替换的提交以及无权限审核应被服务端拒绝，而非覆写最新状态。

## 9. 冻结前的六个问题

1. 第二、第三人是否已从同一服务确认真实 CT Series/FoR/SOP 清单？
2. 第二人能否给出一次 `openCase` 调用和标注恢复示例，而不要求第一人访问私有工具状态？
3. 第三人能否给出实际存储和草稿提交的请求/响应，并说明何时算保存成功？
4. 能否用两个身份实际演示占用、越权拒绝和审核？
5. 失败或版本冲突时，谁负责返回状态、谁负责保留未保存工作，是否明确？
6. 三人是否同意首轮只实现这一闭环，并登记尚未实现的能力？

六项确认后，三人记录确认人、日期和契约版本。现在全部仍待确认。
