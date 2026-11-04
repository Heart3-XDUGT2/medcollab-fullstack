# Portal 隔离真实联调接线

日期：2026-11-04。状态：联调准备；尚未声明真实联调通过。root 统一启动栈、备份和发布，前端执行官不启动 / 重启服务、不提交推送。

## 当前差距与必要条件

- 当前 60833 是默认 `apiEnabled:false`、无业务代理的 Vite；不是 Java/Keycloak/Orthanc 联调入口。初次只读端口核对没有发现 8080 / 8082 监听。
- 源码已有 Cookie / fresh CSRF、团队、1 GiB 串行导入和统计 v1；收藏 / 最近仍无 API，只保留明确演示和缺能力状态，不调用草案路径。
- 原网关运行配置将 logout origin 固定为旧 Keycloak 8081。新增 `PORTAL_LOGOUT_ORIGINS` 受控 JSON origin 数组，默认不变，启动前严格验证；隔离栈由 root 注入其 Keycloak origin，不把测试端口写死进产品。
- 真实联调必须由 root 提供全隔离栈、隔离数据库 / Orthanc 卷、新版服务与本轮前端构建、临时 A/B 账号和合成单帧 CT。旧版 health 缺统计标记不能当数据集删除。

## 与栈准备脚本的 manifest 约定

已按二号 `tests/integration/README.md` 的实际 v1 合同接线。最终测试只从显式 `PORTAL_STACK_MANIFEST` 文件读取，不猜运行账号或原服务端口：

```ts
{
  schemaVersion: 1,
  projectName: "medcollab-work-home-integration",
  runtimeRoot: string,
  sourceRoot: string,
  urls: { portal: string, java: string, keycloak: string, orthanc: string },
  realm: string,
  issuer: string,
  users: {
    a: { username: string, subject: string },
    b: { username: string, subject: string }
  },
  paths: { credentials: string, dicomManifest: string },
  dicomFiles: string[] // two absolute paths to synthetic 16x16 classic CT frames
}
```

`paths.credentials` 指向私有 JSON，其中 `users.a/b` 各含 username/password；密码不进入非秘密 manifest。账号名称不写死，使用 `a` / `b` 角色槽位。私有凭证只在 ignored runtime，不进源码、日志、截图、trace 或保存的浏览器 state。测试标题不含密码，失败先关闭私有页面再报告静态阶段名，避免失败快照附上登录表单或邀请码。

真实套件：根目录 `tests/integration/portal-stack.spec.ts`，由 root 使用 Portal 已有 Playwright 运行。没有 API/session 拦截或伪造账号：先核对隔离项目 / 路径 / 端口、网关 Java 端口和 runtime auth/logout 配置，再实际跳 Keycloak 登录、个人串行导入、原目标重复导入去重、A 按账号共享给 B、团队创建 / 加成员 / 导入、B 读取共享 / 团队权限及统计、两账号实际 SSO 退出，并验证再次登录需要密码。仅操作隔离栈中新建的测试对象，不访问原账号、原影像或原实例；失败不自动重试写入或声称回滚。

两张合成单帧 CT 的真实统计应为分母 2、共享与已归档掩码均为 0；这来自已读的合成 fixture manifest，不由 instanceCount 推导。B 在共享前读取私人 launch 应 404；B 不能获得其他上传者的团队删除控件。

新增非零验收：个人资料导入后先验证 0/2，再从正常 `segmentation/sources` / 序列 status GET 取得真实源帧与版本，重新获取真实账号 A 会话，以动态 CSRF 和 issuer/subject 头向现有 `publish-labelmap` POST 发布一帧一个像素。只发一次，未知结果即失败，不自动重放。随后通过正式统计适配器验证共享 / 已归档均为 1/2、ratio 0.5、percent 50；实际页面紧凑摘要、原生展开明细和资料概览 detail 均须一致。共享后 B 也读取到同一 50% 结果。团队独立新资料仍核验 0/2，避免将个人发布误计到另一业务数据集。

本步骤不直接写 H2 / Orthanc，不使用模拟接口，也不把掩码、凭证或响应原文写报告。发布测试准备已过独立 TypeScript 检查；root 当前首轮结束后才重跑包含它的套件，尚未宣称该非零步骤实跑通过。

root 第二次真实运行已确认 OIDC A/B、首次串行导入、0/2、正常发布与页面 compact/detail 1/2=50%，随后发现测试 helper 将所有导入错误地写成“成功 2”。本次仅修正测试：重复已有目标与团队复用同 CT 必须精确为成功 0 / 已存在 2 / 失败 0 / 已处理 2/2；新业务资料首次导入允许全新存入或此前中断测试已存入的两种明确结果，不能以随机后端重命名或修改产品 Success 语义绕过。团队新业务资料依旧核验 0/2，共享 B 个人资料依旧核验 1/2；全部服务器与 UI 统计断言保留。更新后独立类型检查通过，待 root 重跑整套验收。

工作台启动只核对受控 `/workspace` 和真实 launch JSON；是否实际完成 OHIF 像素渲染另列验收，不以跳转或上下文 JSON 冒充已打开 / 已保存。上传小型合成 CT 不代表 1 GiB 容量压测通过。

## 已准备的额外只读探针

Portal `tests/integration/` 有独立、默认跳过的只读探针配置。其 read-only transport 拒绝写、外站、收藏 / 最近草案、Labelmap / 像素；禁用 API 重定向，不导出 Cookie，不保存响应和 trace。该探针用于 root 已协调目标的契约检查，不启动任何服务；它不替代上方真实 OIDC / 写流程。

后续记录应分别标明：源码适配、受控响应回归、隔离真实服务联调、原生产服务和 GitHub 发布状态。

## 运行入口与准备验证

以下命令由 root 在仓库根、隔离栈已就绪后执行，不启动服务：

```powershell
$env:PORTAL_STACK_MANIFEST='C:\ABSOLUTE\.runtime\integration\work-home-live\manifest.json'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node frontends/portal/node_modules/@playwright/test/cli.js test -c frontends/portal/tests/integration/stack.config.ts
```

未设置 manifest 时套件跳过，不向原服务发送请求。trace / video / screenshot 关闭，不保存 browser storageState。运行结果目录为 ignored `.runtime/integration/portal-results`。

准备验证：独立 integration TypeScript 检查通过；只读传输安全 18 项单测通过；网关 runtime origin 及原接收 / 上游超时合计 50 项通过。原 WebSocket 测试未能载入，因当前 OHIF `node_modules/ws` 缺失；未安装依赖或修改旧测试来掩盖，代理源码没有改动。真实栈尚未由本执行官启动或运行，不将以上检查冒称真实联调通过。
