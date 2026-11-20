# 上传预检、团队收藏与团队来源入口交付记录

日期：2026-11-07。基线：main `96e65b8`。范围仅 Portal、测试与文档。

## 变更

- 个人与团队共用上传预检：在创建数据集之前拒绝 TXT、图片、文档等明显不支持的文件名或 MIME，混合批次整体阻止。保留无扩展名、未知后缀及 DICOM MIME 候选，不增加扩展名白名单。
- 团队数据集使用现有全局收藏 API 与 `useHomeActivity` 读取、收藏和取消收藏。未知状态不可写；切换团队、账号或失权会中止旧上下文；写入结果未知不自动重试。
- 工作目录及个人完整资料库增加“团队资料”入口，只列本人团队，选择一个团队后进入其独立资料库。不遍历所有团队数据集，不聚合到个人数组，不伪造统一分页或总量。
- 个人来源标签与现行副本契约统一为“我拥有的”。保留现有个人删除、转发副本及团队删除权限约束。
- 旧共享演示测试更新为转发历史语义，保留无撤销入口、明确选择后才可提交和无真实请求断言。已转发账号仍可搜索，不代表对方当前持有副本。

## 验证

- `tsc --noEmit` 通过；Vitest 25 文件、392 项通过。
- Playwright 全量 170/170 通过；正式单入口 dist 上 TeamFavorites + ActionClarity 24/24 通过。
- 新增 TeamFavorites 17 项覆盖真实客户端 API 协议、fresh CSRF、切换团队/账号、401/403/404、缺失/失败状态、未知写入不重放、延迟 T1 响应不启用 T2、两种上传入口和四种尺寸。
- 1920/1440/768/390 截图已生成；人工查看四尺寸代表状态及手机菜单、空态、错误态、来源弹窗，无需视觉修正。键盘焦点返回、44px 收藏按钮、无横向溢出与手机 reduced-motion 由测试确认。
- 修复前后日志保留；全量初次失败来自旧转发语义测试，两处过时断言已修正，没有为通过测试修改产品或去除安全断言。
- 正式执行 `node node_modules/vite/bin/vite.js build --outDir dist`；构建前后 129 个源码/测试文件 SHA-256 未变。
- dist 为 21 个正式文件，无 fixture 或 design-preview 入口。20 个静态文件逐一与现有 8080 HTTP 响应 SHA-256 相同；`config.js` 由 `gateway/unified-server.mjs` 动态生成，已单独校验，不能与 dist 默认配置混称哈希相同。
- 现有网关 PID 65424 未重启。公开 `/api/health` 确认 `homeActivityApi:v1`、`teamApi:team-library-v1`、`sharingPolicy:personal-forward-copy-v1`、`annotationStatsApi:v1`。

证据目录：`frontends/portal/.runtime/team-favorites/`。

- `full-confirmed.log`：全量 170 通过。
- `unit-final.log`、`share-final.log`、`production-smoke.log`：单元、旧用例定向复测、正式产物冒烟。
- `build-final.log`、`http-final.log`、`verify-dist.mjs`：构建及逐文件 HTTP 核验。
- `first/`：四尺寸 × 六状态，共 24 张截图；未扩展新设计或追加视觉改稿。

## 安全与边界

浏览器测试全部使用拦截的合成 API 数据，不是登录真实账户后的后端集成测试；未执行真实文件上传、删除或收藏写入。公开健康检查及静态产物 HTTP 核验不等于真实业务写入验收。

预检不能证明候选内容为 DICOM；伪装后缀、未知格式的实际字节仍由服务器校验。现有创建再导入的两步 API 在后续导入失败时仍可能留下空数据集，本轮未声称实现原子事务。

跨团队统一列表、搜索和分页仍需要后端聚合 API。相关建议另见 `docs/frontend-handoff/统一资料来源与团队收藏-接口边界及聚合建议-2026-11-07.zh-CN.md`；本轮只提供单团队入口。

没有改后端、OHIF、依赖或数据库，没有启动/停止服务，没有提交或推送。忽略的 `.env` 未读取或修改；历史未跟踪文档与预览文件保留。

## 回滚依据

- 安全引用：`refs/safety/portal-team-favorites-20261107`，提交 `c76bb53d0727cd865ef8fe88e86fd2b9d855020a`；真实暂存区未变。
- 原 dist：仓库根 `.runtime/safety/portal-team-favorites-20261107/dist`；相邻 `manifest.json` 记录 21 文件 SHA-256，收口前再次逐一验证通过。
- 如需回退，仅按本轮 diff 撤回本轮 Portal/测试改动，或在明确授权后还原该 dist 备份；不要对整个工作树执行 reset/checkout，也不要覆盖历史未跟踪文件或 `.env`。安全引用仅为回滚依据，本轮未实际执行回滚。
