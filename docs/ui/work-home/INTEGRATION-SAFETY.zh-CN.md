# 统计真实联调安全方案

日期：2026-11-04。状态：只读调查与执行方案，尚未启动或验收隔离服务。root 负责环境操作、集成与发布；本记录不授权部署，也不替代备份。

后续决定：root 已选择完整隔离拓扑（网关18080 / Java18082 / Keycloak18081 / Orthanc18042），源码归档在 `.runtime/integration/work-home-live/source`。下文直接 Java 登录是可选诊断阶段，不是当前默认回调；当前工具/realm 的回调统一到18080。二号获准新增 `tests/integration/stack.mjs`、合成CT生成器与说明；一号独占真实 Portal spec 和网关退出允许列表配置。准备/启动命令及公共 manifest、私密 credentials 的最终约定见 `tests/integration/README.md`。未自行执行准备、启动或构建。

## 结论

可用生产 Java 的正常安全链路完成真实 HTTP/OIDC 联调，但必须使用**全新 Keycloak、Orthanc、H2 与合成 CT**。不能把“请求只有 GET”理解成新版 Java 启动没有写入：启动包含建表/迁移、历史操作补算和后台归档/物理 SEG 清理。

最小第一阶段不需要网关或 Portal 构建：独立 Java 绑定 `18082`，正常 `/auth/login` 经独立 Keycloak `18081` 回调到 `18082`；浏览器在该 Java 同源读取统计、提交带动态 CSRF 的合成测试操作。使用生产 Controller/Service/安全过滤链、真实 Cookie、真实 Keycloak 签名与真实 Orthanc/Python 编解码，不注入测试身份或 mock。

该阶段通过后，再做 Portal 同源代理的真实集成；不能用第一阶段替代前端实际接线验收。

## 只读现场结果

- Docker CLI/daemon 可用。原容器 `medcollab-local-keycloak-1`、`medcollab-local-orthanc-1` 正在运行，未配置 Docker Healthcheck，`running` 不等于健康。
- 原 Orthanc `http://127.0.0.1:8042/system`：HTTP 200，仅记录状态与媒体类型，未输出正文。
- 原 Keycloak discovery 首次 4 秒超时；第二次 15 秒上限探测返回 HTTP 200，公开 issuer 为 `http://127.0.0.1:8081/realms/medical-demo`。尚未验证 token/JWK/目录权限/浏览器登录。
- 原 `8080/api/health` 与 `8082/api/health` 均不可达；本次没有启动它们。
- 原持久卷为 `medcollab-local_keycloak-data`、`medcollab-local_orthanc-data`。原 H2 `.runtime/access-control.mv.db` 存在，禁止挂到测试 Java。
- `deploy/.env`、配套生成 realm、原 JAR、Python venv 均存在；只检查存在性，未读取或输出凭证内容。
- 本机 Java 25.0.5；现有 venv 中 pydicom 3.0.2、numpy 2.5.4、highdicom 0.27.0 可导入版本元数据。未执行编解码或构建。
- 本机已缓存 Keycloak 26.8.1 与 Orthanc 镜像；Orthanc 是移动的 `latest` 标签，实际执行前应记录并固定现有镜像 ID/digest，不能无声拉取不同版本。

## 不能直接复用的入口

| 入口 | 源码事实与风险 |
| --- | --- |
| `scripts/start-backend.mjs` | 读取原 `deploy/.env`，并强制覆盖 Java 8082、base URL 8080、原 Keycloak/Orthanc 地址及原 `.runtime/access-control` 文件数据库；不适合隔离联调 |
| `scripts/start-gateway.mjs` | 固定传入 8080/8082；不要用它启动隔离实例 |
| `scripts/build.mjs backend` | 在原 backend 下执行 Maven package，默认覆盖原 target/JAR；不能直接运行 |
| `deploy/compose.yaml` | 固定项目名、原端口和原持久卷，还绑定原生成 realm 与实际主题；仅换 `-p` 不能解决端口/挂载/配置共享 |
| `scripts/setup.mjs` | 生成位置和 OIDC 回调固定为原 deploy/8080；不能在原目录用它制造隔离配置 |
| `gateway/unified-server.mjs` | 可设置 Portal/Java 端口，但静态资源根目录固定到原 dist；`/config.js` 的 `logoutOrigins` 固定为 `http://127.0.0.1:8081`。隔离 Keycloak 18081 的退出会被前端允许列表拒绝，不能仅换端口就宣称完整联调通过 |

上表描述调查时基线。一号随后新增受校验的 `PORTAL_LOGOUT_ORIGINS` JSON 数组运行配置，独立源码归档必须包含该改动及 `gateway/runtime-config.mjs`，启动时传入 `["http://127.0.0.1:18081"]`；二号工具不做网关源码替换。

