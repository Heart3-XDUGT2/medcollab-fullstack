# MedCollab 云端医学标注

MedCollab 是一个面向 **AI 训练集制作与医学影像科研标注** 的云端多人协作平台。它把数据集管理、医学影像浏览、标注编辑、团队协作和结果发布放在同一个可自部署的完整源码包中。

当前源码包包含 Portal 首页、OHIF 医学影像标注工作台、Java 后端，以及统一入口、Keycloak 登录主题和本地开发部署配置。它适合研究、数据集整理和工程验证；**不构成临床诊断建议、医疗器械认证或生产环境安全方案**。

## 项目功能

- **账户与数据集管理**：通过 Keycloak/OIDC 登录；在 Portal 中查看个人、团队和公开数据集，支持上传、搜索、最近打开、收藏、删除和标注完成度概览。
- **团队资料库**：创建团队、管理成员与组长权限，将数据集放入团队空间，按团队权限进入影像工作区。
- **医学影像工作台**：基于 OHIF 和 Cornerstone，支持 DICOM/DICOMweb 影像浏览、CT 多平面查看、窗宽窗位、测量、ROI/分割标注和 DICOM SEG 发布、读取与导出。
- **多人协作标注**：支持在线成员、光标/笔迹预览、单写多读编辑租约、可靠掩码操作流、断线补拉、冲突保护和后台 SEG 归档。
- **标注进度统计**：根据服务器接受的标注操作和已标注切片统计数据集进度，帮助团队查看任务完成情况。
- **可自部署的服务组合**：Node 统一网关、Spring Boot 后端、Orthanc DICOM 存储、Keycloak 身份服务，以及 Docker Compose 本地开发模板。

当前主要面向 DICOM 工作流；NIfTI 尚未接入完整的导入、浏览、标注保存闭环。请使用自己有权处理的合成或脱敏数据。

当前实现支持账户登录、影像导入、影像集归属与成员共享、CT 浏览与多标签绘制、浏览器草稿、DICOM SEG 发布/读取/导出及发布版本冲突检查。现已支持团队/组长管理与独立团队影像库；团队成员只能删除自己创建的数据集，个人共享确认后不可撤销。已增加单写多读实时协作：在线成员、光标/笔迹预览、可靠掩码操作流、编辑租约、断线补拉及后台 SEG 归档。工作区点击“开启实时协作”后申请编辑，详见 [v0.2 协作协议](docs/team-system/realtime-collaboration-v0.2.zh-CN.md)。

## 目录

| 目录 | 内容 |
| --- | --- |
| `frontends/portal/` | React + TypeScript + Vite 首页、影像集与共享管理，含测试、锁文件和许可证 |
| `frontends/ohif/` | 完整 OHIF 工作区源码、MedCollab 扩展/模式、Cornerstone 补丁、测试和上游文档 |
| `backend/` | Java 25 / Spring Boot 后端、Maven wrapper、Python DICOM SEG 编解码器及测试 |
| `gateway/` | Node 统一入口、工作台跳转逻辑、Keycloak Portal 登录主题 |
| `deploy/` | Keycloak / Orthanc 配置模板、本地部署说明 |
| `scripts/` | 初始化、构建、后端与统一入口启动脚本 |
| `docs/frontend-handoff/` | 当前接口完整路径、TypeScript 契约、示例和兼容性验收清单 |
| `docs/PACKAGING.md` | 打包范围、改动与验证记录 |

浏览器访问 `http://127.0.0.1:8080/home`；网关转发到 Java `8082`，登录由 Keycloak `8081` 处理，影像存于 Orthanc `8042`。各服务默认仅在本机访问。

团队新增接口见 [团队系统接口](docs/frontend-handoff/team-library/团队系统接口.md)，增量覆盖步骤见 [覆盖与更新说明](docs/team-system/覆盖与更新说明.md)。登录后从首页进入“团队影像库”，地址为 `/teams`。

## 本地启动

准备 Node.js 24+、JDK 25、Python 3.10+、Docker Compose。构建脚本会调用两个前端各自声明的 pnpm 版本，无需全局安装。以下为 Windows PowerShell 命令，Linux/macOS 命令及完整配置见 [部署说明](deploy/README.md)。

```bash
node scripts/setup.mjs
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install --cache-dir .runtime/pip-cache -r backend/python/requirements-seg.txt
node scripts/build.mjs
```

然后分别在两个终端运行：

```bash
node scripts/start-backend.mjs
```

```bash
node scripts/start-gateway.mjs
```

初始化会在本机生成独立凭据；包中没有原电脑的账户或密码。首次启动是空数据库、空影像库，在页面注册账户并上传自己有权使用的影像后开始标注。当前开发配置固定使用 `127.0.0.1`，请不要混用 `localhost`；域名、HTTPS、备份和生产权限配置需部署时另行设置。

## 参与开发

本项目已公开发布。参与开发时，请从最新 `main` 创建功能分支，只提交与当前改动相关的文件，并先阅读 [贡献指南](CONTRIBUTING.md)。

```bash
git status --short --branch
git switch main
git pull --ff-only
git switch -c feat/your-change
git diff --check
git diff --stat
```

提交前请确认没有凭据、真实账号、患者数据、医学影像、运行目录或构建产物：

```bash
git add <reviewed-files-only>
git diff --cached --check
git commit -m "describe your change"
git push -u origin feat/your-change
```

请通过 Pull Request 合并改动。不要使用 `git push --force` 覆盖团队分支。根 `.gitignore` 已覆盖凭据、运行数据、依赖、编译产物和常见医学影像；OHIF 上游文档、字体和图标的许可证与归属必须保留。

## 开发资料与许可

接口改动先看 [前端交接文档](docs/frontend-handoff/README.md)，工作台行为见 [工作台接入说明](docs/workspace-integration.md)，后端配置见 [backend/README.md](backend/README.md)。历史文档中的本机部署与验证结果只描述原项目，不能代替本包的部署和测试结果。

根目录 `LICENSE` 现在为 MedCollab 原创代码和未带更具体声明的文档提供 MIT 授权；`LICENSE-SCOPE.md` 说明适用范围。OHIF、字体、图标和其他第三方组件继续保留各自的许可证与归属，见 [第三方来源](THIRD_PARTY_NOTICES.md)。

项目已公开发布。许可证范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)，安全问题请按 [SECURITY.md](SECURITY.md) 报告，贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。维护者仍可参考 [开源发布检查清单](docs/OPEN_SOURCE_RELEASE_CHECKLIST.zh-CN.md) 进行后续审计。
