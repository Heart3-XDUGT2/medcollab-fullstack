# 真实隔离联调与发布记录

日期：2026-11-04。基于队友主分支 `28c2ee1`，发布分支 `feat/portal-work-home-integration`。不直接推送或覆盖 main，不修改队友本轮 OHIF 三个进度展示文件。

## 本次实际通过的链路

运行生产 Java Controller/Service/安全过滤链、真实 Keycloak OIDC、Orthanc 和 Python SEG 编解码，Portal 使用生产构建与同源网关。浏览器没有拦截业务 API，没有注入测试登录身份，也没有直写 H2：

- A/B 两个全新合成账号通过正常登录页面完成 OIDC 登录。
- Portal 串行导入两帧全合成 CT；重复导入保留两个业务实例，返回 AlreadyStored，不重复增加成员。
- 正常发布其中一帧的一个像素标注；统计接口与首页紧凑/完整详情均验证 `1 / 2`、`50%`，共享画布与已归档分别核对。
- 未共享时 B 无权访问 A 的资料；正常按账号共享后 B 可访问并读到相同 50%。
- 创建团队、添加成员、团队上传、另一成员访问及非上传者无删除控件通过；相同 CT 导入新业务数据集仍为未标注，发布不跨业务集串用。移除成员后的访问拒绝由既有受控/Java回归覆盖，本次真实场景未执行移除。
- Java 与 Keycloak 两侧退出通过；重新进入登录时要求密码。

命令：

```powershell
$env:PORTAL_STACK_MANIFEST = '<checkout>\.runtime\integration\work-home-live\manifest.json'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node node_modules/@playwright/test/cli.js test --config tests/integration/stack.config.ts
```

在 Portal 目录执行。最终一个完整串行端到端场景通过，包含以上步骤；不能将它说成多项独立用例或完整 OHIF 浏览器标注验收。

## 数据保护与运行环境

- 独立 Compose 项目 `medcollab-work-home-integration`，网关18080、Java18082、Keycloak18081、Orthanc18042。
- 原容器、原数据卷、账号、H2、JAR、Portal dist 和登录主题没有用于这次写测试。
- Java 使用独立源码归档的 JAR、内存 H2；测试 CT 只在忽略的 runtime 生成，不包含患者文件。
- 清理首次触发延后七天，测试 Java 存活上限一小时；独立 Orthanc 无原始项目资料。没有用源码回滚冒充数据备份。
- 测试密码、client secrets、realm、Compose 配置、日志均只在被 Git 忽略的 `.runtime/integration/`；未保存认证截图、trace、storageState 或响应凭证。
- 网关新增部署控制的 `PORTAL_LOGOUT_ORIGINS`，默认仍为原8081；独立栈显式允许18081。配置严格校验纯 HTTP(S) origin，不从用户参数或浏览器存储接收。

## 发现和修正

1. 测试工具的 Keycloak 导入文件名需匹配 realm，已修为 `medcollab-integration-realm.json` 并补离线回归。恢复时只移动了经核验属于本测试卷的旧零字节占位文件，保留备份，没有删除卷或更改密码。
2. 跨时段中断后隔离容器未运行导致首次真实登录失败；重新检查依赖服务就绪后重跑，不归因于产品登录代码。
3. 测试原先将重复导入错误断言为“成功2”，已按实际 `Success + AlreadyStored` 分类修正，重复导入严格验证“成功0、已存在2”；产品去重逻辑未修改。

## 其他验证与明确未完成

- 独立后端打包前运行111项 Java 测试通过；构建只写独立归档目录，没有替换原JAR。
- Portal 类型与单测、此前78项受控浏览器回归及三尺寸独立视觉确认见实施记录。受控回归不冒充本次真实联调。
- 真实收藏/最近 API 仍未提供；此两项只有明确演示空间内存交互，未伪造云同步。
- 本次发布通过正常 API 完成，不包含 OHIF 的实际画笔操作、多人 WebSocket 全场景或临床质量验收。队友最新 OHIF 进度代码原样保留。
- 没有合并 PR、部署生产或替换用户原运行产物的授权；GitHub 交付通过独立分支/PR供团队审查。

启动、停止和隔离边界见 [工具说明](../../../tests/integration/README.md)。安全快照 `refs/safety/frontend-backend-integration-20261104` 指向 `c576381bdda5d1efb1921c3761f567a43e8da596`，包含开始前全部 tracked/untracked 源码，不改变当时工作树或实际暂存区。
