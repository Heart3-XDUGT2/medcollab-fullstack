# 登录与数据集首页：现有后端接口契约

> 当前部署说明：2026-11-01 已接入真实 Java/Keycloak/Orthanc，并启用 OHIF。接手修改请先读 [当前完整开发交接](../handoff/current-server/前端开发维护与兼容性指南.md)。本文件下方保留最初的 Portal 子集契约及移交时的联调状态；其中“尚待联调”等历史状态不能代替当前实现。OpenAPI 仍只覆盖 Portal 子集，不覆盖 OHIF 接口。

版本：0.1，整理日期：2026-11-01。

适用范围：MedCollab Portal 的登录入口、数据集首页、上传与共享。

机器可读对应文件：[openapi.yaml](./openapi.yaml)。

> 本文依据队友 2026-10-31 的《医学标注服务器：前端接口交接》《MedCollab OHIF 与现有后端兼容性评估》，以及迁移源 `medcollab-ohif` 提交 `abe5bc8a4` 中的 `api.ts`、`upload.ts` 整理。后端能力属于交接方的实现声明；本轮没有运行或独立验收 Java 服务。OpenAPI 是仓库内的协议描述，不表示后端已部署 Swagger，也不代表真实账号、上传和权限联调已通过。

本文不定义医学标注编辑、标签体系、完成进度、训练集导出或模型服务。相关规划不能混入这些已约定的路径。

## 1. 谁负责什么

- **Portal**：展示状态、调用已约定 API、保留待提交内容、区分示例与真实模式。
- **Java / Spring Boot**：Keycloak OIDC 会话、CSRF、每次资源授权、数据集和共享业务、受控导入。
- **Keycloak**：账号登录、注册与 SSO；普通前端不调用其管理后台。
- **Orthanc**：底层 DICOM 存储；Portal 不直连裸 Orthanc，也不向浏览器提供其长期凭证。
- **OHIF 工作界面**：不是本仓库的影像引擎。启动上下文和影像读取另由工作界面与后端约定；本文件不把已有数据集 ID 变成 DICOM UID。

## 2. 入口、部署和认证

### 2.1 地址与请求方式

原交接的开发服务地址是 Java `http://127.0.0.1:8080`、Orthanc `8042`、Keycloak `8081`。这些是交接方本机地址，不是其他电脑可直接使用的联调服务。

业务代码请求相对 `/api/...`，使用：

```typescript
fetch('/api/session', {
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
});
```

正式部署应将 Portal 与 `/api` 置于同一受控站点；独立开发端口需要代理或与后端另行配置 CORS。当前后端没有通用 CORS。`/api` 失败不能被 SPA fallback 改成 `200 text/html`。

登录、注册是**浏览器页面导航**，不是上述 JSON fetch：

- `GET /auth/login`
- `GET /auth/register`

前端以部署配置中的可信 Java origin 构造这两个地址。不得从任意查询参数、localStorage 或用户输入取得认证目的地；不得发送用户名密码到不存在的 `/api/login`。

### 2.2 Cookie 和 CSRF

| 项目              | 当前交接约定                                                 |
| ----------------- | ------------------------------------------------------------ |
| 会话 Cookie       | `MEDICAL_DEMO_SESSION`                                       |
| Cookie 属性       | `HttpOnly`、`SameSite=Lax`；由浏览器管理，不由 JS 读取或写入 |
| 空闲超时          | 交接设置为 30 分钟；请求可能续期，服务重启也可能失效         |
| CSRF 来源         | `GET /api/session` 的 `csrfHeaderName` 和 `csrfToken`        |
| 哪些请求需要 CSRF | 本文的 `POST`、`PUT`、`PATCH`、`DELETE`                      |
| Bearer JWT        | 当前 Java 契约不使用，Portal 不获取、持久化或发送它          |
| 缓存              | 会话/业务读取采用 no-store；退出、换账号、失权时清理本组内存 |

请求头名必须使用本次 session 的返回值；`X-CSRF-TOKEN` 只是常见示例，不是客户端写死的协议。Cookie、CSRF、SSO 退出地址及 OIDC 参数不得进入日志、URL 分析记录或文档样例凭证。

**现有客户端的额外保护，不代替服务端授权：**

1. 用户明确发起一次写操作后，先重新 `GET /api/session`。
2. 确认 `loggedIn=true`，并将返回的 `issuer + subject` 与该操作开始时的身份比较。
3. 身份不一致时停止，不发送原账号的写操作；一致时仅对这次写入使用新 CSRF。
4. 卸载、退出、换账号、切换真实/示例空间时取消相关请求并拒绝迟到响应。
5. 服务端仍须在每次请求中校验 Cookie、CSRF 和具体资源权限。客户端比较不能消除服务器处理期间的所有并发身份变化。

