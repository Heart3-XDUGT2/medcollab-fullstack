# Portal 落地记录

日期：2026-11-02。状态：本地首版与统一验证已完成，待 root 审查；未提交、推送或部署。

## 共用边界

- 原创品牌资产：`frontends/portal/public/brand/medcollab-mark.svg`。
- `src/ui/Brand.tsx` 默认导出，支持 `compact`、`className`。
- `src/ui/PortalShell.tsx` 默认导出；`activeSection="home" | "teams"`、`username`、`mode="real" | "demo"`、`onLogout`、`busy`、`accountActions`、`homeNavigation` 与 `children`。不依赖 HomePage 内部 state；导航和移动抽屉自管理。
- `src/ui/AuthLayout.tsx` 提供登录构图，沿用同一品牌资产。
- 字体与通用样式由 `main.tsx` 加载；优先复用 `ui` 中的 Button/Input/Dialog/DropdownMenu，保留 Radix 焦点和键盘行为。
- 全局色彩为 `--mc-primary`（湖蓝 #007fa3）、`--mc-primary-hover`、`--mc-primary-pale`、`--mc-ink`、`--mc-muted`、`--mc-ground`、`--mc-surface`、`--mc-border`、`--mc-control`、`--mc-selected`、`--mc-danger`、`--mc-warning`。

## 上传复用

`UploadPanel` 增加可选 `targetDataset?: Dataset`、`destinationLabel?: string`。无目标时保持创建后逐个导入；有目标时展示目标名称，不创建新数据集。`runUpload` 接受同名目标字段并快照；切目标取消旧请求与选择器上下文，晚到响应不更新新目标，未知结果不自动重试。

团队页可传 facade 替换 `createDataset` 为团队创建，其他方法沿用当前适配器；追加已有资料则传 `targetDataset`。这是前端复用，不新增 HTTP 协议。

已执行 `pnpm 12.4.1 install --frozen-lockfile`，锁文件未改。上传队列与组件的聚焦检查：48 项通过（含 5 项已有目标追加 / 隔离测试）。

## 边界

团队是独立团队影像库，不提供个人文件一键全队共享。个人共享不可撤销，保留确认警告，不恢复撤销接口。未启用默认 API、未运行真实 Keycloak/Java/Orthanc、未改 OHIF、IDB、后端或医学引擎。

统一 typecheck、单测、build、E2E 与三尺寸截图的实际结果见下文；受控响应验证不作为真实联调结果。

## 实际落地

- 首页沿用原有会话、取消、generation、身份复核、错误恢复和写结果未知保护；重排为轻导航、名称优先连续列表、来源 / 创建者副行、右对齐实例数 / 日期、可见打开动作。ID 进入详情。
- 连续 / 来源分组与详情展开独立，切换保留搜索和选择；移动端保留 Radix 抽屉焦点、Escape 与返回焦点。
- 登录外观预览与 SSO 入口共用 AuthLayout；真实认证仍按受控配置进行普通浏览器导航，不引入密码 JSON API。
- 个人共享保留不可撤销确认，搜索候选不再重复显示已有共享对象。团队仍使用独立库，不借个人共享接口实现全队共享。
- `main.tsx` 加入二号默认导出的 TeamsPage。网关仅撤下 `/teams` 的旧 Java 页面映射，把 `/teams`、`/teams/` 加入 Portal SPA 回退；旧 Java 源文件未删除。
- 演示资料增至 12 条虚构条目，继续仅在用户主动进入后使用内存；默认真实模式未伪造身份或资料，`public/config.js` 的安全默认值未改。
- `PRODUCT.md`、`DESIGN.md` 与 `.impeccable/design.json` 已反映当前视觉和团队边界；权威 `docs/frontend-handoff/team-library/README.md` 已说明新源码入口、构建与刷新行为。

## 最终验证

下表为二号最后的团队读取失败 / 陈旧状态修复后的全量基线。其后主审要求的导航、字号与焦点定向收尾结果另见下一节；未重新运行全部 51 张图或新增审美扫描。

| 检查 | 结果 |
| --- | --- |
| pnpm 12.4.1 frozen install | 通过；锁文件未改 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 8 文件、157 项通过，含团队最后新增的 5 项状态测试与 4 项按钮类名回归 |
| `pnpm build` | 通过；只构建 Portal 的 `dist` |
| `pnpm test:e2e --reporter=list` | 34 项通过；覆盖原登录、导入、共享、身份切换、未知结果与取消，新增分组 / 详情状态保留 |
| `node --test tests/gateway-routing.test.mjs` | 1 项通过；隔离假上游，`/teams` 与尾斜杠刷新返回 React，API/auth/OHIF/草稿路径不被吞掉 |
| `node tests/ui/portal-ui-check.mjs` | 1440×960、768×960、390×844，51 张确认图；默认 / 演示无 API 请求；受控团队响应、成员页、个人共享与团队追加导入通过 |
| `git diff --check` | 通过；仅提示二号主题生成文件的现有 LF/CRLF 策略 |
| 主题来源校验 | provenance 中 styles.css、ui.css、sign-in.css、品牌 SVG 的四个 SHA-256 均匹配当前源文件 |