构建由 root 在**包含已审阅修改的独立源码快照/工作树**里完成，不能只 archive 旧 HEAD 而漏掉本地成果，也不能默认复制原 `.runtime`、`.env`、患者数据或依赖缓存。本 POM 没有自定义输出目录属性；不要假设 `-Dproject.build.directory=...` 就一定重定向 Maven 输出。独立源码目录自己的 target 是最清楚的边界。

## 最小隔离拓扑

下列端口是建议值，root 启动前需确认未占用，不停止占用它们的其他进程。

| 对象 | 建议隔离值 |
| --- | --- |
| Docker project | `medcollab-stats-check-20261104`，独立 compose 文件，不 extends 原服务 |
| Keycloak | `127.0.0.1:18081`，新空卷，独立 realm `medcollab-stats-check`，默认 Keycloak 登录主题 |
| Orthanc | `127.0.0.1:18042`，新空卷/独立配置，禁止挂原 Orthanc 卷、存储目录或 DICOM 资料 |
| Java | Windows 宿主进程，`127.0.0.1:18082`，独立构建得到的 JAR |
| H2 | `jdbc:h2:mem:stats_live_20261104;DB_CLOSE_DELAY=-1`，仅本次 JVM，禁止使用原文件 URL |
| 工作目录 | root 新建并核验的 `.runtime/statistics-live-check/` 子目录，独立 codec 临时目录与 Java tmp |
| 浏览器 | 新建临时 context，无原浏览器 profile、Cookie、localStorage、IndexedDB 或持久 storageState |

独立 Keycloak realm 需正常配置 confidential web client（Authorization Code、PKCE S256、禁用 direct grants），回调仅允许 `http://127.0.0.1:18082/login/oauth2/code/keycloak`、退出回跳到同一 Java origin。另配只读目录 client/service account 及 `view-users`、`query-users`，参照 setup 的结构而非复制原带凭证 realm。只创建两个独立合成人类账号 A/B，使用新随机密码/secret；秘密仅留本地受控配置或进程环境，不进入命令行、日志、测试报告、截图或 Git。

Cookie 按域/路径而不是端口隔离。即使端口不同，也不能复用原浏览器上下文；独立 realm 名同时避免与原 Keycloak realm 路径混淆。

### 清理与启动参数

`SegmentationRetentionService.cleanupSuperseded()` 的 fixed delay **和 initial delay** 都来自 `app.segmentation.cleanup-ms`，默认均 5000ms。它会发现旧记录并调用 Orthanc DELETE，随后改 DB 水位/裁剪旧归档 plan；不需要用户再次发布。

当前源码没有受支持的 cleanup enabled 开关。不要尝试把 fixedDelay 填 `-`、`0`，也不要声称 `spring.task.scheduling.enabled=false` 能禁掉显式 `@EnableScheduling` 与自建 scheduler。

推荐本次进程设置 `SEGMENTATION_CLEANUP_MS=604800000`（7 天），并由 root 的启动编排严格将整个隔离 Java 存活时间限制在 1 小时内，结束时停止**该次记录的 PID**。这是有边界的“延后首次执行”，不是永久禁用；不得长期遗留运行。生产源码没有其他调用该方法的入口，本方案不直接调用 retention 服务。若要求无限期保证不执行清理，需要队友另行提供可审查的启动开关，不能在本任务悄悄修改后端。

可由 root 在隔离子进程环境设置以下非敏感值；不使用原 start-backend 脚本：

```text
SERVER_PORT=18082
APP_BASE_URL=http://127.0.0.1:18082
KEYCLOAK_ISSUER_URI=http://127.0.0.1:18081/realms/medcollab-stats-check
KEYCLOAK_CLIENT_ID=<隔离 web client ID>
KEYCLOAK_DIRECTORY_CLIENT_ID=<隔离 directory client ID>
APP_DATABASE_URL=jdbc:h2:mem:stats_live_20261104;DB_CLOSE_DELAY=-1
APP_DATASETS_SEED_ENABLED=false
SEGMENTATION_CLEANUP_MS=604800000
SEGMENTATION_PYTHON=<现有 venv Python 的绝对路径>
SEGMENTATION_CODEC_SCRIPT=<独立源码中的 seg_codec.py 绝对路径>
SEGMENTATION_WORK_DIR=<新建隔离 codec 目录绝对路径>
```

