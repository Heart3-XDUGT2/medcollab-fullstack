# MedCollab Full Stack 开源发布前检查清单

更新时间：2026-11-20

这份清单针对仓库根目录的完整源码包：Portal、OHIF 工作台、Java/Python 后端、Node 网关、Keycloak/Orthanc 本地部署模板和测试。它不是许可证意见，也不替代医疗软件合规、隐私或安全评估。

## 当前结论

当前仓库已经具备公开源码的基本授权和检查入口。旧 Git 历史中的本机路径已完成风险评估，项目决定接受其低风险披露，不再为此重写历史。

仍需在公开前完成下面的常规复核：

1. 复核第三方代码、字体、图标、文档图片和示例配置的归属。
2. 从当前开发分支建立一个明确的发布分支，只选择要公开的提交和文件。
3. 在干净克隆中重新执行构建、测试和最小启动检查。

## 本轮只读审计结果

### 已确认

- 根 `.gitignore` 已忽略 `.env`、生成凭据、运行目录、依赖、编译产物、日志和常见医学影像后缀。
- 当前索引中没有发现 `.dcm`、`.nii`、`.nrrd`、数据库文件、私钥文件或真实环境文件。
- 当前 `main` 文件内容中没有发现项目成员的本机用户目录路径。
- `deploy/.env.example` 使用占位符，`scripts/setup.mjs` 会为本地运行生成随机凭据。
- OHIF、Portal 和多个扩展保留了各自的 `LICENSE`；根目录有 `THIRD_PARTY_NOTICES.md`。
- 远程地址为 `https://github.com/Heart3-XDUGT2/medcollab-fullstack.git`。本轮网络连接 GitHub 失败，因此没有把远程状态当成已验证事实。

### 发现但未修改

- 当前 `main` 的可达 Git 历史仍包含本机用户目录路径，主要来自旧 UI 研究提交。这些路径不构成凭据、患者数据或服务访问信息；项目已评估并接受这一低风险披露，不再重写历史。
- 工作树中的本机设计预览和合并调试文件已被 `.gitignore` 排除，不会随 `git add .` 进入发布提交。
- OHIF 上游示例中存在 `POSTGRES_PASSWORD=pacs` 这类演示默认值。它不是本项目运行凭据，但发布说明必须明确“仅限示例”，不能用于生产。
- 根目录已加入 MIT `LICENSE` 和 `LICENSE-SCOPE.md`；它只覆盖未带更具体声明的 MedCollab 原创内容，不替代 OHIF 或其他第三方许可证。
- OHIF 的工作流位于 `frontends/ohif/.github/workflows/`，不会自动成为整合仓库根目录的 GitHub Actions。若要为 fullstack 提供 CI，需要在根 `.github/workflows/` 增加整合仓库工作流。

## 发布阻塞项

### 1. 复核许可证范围

建议采用“分层许可”：

- MedCollab 原创代码（`backend/`、`gateway/`、`scripts/`、`deploy/`、`frontends/portal/` 中确属原创的部分）按根目录 MIT 许可证发布。
- `frontends/ohif/` 及其上游扩展继续遵守目录内已有许可证和上游归属。
- 根目录的 `THIRD_PARTY_NOTICES.md` 记录这种范围，不覆盖第三方原有许可证。

在项目所有者确认前，不要新建一个会让人误以为覆盖全部文件的根 `LICENSE`。

### 2. 处理 Git 历史与可识别路径

当前文件树的脱敏不等于历史脱敏。历史中的旧路径仅用于开发研究记录，不包含凭据、患者数据或可直接访问服务的地址；项目已明确接受该低风险披露，因此保留现有提交历史和贡献者归属。

### 3. 补齐归属清单

发布前至少核对：

- OHIF、Cornerstone、VTK、Keycloak、Orthanc 的上游许可证和版本。
- Portal 使用的 React、Radix、Lucide、Inter 等依赖及仓库内许可证文本。
- 文档截图、图标、字体、测试基准图是否来自上游，是否允许再分发。
- `pnpm-lock.yaml` 和 Maven/Python 依赖是否需要生成依赖清单或 SBOM。

### 4. 选择发布内容

发布分支只应包含：

- 可运行源码、锁文件、部署模板、测试和必要文档。
- 不包含 `.runtime/`、`node_modules/`、`target/`、虚拟环境、浏览器状态、日志、真实医学影像、账号、数据库和本机截图。
- 设计探索草稿、临时预览和只对本机有意义的交接记录，除非明确作为项目文档保留。

## 推荐的发布流程

```powershell
# 1. 在干净目录克隆或从已审核提交建立发布分支
git switch main
git pull --ff-only
git switch -c chore/open-source-release

# 2. 只添加经过筛选的文件
git add README.md LICENSE CONTRIBUTING.md SECURITY.md THIRD_PARTY_NOTICES.md docs
git diff --cached --stat
git diff --cached --check

# 3. 发布前扫描
git status --short
git ls-files | Select-String -Pattern '(^|/)(\.env|.*\.pem|.*\.key|.*\.p12|.*\.sqlite|.*\.db)$'

# 4. 通过本地验证后再提交
git commit -m "chore: prepare full-stack source for open-source release"
```

不要使用 `git add .`、`git push --force` 或直接把当前开发分支改名为 `main`。公开仓库的可见性切换应在发布提交、许可证和敏感信息复核完成后由仓库管理员执行。

## 验收门槛

- [x] 根许可证范围已由项目所有者确认，原创内容采用 MIT。
- [ ] `README.md` 能在新机器上说明依赖、启动顺序、默认端口和已知限制。
- [ ] 新鲜克隆可以运行 Portal 类型检查、单元测试和构建。
- [ ] Java 测试和 Python SEG 编解码依赖安装说明已验证。
- [ ] Docker Compose 模板只绑定本机或明确写出生产部署风险。
- [ ] 没有提交凭据、真实账号、真实医学影像、数据库、浏览器状态或私有运行日志。
- [ ] 当前文件树中的本机绝对路径已替换。
- [x] 可达 Git 历史中的本机路径已评估，项目接受其低风险披露，不重写历史。
- [ ] 第三方归属和许可证文件可从仓库内追溯。
- [ ] 根目录 CI 只运行公开仓库可以完成的检查，不依赖私人 secrets、私有 PACS 或本机路径。
- [ ] 发布提交在独立克隆中复核过，再由管理员推送和切换仓库可见性。

## 当前未验证

- 本轮没有重新启动 Docker、Keycloak、Orthanc 或真实浏览器登录链路。
- 本轮已核对 `main` 与 `origin/main` 的提交一致性；远程历史中的本机路径仍需单独处理。
- 根目录 MIT 许可证已提交；仍需在公开前复核版权主体名称和第三方归属。
