# 团队页与账号主题交接

日期：2026-11-02。实施目录：`medcollab-fullstack`。范围仅为分配的团队页面、共用 API 的团队扩展、Keycloak 主题与本记录；未修改 Java、旧仓库、realm/client、部署或凭据，未提交、未推送。

## 视觉与实现边界

模式为 Operate，延续 `portal-team-sketch-2026-11-01` 的冷白、近黑、湖蓝 `#007fa3` 与零字距。名称优先，身份和稳定 ID 次级；手机长名称自然换行。使用原执行官维护的 `PortalShell`、Brand、Button/Input、Radix 弹层与 Lucide，不复制个人首页状态，也不维护第二套品牌资产。

本页按真实团队库落地，而非照搬草图模型：身份是当前组长 / 成员，不称当前组长为原创建者；没有简介字段、解散按钮、团队外共享或将个人文件一键共享给团队。上传者只表示数据集创建账号；删除按钮同时检查 `canDelete` 与本账号 subject，最终仍以服务器授权为准。

## 接入入口

- `frontends/portal/src/features/teams/TeamsPage.tsx` 默认导出 `TeamsPage`。默认从部署配置创建适配器，自行读取真实 session；可注入 `config` / `api` 供隔离测试。原执行官已在 `/teams` 路由接入。
- 页面使用 `PortalShell activeSection="teams"`，提供当前 username、退出流程、busy。账号退出仍走动态 CSRF 与可信 SSO URL，不只是隐藏头像。
- 团队页包含我的团队、本地筛选、全局搜索加入、创建、邀请码展示 / 复制 / 轮换、改名、成员搜索添加 / 移除、移交、离队，以及团队资料列表、新建、追加 / 新建上传、重命名、打开与上传者删除。
- `UploadPanel` / `runUpload` 由原执行官维护。本页只使用 `targetDataset` / `destinationLabel`；新建上传的 facade 只将 `createDataset` 代理到固定团队的 `createTeamDataset`，导入复用原协议。身份、团队或目标变化会卸载面板并取消旧 scope。

## API 扩展

`home/api.ts` 新增 `Team`、`TeamMember`、`TeamDataset`、`TeamInvite`，以及：

`listTeams`、`searchTeams`、`getTeam`、`createTeam`、`joinTeam`、`renameTeam`、`listTeamMembers`、`addTeamMember`、`removeTeamMember`、`leaveTeam`、`transferTeam`、`rotateTeamInvite`、`listTeamDatasets`、`createTeamDataset`、`deleteTeamDataset`。

沿用原 Cookie、no-store、redirect:error、超时、结构验证和 write 前 fresh session / 动态 CSRF。校验列表总数、团队身份枚举、所属 teamId 和日期 / 数量；路径编码，邀请码只在请求体中使用。未改个人共享策略，未恢复撤销能力。

## 上下文安全

- 页面和选中团队各有取消边界与响应序号；换团队、换账号、离队、卸载后拒绝迟到响应，清除当前资源与邀请码。
- 列表、团队资料以及目录搜索在应用响应前复核 issuer + subject。浏览器恢复前台与周期性只读检查核对身份和成员资格；新账号响应不会回填旧账号页面。
- 团队索引区分未读、成功、首次失败和陈旧结果。只有成功的空响应才显示“还没有加入团队”；首次 503 / 非法 JSON 显示读取失败、重试与未知数量。已有列表刷新失败保留上次结果并明确标记陈旧，旧空结果也不冒称当前没有团队。
- 成员 / 目标账号错误的 404 先重新读取团队，不一律误报整队删除；团队本身 404 清除资料与操作并停止上传。删除后旧条目不可直接打开；打开前重读团队数据集列表。
- 写入发送期间禁止取消、X、Escape 和外点关闭。网络、超时、5xx 或协议异常使结果未知时冻结重复提交，允许关闭并重新读取核对，不自动重放。取消 fetch 不声称撤回服务器操作。
- 邀请码只在创建 / 轮换的当前结果弹窗展示；关闭、换队、换账号、卸载即清除。不进入 URL、日志、浏览器存储。