client secret 由 root 单独安全注入，不写入此参数清单。启动命令为 `java -Djava.io.tmpdir=<隔离 tmp> -jar <独立构建 JAR>`，必要时显式传 `--app.collaboration.scan-ms=604800000`：archive scanner 没有 initialDelay，启动时可能立即扫描一次，但新空 H2 无待归档内容，随后间隔 7 天。这样可在首次写入后先观察 pending 状态，再通过正常 HTTP `/collaboration/archive` 显式请求归档；该 API 不调用 retention 清理。后台服务配置仅对该隔离进程生效，不能改原 application.properties 或 `.env`。

## 真实 HTTP/OIDC 验收顺序

1. 在启动前记录原 JAR SHA-256、原容器/持久卷身份及隔离路径清单。核对新 Java 的 H2 URL、Orthanc URL、issuer、清理初始延迟均为上述隔离值，敏感值不出日志。任何一项指向原数据库/Orthanc 就停止。
2. 正常启动独立 Keycloak/Orthanc 后，只读确认 discovery issuer/端点、JWK 可读、Orthanc 可达；然后启动独立生产 JAR。`GET /api/health` 必须实际返回 `annotationStatsApi: "v1"`，不能拿源码或前端 mock 代替。
3. 新浏览器 context 匿名 `GET /api/session`：200、loggedIn=false、有动态 CSRF；三条统计 GET 应为 JSON 401，不是登录 HTML。`/__test/login` 不应创建会话；不能把测试过滤器放入产品进程。
4. 浏览器打开真实 `/auth/login`，在隔离 Keycloak 输入隔离账号 A，经真实 state/nonce/PKCE、token exchange、JWK 签名与 userinfo 返回 Java。随后同源 `/api/session` 确认 loggedIn=true、issuer 精确匹配隔离 realm，subject 是实际签发值。不要使用 password grant、伪造 Cookie、`oidcLogin()` 或往 session 注入属性。
5. 用正常 `POST /api/datasets` 创建新空集，每次写前重新 session 并核验原 issuer+subject，使用本次返回的 csrfHeaderName/csrfToken。空集统计应 total=0、series=[]、0% 而非100；本人历史应0。另测缺 CSRF 写入403。
6. 本地新生成3张小尺寸 classic single-frame CT，仅写 `SYNTHETIC` 标识、新 UID/统一 Study/Series/FrameOfReference、合法方向/位置/间距与像素属性。通过正常 `/api/import` 串行导入到新集，不复制任何患者 DICOM。真实 Orthanc 返回源实例/序列 ID，seriesId 不是 DICOM UID。上传后应 total=3、annotated=0。
7. 使用实际协作 state/lease/ops/batch API（正常 Cookie、动态 CSRF、该客户端的 lease、当前 seq）提交一个非零掩码修改。读取本人/数据集/序列三条真实统计：本人有效操作+1、共享画布1/3、归档0/3、pending=true。从正常 `/segmentation/sources` 等现有接口获取资源 ID，不通过直接改 H2 伪造记录。
8. 调正常 `POST .../collaboration/archive`，等待后台处理完成，再读统计：共享/归档均1/3，pending=false、publishedVersion>0。必须通过真实 Python codec 和隔离 Orthanc 形成 SEG，不能 mock encode/readback。随后提交擦空操作，先确认共享0/3、归档仍1/3、本人历史+1，再归档确认0/3且版本仍>0。旧 SEG 不应被本次进程清理。
9. 独立 context 正常登录 B：B 的本人统计不受 A 影响，B 读 A 私有集/序列应404；匿名仍401。需要测试共享时再用隔离目录 client 的真实查询和正常共享 API，不改用户权限表。换号、退出、迟到统计不能在 Portal 中复现旧身份计数。
10. 用 session 的动态 CSRF 正常退出 Java，再访问返回的真实 Keycloak end-session 地址完成 SSO 退出，确认后续匿名。收集只包含状态/统计计数/合成资源标记的报告，不保存 Cookie、CSRF、授权 code/state、token、登录密码或完整敏感网络 trace。
11. 在1小时期限内停止隔离 Java，关闭测试浏览器。复核原 JAR 未被替换、原卷未被挂到新容器；不自动执行 `docker compose down -v` 或递归删除。新隔离测试数据由 root 按已核验的项目身份决定保留，不能清理原项目。

直接 Java 阶段通过后，Portal 阶段必须使用 root 独立同源代理/测试配置，正确转发 `/api`、`/auth`、`/oauth2`、`/login/oauth2`，将 base URL、Keycloak 回调、配置中的 authOrigin/logoutOrigins 全部对齐同一隔离 origin。不要为省事把浏览器 API 导向原8080或把新 issuer 的退出列入原部署配置。真实 Portal 页面需不拦截这几条 API，观察 Network 和服务端响应，验证实际 v1能力、共享/归档、401/404及换号清旧值；已有 mock E2E 继续保留，但不能据此宣称真实接线通过。