### 2.3 登录回跳尚待联调

原 Java 的 OIDC 回调固定到 `http://127.0.0.1:8080/login/oauth2/code/keycloak`，成功固定跳到该站点 `/`；失败跳转 `/?authError=1`，Keycloak 不可用跳转 `/?authError=unavailable`。

因此独立前端只设置 API 代理或修改一个 origin，不会自动获得登录后回到 Portal 的能力。后端需要对齐静态资源白名单、SPA 深链接、认证回调及成功/失败落地地址。不要自行构造 OIDC 的 `code/state`。Cookie 域、路径、Secure 与部署的 HTTPS/代理设置也需实机确认。

## 3. 数据类型与语义

所有业务 JSON 成功响应均为 **HTTP 200**，包括创建和删除共享。当前适配器不会把 201/204 当作兼容成功。

```typescript
type Items<T> = { items: T[]; total: number };
type ApiErrorBody = { error: string };

type Session = {
  loggedIn: boolean;
  username: string | null;
  issuer: string | null;
  subject: string | null;
  csrfToken: string;
  csrfHeaderName: string;
};

type Dataset = {
  id: string;
  name: string;
  access: 'owner' | 'shared' | 'public';
  ownerUsername: string;
  instanceCount: number;
  createdAt: string;
};

type User = { subject: string; username: string };
type Instance = { id: string; instanceNumber: string };
type ImportResult = { status: 'Success' | 'AlreadyStored'; id: string };
```

- `total` 是本次 `items.length`，不是分页总量。当前适配器严格校验相等；搜索、排序和分类在本次返回列表内进行。
- `Dataset.id` 是 Java 业务 ID。新建通常为 UUID，公共集也有固定文本 ID，不能统一按 UUID 或 DICOM UID 处理。
- `access=owner` 表示归属关系，不证明“只有我可见”或“没有共享者”；页面可称“我创建的”，不能据此声称所有实例均由本人上传。
- `instanceCount` 是影像集实例数量，不是受试者、样本、序列数量、标注完成量或三维完整性。
- `createdAt` 是创建时间，不是最近修改、最近访问或最近保存。它是可解析的 ISO 8601 时间；页面按本地时区展示。
- `ownerUsername` 是显示值，不是授权依据。身份使用 `issuer + subject`；共享目标传 `User.subject`，不传用户名。
- `Instance.id` 是 Orthanc 实例资源 ID；`instanceNumber` 是字符串，可为空、不可假设连续或唯一，也不是完整空间排序信息。

### 当前权限，不是未来的细权限模型

| access | 交接方声明的当前权限                                                            |
| ------ | ------------------------------------------------------------------------------- |
| public | 所有**登录用户**可访问及执行现有导入、重命名、标注/发布操作，不等于匿名全网可读 |
| owner  | 拥有的私有影像集，可执行全部现有操作                                            |
| shared | 被共享的私有集，可执行全部现有操作，包括继续共享、撤销自己或其他共享成员        |

没有只读/标注者/审核者角色分离。所有者不能被共享接口移除。私有/公共切换、密码共享、邀请链接、删除、移动、分页、收藏、标注进度和训练集导出也不属于当前 API。

## 4. 本前端覆盖的接口

路径变量用 `encodeURIComponent()`，查询参数用 `URLSearchParams`。所有写操作均需要有效会话和动态 CSRF。

| 方法   | 路径                                  | 请求                         | 200 成功响应                          |
| ------ | ------------------------------------- | ---------------------------- | ------------------------------------- |
| GET    | `/api/session`                        | 无；未登录也可调用           | `Session`                             |
| POST   | `/api/logout`                         | 无请求体                     | `{ logoutUrl: string }`               |
| GET    | `/api/datasets`                       | 无查询参数                   | `Items<Dataset>`                      |
| POST   | `/api/datasets`                       | JSON `{ name }`              | `Dataset`                             |
| PATCH  | `/api/datasets/{id}`                  | JSON `{ name }`              | 更新后的 `Dataset`                    |
| GET    | `/api/users?q={query}`                | 去空白后 2～100 字符         | `Items<User>`，最多 20 个启用普通账号 |
| GET    | `/api/datasets/{id}/shares`           | 无                           | `Items<User>`，不含所有者             |
| PUT    | `/api/datasets/{id}/shares`           | JSON `{ subject }`           | `{ success: true }`                   |
| DELETE | `/api/datasets/{id}/shares/{subject}` | 无请求体                     | `{ success: true }`                   |
| POST   | `/api/import`                         | multipart 单文件与 datasetId | `ImportResult`                        |

另有两个 302 浏览器导航入口 `/auth/login`、`/auth/register`，见认证章节。