浏览器追加验证使用相对真实协议路径的截获响应，确认已有目标不创建第二份数据集，上传带 CSRF 并使用原业务 ID。没有向真实服务提交文件；测试文件只在内存中构造，不是医学影像。

本机视觉检查限定为首轮批量、一批修正与一次确认。集中修正了手机表格继承桌面单元格高度，以及按钮默认尺寸 / 主变体类名冲突。确认图均已查看，未发现页面横向溢出。Impeccable 单次机械检查仅报告 4 项 Inter-family 警告；沿用本地授权工作字体，不为消除提示更换品牌。

团队样式的少量 11px 元信息已由二号在主审指定范围内提升为 12px，未由一号越界修改。独立最终审查由 root 负责，本记录不宣称已获生产视觉验收。

## 最后定向收尾

主审关闭了手机行高问题，最后只处理导航图标、团队元信息字号与移动导航 Escape 焦点：

- Home 和 PortalShell 默认导航共用 `src/ui/navigation.ts` 的四项映射，标签、范围与跳转保持原行为。没有增加页面或重构状态框架。
- 二号将团队 CSS 中 10 处可读 11px 元信息提升至 12px。定向浏览器检查在三个视口、团队列表 / 数据集 / 成员三种状态中，测得元信息最小字号均为 12px。
- 定向检查暴露了移动导航 Escape 未恢复开关焦点的问题；经主审确认后，仅在 PortalShell 添加 opener ref 和关闭焦点恢复。768、390 的 Home / Teams 导航 Escape 焦点断言均通过。
- 最新定向单测：`pnpm exec vitest run src/ui/navigation.test.ts src/features/teams/TeamsPage.test.tsx`，2 文件、13 项通过。未把它与此前全量 157 项累加成新的全量通过声明。
- 最新浏览器脚本：`node tests/ui/navigation-font-check.mjs`，三个视口的 12 组跨页图标匹配、9 组字号状态、筛选跳转及移动 Escape 焦点通过，错误数组为空，无横向溢出。仅保存 12 张受影响截图。
- 最终 `pnpm build` 通过，包含 `tsc --noEmit`。未改医学引擎或业务协议。
- 已执行 `node gateway/prepare-theme.mjs` 刷新主题静态副本；`node --test gateway/theme/contract.test.mjs` 6 项通过。四项 provenance 的源文件及主题副本 SHA-256 均与记录匹配；没有部署主题或启动 Keycloak。

最新证据目录为 `frontends/portal/.runtime/ui-screens/navigation-font-final/`，包含三个 `*-contact.jpg`、12 张 PNG 和 `verification.json`。这些只替代旧确认图中导航图标与团队文字尺寸的证据，其余布局仍使用前一批确认图。

## 预览与证据