## Keycloak 主题

保留真实模板的服务端 action、字段名、credentialId、profile attributes、服务端字段 / 全局错误、注册 / 找回链接。新增同风格 `login-reset-password.ftl`；未将 React 密码演示当作认证流程。

`gateway/prepare-theme.mjs` 复制共用 CSS、品牌、字体、图标与许可；主题专属 `auth.css` 使用 `mc-kc` 命名空间，避免与 Portal 账号入口的 `mc-auth` 冲突。生成清单位于 `gateway/theme/medcollab-portal/style-provenance.json`。旧 `gateway/theme-style-provenance.json` 未覆盖，新的清单与全部主题输出都留在本次允许的主题目录内。

```powershell
node gateway/prepare-theme.mjs --fixture
node --test gateway/theme/contract.test.mjs
```

`--fixture` 额外生成 `gateway/theme/fixtures/{login,register,reset}.html`。它们是明确标注、密码只读且不能提交的静态样式投影，不是 FreeMarker 引擎或真实 Keycloak 登录验收。真实 Keycloak 未启动、未登录、未安装主题。

## 实际验证

- 当前 `tsc --noEmit` 通过。
- 适配器与团队页聚焦测试：77 项通过（65 API + 12 页面状态 / 生命周期）。覆盖结构反例、fresh CSRF、身份改变、取消与晚到、搜索返回后换账号、成员失权、提交中取消 / Escape、未知结果冻结且不重复发送，以及首次列表失败与成功空态 / 陈旧结果的分离。
- 主题静态契约检查：6 项通过，验证模板关键表单属性 / 错误钩子、独立命名空间、品牌 / CSS 来源哈希、许可、fixture 不提交、脚本不读取存储或记录密码。不是 FreeMarker 编译测试。
- 真实 Chrome 1440×960、768×960、390×844：首轮批量检查、一批修正、一次确认。最终 33 张截图包含团队列表 / 长名 / 成员 / 数据集、搜索、上传面板组合、空态、服务错误、成员资格撤销，以及登录 / 注册 / 找回主题外观。未发现横向溢出、页面运行错误或浏览器持久化数据。
- TeamsPage 浏览器请求全部由 Playwright 拦截，主题 fixture 不发送写请求。验证不涉及真实数据、账号、上传、Java、Orthanc 或 Keycloak。
- Impeccable 单次检测针对团队页、团队 CSS 和主题专属 CSS，结果为空；没有重新开启视觉迭代。
- 主审补充的首次列表读取失败语义已修复并加测；随后重跑 77 项聚焦测试与 `tsc --noEmit` 均通过。本次没有新增截图轮，原 33 张截图不冒充新增失败分支的视觉验收。
- 主审字号收尾：仅将团队 CSS 中 10 处可读文字的 11px 声明提升至 12px，包括列表 ID、角色标签、人数单位、搜索结果副行、手机团队 ID / 日期 / 成员副行，以及平板行操作文字。未全局替换 11px 间距，也未修改共享样式或主题。真实 Chrome 的 1440 / 768 / 390 三视口共 12 个无截图尺寸检查通过：长团队 / 数据集标题、长成员名、列表与搜索副行均未发现页面横向溢出、文字容器裁切或本批目标文字低于 12px。检查使用拦截协议响应，不连接真实服务；未生成新截图或构建 `dist`，最终构建与受影响截图由原执行官统一完成。
- 完整 Portal build 与全量 E2E 统一由原执行官执行，本线程未并行写 `dist`，不在此声称其结果。

## 运行与证据