`GET /api/datasets/{id}/instances` 返回 `Items<Instance>`：旧 `api.ts` 已提供并测试该适配器，但当前首页/面板没有直接调用。OpenAPI 为这个已声明接口保留说明，不能据此宣称 Portal 已实现像素浏览或工作界面加载。

### 4.1 Session

未登录示例的值只表示结构，不是真实凭证：

```json
{
  "loggedIn": false,
  "username": null,
  "issuer": null,
  "subject": null,
  "csrfToken": "EXAMPLE_ONLY_NOT_A_REAL_TOKEN",
  "csrfHeaderName": "X-CSRF-TOKEN"
}
```

未登录仍返回 200，不是 401。登录后返回实际用户名、issuer 和 subject；客户端要求登录状态下 issuer/subject 非空。登录、退出或账号切换后需重新读取 session。

### 4.2 创建与重命名

`Content-Type: application/json`：

```json
{ "name": "演示数据集" }
```

名称去首尾空白后为 1～200 字符。创建返回新的空数据集、`access=owner`、`instanceCount=0`；owner、public、共享规则由服务端决定，不在创建请求中指定。重命名只修改名称；有访问权限的共享成员和公共用户也可重命名，不应将 shared 当只读。

当前没有 `GET /api/datasets/{id}`。详情来自列表项；刷新资源状态时不能调用一个未约定的单项读取接口。

### 4.3 账号搜索与共享

`GET /api/users?q=example` 按用户名模糊搜索，空结果是 `{ "items": [], "total": 0 }`。`total` 只是最多 20 条结果的数量，不是账号库总命中数，没有搜索分页。

共享请求必须来自用户明确选择的搜索结果：

```http
PUT /api/datasets/EXAMPLE_DATASET_ID/shares
Content-Type: application/json
<csrfHeaderName from current session>: <csrfToken from current session>
```

```json
{ "subject": "11111111-1111-4111-8111-111111111111" }
```

示例 UUID 无真实账号含义。服务端要求有效 UUID；目标不存在或停用可返回 404，给所有者共享返回 400。重复添加为幂等更新，但客户端仍不自动重发结果未知的请求。

公共集共享名单与写共享返回 400，因为它已对所有登录用户开放；界面不应提供共享管理。名单只列显式共享者，不列所有者。移除不存在的共享记录也可成功；移除自己后应退出该资源并刷新列表。

**添加共享的 404 不是单一原因。** 它可能表示目标账号已停用，也可能表示集合不存在/失权。当前 Portal 会先核对当前身份并读取该集合共享名单：若仍可读，保留面板并让用户重新搜索；若名单也 404，则清理该资源。所有检查受取消信号和当前会话边界约束，不按中文错误字符串猜根因，不自动重发写入。

### 4.4 单文件 DICOM 导入

每次仅上传一个文件：

```typescript
const form = new FormData();
form.append('file', file);
form.append('datasetId', datasetId);
// Content-Type 由浏览器生成 multipart boundary；另附当前动态 CSRF。
```

服务端也接受 `datasetId` 查询参数；当前客户端只发送 multipart 普通字段，不同时发送两份。跨参数“二者至少提供一个”的约束见 OpenAPI 说明，不能靠两个独立 optional 参数完整表达。

- file 必须非空、有效 DICOM，最大 **67,108,864 字节（64 MiB）**；总 multipart 请求上限为 65 MiB。
- `Success` 表示新存入；`AlreadyStored` 表示已有相同对象且字节核对一致、已关联到该集，**仍是成功**。
- 同 DICOM 标识但内容不同：409，未关联该次对象。无效/空 DICOM 或缺 datasetId：400；过大：413。
- 文件夹由前端展开后串行上传，不提交本地文件夹路径；没有 ZIP、整批原子提交或服务器上传进度查询。
- 当前上传面板先创建数据集，再逐文件导入；底层 `importFile` 适配器也能对已有可访问 ID 导入。
- 普通确定失败与结果未知分开：网络/超时/取消、协议异常及 5xx 会停止队列，不能算作已确认失败或完成；401/403/404/429 等也会阻止后续文件。
- 已完成文件和已创建数据集不会因后续失败或取消自动回滚。不盲目重建数据集或重传全部文件，应先刷新列表核对。
- 15 秒普通请求、90 秒单文件导入是**当前客户端超时策略**，不是服务器 SLA。取消 fetch 不保证服务器处理停止。
- `/api/import` 存入外部 DICOM SEG 不等于登记为共享标注发布版本，本仓库不实现该标注保存链。

### 4.5 退出

`POST /api/logout` 无请求体、带新 CSRF，返回 `{ "logoutUrl": "..." }`。Java 会话可能已经被清除；前端清理本组账号数据，再按可信地址完成 SSO 退出。

