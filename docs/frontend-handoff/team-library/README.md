# 团队影像库与个人不可撤销共享

版本：2026-11-02，team-library-v1 / personal-irrevocable-v1。

- [团队系统接口.md](./团队系统接口.md)：业务规则、全部团队 API、字段、错误、兼容性变更及接入顺序。
- [openapi.json](./openapi.json)：团队 API 和共享策略变更的 OpenAPI 3.1 契约。
- [contracts.ts](./contracts.ts)：新增 DTO 类型。
- [request-examples.ts](./request-examples.ts)：同源 Cookie、动态 CSRF、身份复核和取消示例。

覆盖到上一版完整源码包的仓库根目录，运行现有构建脚本并重启后端、网关。详细覆盖步骤见仓库根目录 `docs/team-system/覆盖与更新说明.md`；数据库沿用原路径，启动时自动创建团队和成员表、数据集团队归属表，以及数据集软删除列。无需新增 Keycloak 全局角色。

入口为 `http://127.0.0.1:8080/teams`，Portal 提供“团队影像库”导航。2026-11-02 前端落地后，该路径由 `frontends/portal/src/features/teams/TeamsPage.tsx` 的 React 页面接管；网关将 `/teams`、`/teams/` 作为 Portal SPA 入口，直接访问或刷新仍返回 Portal。原 `backend/src/main/resources/static/teams.html` 和 `teams.js` 保留为原始材料，不再作为 `/teams` 主页面。

更新源码后，在仓库根运行 `node scripts/build.mjs portal`（或已安装依赖时在 `frontends/portal` 运行 `pnpm build`），由原有网关读取新 `dist`；网关路由代码有改动时需按部署流程重启网关。本次 UI 实施没有启动真实服务或部署。API、认证、OHIF 回退与 `/mask-drafts.js` 的路由边界不变。

个人共享确认后不可撤销，包括已有共享；团队成员移除仍允许。团队数据集删除采用软删除，原始 Orthanc 文件可能仍被其他数据集引用。旧接口文档中允许个人撤销共享的内容以本次变更为准。