- 共享 Portal：[http://127.0.0.1:60827/teams](http://127.0.0.1:60827/teams)。没有真实服务时呈现真实不可用状态，不回退虚构资料。
- 隔离主题：[http://127.0.0.1:5188/fixtures/login.html](http://127.0.0.1:5188/fixtures/login.html)，另有 `register.html`、`reset.html`。仅本机静态服务器，未安装主题。
- 浏览器复验：从 `frontends/portal` 执行 `node src/features/teams/browser-check.mjs`；默认写入 Portal 内被 Git 忽略的 `.runtime/ui-screens/teams-auth`，`TEAM_SCREENSHOTS` 可覆盖。浏览器优先使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，未配置时使用 Playwright 默认浏览器，不再要求固定开发者 Chrome 路径。所有业务响应仍被拦截。本次便携性修改只做 `node --check`，通过；确认默认目录命中根 `.gitignore` 的 `.runtime/`，未重跑视觉轮。
- 最终截图与 `verification.json`：`<local-verification-artifact>\2026\11\02\01a19b5e-a40b-73e3-9a47-092e8fd00b74\teams-auth-confirm`。

当前源码稳定，等待主任务审查与原执行官统一构建。真实权限、邀请码加入 / 轮换、DICOM 导入、工作台访问拒绝和 SSO 的端到端联调仍须在受控服务环境另验。

## 最新远端接口只读复核

主任务 fetch 完成后，以 `origin/main` 的 `7a1d736ba291f0d035edb3146e4b6a1e0a0a628d` 复核。相对原基线 `1ced5eda48350bd7db1f823a6122f573b6327262`，新增提交仅涉及 4 个 OHIF 文件和实时协作文档，没有 Java、团队 DTO 或登录 / 首页接口增量。

- `TeamController.java:18` 起的 15 个团队方法均在当前 `home/api.ts:361` 起有适配器，且在 `TeamsPage` 中实际使用：列表 / 搜索 / 创建 / 凭码加入 / 单队读取 / 改名 / 成员读取与增删 / 离队 / 移交 / 轮换码 / 团队数据集读取、创建和删除。
- `TeamService.java:22` 的 DTO 与前端类型一致，role 为当前 `leader/member/none`；邀请码为 16 随机字节的无填充 Base64URL，匹配前端验证。队名、搜索与码的长度限制、加入时 ID 大写归一化、组长退出冲突语义均对齐。
- `DatasetService.java:28` 的 TeamDataset 与前端结构校验相符。团队库独立查询；通用 PATCH 重命名返回 Dataset，追加 / 新建上传复用 multipart `datasetId/file`，删除依赖当前成员及数据集创建账号。UI 未增加服务器不提供的团队外共享或解散。
- `SessionController`、`AuthenticationController`、`SecurityConfiguration` 与 `DemoSession` 的 session、浏览器登录 / 注册、动态 CSRF、Cookie、issuer+subject 及退出行为未变；适配器与网关入口保持匹配。个人共享不可撤销规则未恢复旧行为。

本轮未发现已展示团队操作缺少真实端点、参数 / DTO 错配或认证入口变化等发布阻塞。结论来自源码静态审计，不是启动服务器后的真实联调验收。

## Windows 来源哈希发布修复

主任务在 Windows checkout 后复现了 Portal 源 CSS 为 LF、主题副本被检出为 CRLF，导致严格字节 / SHA-256 检查失败。本批未放宽测试，而是：

- 根 `.gitattributes` 仅为参与来源哈希的 Portal 3 份 CSS、品牌 SVG、对应 4 份主题副本及新 provenance 清单增加 9 条精确 `text eol=lf` 规则，未全仓格式化。Portal 已有子级 `* text=auto eol=lf` 保持不变。
- 机械统一这 9 份文本为无 BOM 的 UTF-8 / LF，重新运行 `prepare-theme.mjs --fixture`；不改变 CSS / SVG 语义、接口或页面逻辑。
- 保留原严格源哈希与字节相等断言，新增有效 LF 属性 / 无 CR 字节检查，以及临时 Git 库的 clean / checkout 过滤器检查。后者复制真实根及 Portal 子级属性，在 `core.autocrlf=true` 和 `false` 下分别验证 CRLF 输入清理后检出字节仍与 LF 源完全相同；不创建提交，不修改实际仓库索引或持久 Git 配置。
- 当前主题测试共 **8 项通过**（原 6 项静态契约 + 2 项换行 / 跨平台检查）。源未变时再次运行 prepare-theme，provenance 字节完全一致。

本批未构建 `dist`、未启动真实服务、未合并 / 提交 / 推送。完整构建、联调与远端发布决定仍由主任务统一处理。
