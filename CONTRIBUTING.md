# Contributing to MedCollab

感谢参与 MedCollab。这个仓库包含 Portal、OHIF 工作台、Java/Python 后端和本地部署模板。提交改动前，请先确认改动属于哪个子系统，并保留对应目录的许可证和第三方归属信息。

## 开始前

1. 阅读根目录 `README.md` 和 `deploy/README.md`。
2. 运行 `node scripts/setup.mjs` 生成本机凭据，不要手写或提交 `deploy/.env`。
3. 只使用自己有权使用的合成或已脱敏医学影像。
4. 不要把 `.runtime/`、依赖目录、构建产物、浏览器状态、日志或真实影像加入提交。

## 提交改动

- 小范围改动使用独立分支。
- 提交信息说明行为变化，不要把本机路径、账号、令牌或运行数据写入提交。
- 前端改动至少运行受影响包的类型检查、单元测试和构建。
- 后端改动至少运行 `backend/mvnw.cmd test`（Windows）或 `backend/mvnw test`（Linux/macOS）。
- 接口、权限、数据格式或部署行为变化时，同步更新 `docs/` 下的契约和运行说明。
- 第三方代码、字体、图标或文档资产变更时，更新 `THIRD_PARTY_NOTICES.md` 或对应子目录的归属文件。

## Pull request

Pull request 请说明：

- 改动目的和影响范围；
- 如何验证；
- 是否需要新的环境变量、服务或迁移；
- 是否可能接触医疗数据、认证信息或权限边界；
- 尚未验证的部分。

不要在没有许可证归属确认的情况下复制新的第三方代码或资源。不要为了通过 CI 删除失败测试或放宽安全检查。