`logoutUrl` 只允许 HTTP(S)、无用户名密码、origin 位于部署允许列表；允许列表来自受控配置，不来自查询或浏览器存储。不把完整退出 URL 写日志。地址不可信时不跳转，不能因为不能跳转而继续把已清除的会话显示为登录成功。

## 5. 错误处理

交接方业务错误体为 `{ "error": "中文原因" }`，没有稳定机器 code。代理也可能返回空体、HTML 或其他格式。

**当前适配器按 HTTP 状态显示本地安全文案，不依赖错误体全文，也不把 `{error}` 字符串当稳定判断条件。** 成功 200 必须是符合结构的 JSON；302 业务 API、200 HTML、非法字段或分页 total 不匹配都不是可接受成功。浏览器导航认证是重定向例外。

| 状态                  | 本页面的处理要点                                            |
| --------------------- | ----------------------------------------------------------- |
| 400                   | 参数/名称/公共集共享等不合法，保留可修正内容                |
| 401                   | 停止写入，提示恢复身份；不把其他账号当成原账号              |
| 403                   | 核对会话/CSRF/授权，保留待提交内容，不自动重试写            |
| 404                   | 资源不存在或失权；添加共享还可能是目标账号不存在/停用       |
| 405 / 415             | 方法或请求媒体类型不合约定，不改成假成功                    |
| 409                   | 内容冲突；导入时可能是同 UID 不同字节，不盲目重试           |
| 413                   | 单文件/请求过大，先校验大小再上传                           |
| 500 / 502 / 503 / 504 | 处理失败、影像/账号目录不可用、超时；写结果可能未知，先核对 |
| 客户端 status=0       | 网络、超时、取消、协议/配置问题，不是服务端 HTTP 0          |

429 属于客户端可识别的限流/网关情形，不是原交接承诺的统一业务返回。423 的专门语义属于未纳入本文的 SEG 服务，不把它套到普通写入。

## 6. 对接验收清单

1. 同域代理、静态资源、SPA fallback 和登录回跳由负责人确认；业务 API 失败保留原状态码。
2. 无会话 GET session 返回合法匿名结构；导航登录后重新读取本人身份和 CSRF。
3. 列表、零结果、失败、401、404分别验证，不能把失败伪装成空集合。
4. 创建/重命名返回 200 Dataset；新建集初始只归本人，另一账号不能直接读。
5. 单文件导入、重复导入 AlreadyStored、同 UID 不同内容、超限和部分完成分别验证。
6. A 共享给 B 后验证 B 的真实权限；撤销 B 后实例/共享等读取拒绝；公共集共享管理拒绝。
7. 搜索后目标账号停用的 404 不误报整个集合丢失；账号切换或取消后的迟到检查不应用。
8. 写入前身份改变、CSRF 失效、网络结果未知不盲目重试；退出完成 Java 与 SSO 两侧清理。

以上为待执行的真实联调清单。单测、受控 API 响应和示例空间通过，不能代替后端授权、数据持久化或 SSO 的实机验收。

## 7. OpenAPI 使用与未决项

- `openapi.yaml` 使用 OpenAPI 3.1。Cookie 名已按交接写为 `MEDICAL_DEMO_SESSION`，不虚构 Bearer 认证。
- 动态 CSRF 无法用固定名称的标准 header 参数自动表达，因此写操作以 `x-csrf-required: true` 和说明标记；使用生成客户端/调试器时仍需自行实现 session 后取动态头名的流程。
- `/api/import` 的 datasetId 可来自 multipart 或 query，跨参数“至少一个”以 `x-required-one-of` 说明；当前客户端固定使用 multipart。
- 本文未确定生产域名、Cookie Secure/代理属性、受控测试账号、登录回跳部署、静态资源白名单和后端版本提交号，这些必须由后端负责人补充。
- 13 个 OpenAPI 操作包括 2 个认证导航、10 个当前页面业务操作，以及 1 个适配器保留但页面未直接调用的实例清单。没有加入未来启动、标注、导出、分页或假接口。

## 8. 本文件的校验记录

2026-11-01 使用现有本地依赖完成：`yaml` 唯一键/语法解析、86 个本地 `$ref` 解析、11 条路径/13 个唯一操作与路径参数检查；使用 `ajv/dist/2020` 和 `ajv-formats` 编译 14 个 JSON Schema，验证 3 个响应样例，并确认无稳定身份的登录态、负实例数等反例被拒绝。

这不是专用 OpenAPI 整体 metaschema 验证，也没有访问 Java 服务。动态 CSRF、multipart/query 跨位置约束、`total === items.length` 和实际会话授权仍需运行时实现及联调验收；不能把 YAML 可解析或样例通过当成后端可用。
