# MedCollab 云端医学标注

包含 Portal 首页、OHIF 医学影像标注工作台、Java 后端，以及统一入口、Keycloak 登录主题和本地开发部署配置的完整源码包。完整包基线：2026-11-01；团队功能增量：2026-11-02。

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

## 上传 GitHub

解压后进入包含本 README 的 `medcollab` 文件夹，上传整个源码目录。不要把压缩包本身作为仓库源码。

先在 GitHub 创建空仓库，然后把下面最后一条命令的地址替换成你的仓库地址：

```bash
git init -b main
git add .
git commit -m "Initial MedCollab full-stack source"
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

上传前可用 `git status --short` 检查文件。根 `.gitignore` 已覆盖凭据、运行数据、依赖、编译产物和医学影像。OHIF 上游文档有图片资源，建议使用 Git 命令或 GitHub Desktop 推送。

## 开发资料与许可

接口改动先看 [前端交接文档](docs/frontend-handoff/README.md)，工作台行为见 [工作台接入说明](docs/workspace-integration.md)，后端配置见 [backend/README.md](backend/README.md)。历史文档中的本机部署与验证结果只描述原项目，不能代替本包的部署和测试结果。

原组件的 `LICENSE`、`THIRD_PARTY_NOTICES` 和字体/图标许可均保留。Java 后端和新增集成文件未另行指定开源许可证；本包没有擅自为整仓库授予统一 MIT 许可，公开发布时可由项目所有者决定这些文件的授权方式。见 [第三方来源](THIRD_PARTY_NOTICES.md)。