## 现有测试的真实边界

- `AuthenticationSecurityTests`：MockMvc `oidcLogin()` 注入 principal，测试动态 CSRF、匿名/已登录、拒绝伪造旧 session 属性等；不是 Keycloak 网络认证。
- `CollaborationTests.statisticsHttpUsesSessionNoStoreAndCurrentDatasetPermissions()`：MockMvc + 合法测试 issuer/subject 检查三条统计 HTTP、no-store、401/404及本人范围；Orthanc/codec/目录为 Mockito，不能当真实影像或登录联调。
- `CollaborationTransportTests`：RANDOM_PORT 的真 HTTP/WebSocket 与真 HttpSession，但 `@TestConfiguration` 的 `/__test/login` 过滤器构造 `OidcIdToken`/`DefaultOidcUser` 并写 Spring Security context；影像/目录仍 mock。它不是合法生产登录方式，不能移植到产品源码或打包到生产 JAR。
- `KeycloakAuthorizationRequestResolverTests`：覆盖 state/nonce/PKCE 参数构造，不执行授权服务器回调、验签或 code exchange。
- `SegmentationRetentionTests`：测试主动调用 cleanup，Orthanc DELETE 是 mock；不代表原 Orthanc 可安全升级。不要把这些测试接到真实 Orthanc 或原数据库。

## 当前真实缺口与放行条件

尚未运行新版生产 Java、未完成真实浏览器 OIDC/token/JWK/目录访问、未用真实 Orthanc/codec生成并回读合成 SEG、未在真实权限条件下验证统计、未做 Portal 无拦截同源接线/完整退出。这些是本轮隔离方案拟补的缺口，而不是已经通过的结果。

最小方案不自然产生稳定的423竞争窗口、旧 SEG 无计数缓存的首次补算或旧库迁移；未执行时必须单独列为未验证，不能用普通200或协议mock代替。若后续要覆盖旧库迁移，须另外授权、离线一致备份/恢复演练并审查清理策略；本方案禁止以原数据库或原 Orthanc 作为测试夹具。

发布前 root 还需保护队友 main 新增 OHIF 进度展示，与实际 Java/网关/OHIF 版本配套核对。上传代码与生产部署是不同动作；通过隔离测试不授权替换原运行产物、升级原数据库或启用历史 SEG 物理清理。

## 工具交付与阶段性反馈

已新增 `tests/integration/stack.mjs`（prepare/up/down/run-java/run-gateway）、`generate_ct.py`、`stack.test.mjs` 与独立 README。离线7项工具测试通过；Python生成器经AST语法检查，该检查不生成文件、不启动服务。实际DICOM夹具由主控执行prepare时生成，仅位于忽略的runtime中。

root 回报已成功prepare/up，隔离Orthanc18042 ready，Keycloak等待realm discovery；同时在隔离source完成111项后端测试和package、Portal离线依赖与构建。这些是主控的阶段性结果，不等于OIDC登录或真实Portal业务已经验收。二号没有执行prepare/up、服务启动或构建。生成配置形状已按主控要求冻结，不覆盖现有秘密文件；一号继续完成无API拦截的真实业务测试，root继续记录实际端点/登录/统计结果。

### Keycloak 导入文件名与历史空占位恢复

首次启动时，Keycloak 26.8.1 拒绝原 bind 目标 `integration-realm.json`：文件名必须与内容中的 realm 名匹配，即 `medcollab-integration-realm.json`。二号仅将 `makeCompose` 的导入目标改为 `REALM + '-realm.json'`，补充“不改变 manifest、realm、client 或凭证”的回归断言，离线工具测试现为8项通过。主控仅据此更新隔离 Compose 挂载目标，保留全部原有秘密和卷。

主控后续确认：首次文件 bind 在本次隔离 Keycloak 卷的 import 目录留下了空的 `integration-realm.json` 占位；改用新目标后，Keycloak 仍扫描旧空 JSON 并报 `No content`。主控先只读列出文件名和字节数，确认相关两个卷内占位文件均为0字节，再严格核验卷的 ownerId 与本次 manifest 一致；仅将旧空 `integration-realm.json` 重命名为 `integration-realm.empty-before-fix` 留存，随后重新 up。未删除卷、未修改 realm 或秘密，未触碰原服务或原数据。

这是旧失败准备的定向恢复历史，不是默认准备/启动步骤。新工具首次 prepare 已采用正确文件名，不会产生该旧占位；不应据此加入通用清空 import 目录、删除卷或重置凭证的逻辑。二号本次只补充记录，没有自行执行容器或 runtime 操作。