- 首页：[http://127.0.0.1:60827/home](http://127.0.0.1:60827/home)，默认 API 关闭，可主动进入示例。
- 团队：[http://127.0.0.1:60827/teams](http://127.0.0.1:60827/teams)，默认如实显示未配置；完整布局与流程见受控响应截图。
- 登录入口：[http://127.0.0.1:60827/account/sign-in](http://127.0.0.1:60827/account/sign-in)。
- 密码外观：[http://127.0.0.1:60827/sign-in](http://127.0.0.1:60827/sign-in)。
- 当前仅运行本地 Vite，PID 13232；未占旧 5173 或原型 60727。
- 全量确认基线：`frontends/portal/.runtime/ui-screens/confirmation/`；最新导航 / 字号 / 焦点证据：`frontends/portal/.runtime/ui-screens/navigation-font-final/`。均含三种宽度总览和 `verification.json`，目录被忽略，不作为产品素材提交。
- `*-fixture.png` 为截获的虚构业务响应；无 fixture 后缀的演示 / 未配置图也不是真实账号数据。Keycloak 主题的静态 fixture 与记录由二号维护。

在 `frontends/portal` 启动：

```powershell
pnpm dev --host 127.0.0.1 --port 60827 --strictPort
```

浏览器复验：

```powershell
$env:PORTAL_E2E_BASE_URL = 'http://127.0.0.1:60827'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
pnpm test:e2e --reporter=list
node --test tests/gateway-routing.test.mjs
$env:QA_ROUND = 'confirmation'
node tests/ui/portal-ui-check.mjs
```

只重验最后指定范围时使用 `node tests/ui/navigation-font-check.mjs`，不重新打开全量视觉流程。

没有真实 Keycloak 登录、多账号授权、DICOM 导入、影像打开或数据库持久化联调结论。未启动真实服务、未部署、未触碰公共医学资料；保留当前共享分支供 root 审查和统一决定提交。

## 发布准备检查

日期：2026-11-02。本节为只读源码 / Git 审计及主任务复验记录，不是推送或部署授权的执行记录。

### 新基线与复验

- 主任务已保留完整 stash 备份，快进到 `7a1d736ba291f0d035edb3146e4b6a1e0a0a628d` 后恢复本次改动；本审读取时 HEAD 与 `origin/main` 均为该提交。
- 相对旧基线 `1ced5eda48350bd7db1f823a6122f573b6327262`，远端新增 5 个 OHIF / 实时协议文件，与本次 Portal、主题、网关页面映射及 UI 文档没有路径重叠。
- 主任务在新基线上实际重跑：全量 158 项单测、生产 build、34 项 E2E 及隔离网关路由检查通过。本节未再次执行构建、测试或真实服务。
- 主任务报告主题严格哈希测试在 CRLF 恢复后失败，已由二号负责固定 LF 并重生成；提交完整主题前应以该修复后的严格校验为准，不能沿用前一节的旧哈希通过记录。

### 可提交范围与排除项

本次候选改动属于以下范围：Portal 应用 / 共用 UI / 原创品牌与对应测试，Portal 产品与设计记录，Keycloak 主题源码、可重生成的共享样式与许可证、受控静态测试 fixture，`gateway/prepare-theme.mjs`、`gateway/unified-server.mjs` 的团队页面路由，以及团队交接和 UI 实施文档。`.impeccable/design.json` 只含设计记录与组件片段，不进入业务状态。

只读检查未见本次修改 backend、OHIF、deploy 或构建脚本；依赖清单、锁文件和默认 `public/config.js` 也未改。最新 OHIF 文件属于已整合的远端提交，不应再次混入 UI 工作区变更。

候选文件未出现构建包、缓存、截图、数据库或医学文件；高置信度私钥 / access-token 模式扫描未命中。`dist`、`node_modules`、`.runtime`、`test-results`、`deploy/.env` 均被忽略。主题 HTML fixture 是只读合成账号字段与本地静态资源，不是真实账号、医学资料或浏览器缓存，可作为测试资料保留。

审计发现 `frontends/portal/src/features/teams/browser-check.mjs` 的默认输出与浏览器路径写死为开发者环境。所属执行官已将默认输出改为被忽略的 `.runtime/ui-screens/teams-auth`，保留 `TEAM_SCREENSHOTS` 覆盖；浏览器优先读取 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`，否则使用 Playwright 默认浏览器。语法检查通过，可纳入本次提交；未因此新增视觉检查轮次。

### 真实接口核对与未完成项

登录使用受控 `/auth/login`、`/auth/register` 浏览器导航；Java AuthenticationController 与 SecurityConfiguration 提供 OIDC 回调与 `/api/logout` JSON 退出响应。Portal 不新增密码 JSON 登录 API。

个人首页实际接线包括 GET `/api/session`、GET/POST `/api/datasets`、PATCH `/api/datasets/{id}`、GET `/api/users`、GET/PUT 个人共享及 multipart POST `/api/import`；路径、字段及 200 JSON 形式与当前 Java Controller 相符。写入保留新 session、issuer + subject 复核及动态 CSRF。UI 没有个人撤销入口；遗留弃用 adapter 并不构成可用的撤销功能。

独立 Vite 预览的默认 API 关闭是安全配置，不代表没有真实适配器；正式统一网关动态开启同源 API 并提供可信认证与工作台路径。README 的 Node 24 / 各前端精确 pnpm 版本和 `node scripts/build.mjs portal` 构建方式仍与脚本一致。

上述为代码接线核对，不是新版本的真实 SSO、多账号授权、持久化或 DICOM 导入验收。主任务报告本机 JDK 25 不可用，Java 构建 / 测试未在本轮完成；真实后端与 Keycloak 未联调。如发布门槛要求真实联调，必须另行完成后才能宣称满足。

### 推送阻塞

主任务的权限预检报告：当前 GitHub 账号 `Yotaoer` 对仓库 `permissions.push=false`；`git push --dry-run origin HEAD:main` 返回 **403 Write access not granted**。这是当前明确的远端写入阻塞，不能通过再次重试、换推送目标或提交本地代码绕过。需仓库管理员授予正确账号写权限，或由有权限的维护者执行推送。

本审计只补记本节；未改应用代码、未 commit、未 push、未构建 dist、未启动真实服务。

### 主审收尾

- 最新基线的源码核对确认：15 个团队端点及复用的导入、重命名、工作台入口均有真实适配；未发现阻塞型契约不匹配。不代表真实服务联调通过。
- 主题换行符阻塞已修复：9 个精确路径固定 LF，来源与副本严格字节 / 哈希校验保留；新增 Git `core.autocrlf=true/false` 清理与检出回归，主题 8 项检查通过。
- 本次发布只准备本地 `feat/portal-team-ui` 提交；完整的提交前 stash 快照仍保留。未覆盖或重写远端历史，未部署，未修改真实数据或凭据。
- 当前远端写入仍以仓库授权为前提，不能把本地提交写成已推送。取得 Write 权限后须重新 fetch 并核对远端变化，再推送开发分支供合并。
