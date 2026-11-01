# 本地开发与复现

此配置把 Portal、OHIF、Java、Keycloak 和 Orthanc 接到同一个本地应用入口。它是新机器的开发模板，未包含原机器的数据或账号。需要 Docker Compose v2、Node.js 24+（带 npm/npx）、JDK 25、Python 3.10+。首次构建需要联网下载依赖，OHIF 构建需要较多内存，其源码配置给 Node 设置了 24 GiB 堆上限。

所有命令都在仓库根目录执行。Java、Node、Python 在宿主机运行；Docker 运行 Keycloak 与 Orthanc。这样浏览器与 Java 看到的 OIDC issuer 都是同一个 `http://127.0.0.1:8081`。

## 1. 生成新的本地凭据

```sh
node scripts/setup.mjs
```

脚本生成 `deploy/.env` 和 `deploy/generated/medical-demo-realm.json`；两者必须被 Git 忽略，不能提交。重复执行会保留已有凭据。没有预设业务用户。Realm 导入文件只含供用户搜索使用的目录服务账号，它拥有 `view-users` 和 `query-users` 角色。

Keycloak 管理员用户名与随机密码保存在 `deploy/.env`。浏览器可访问 `http://127.0.0.1:8081/admin/`。不要把密码贴到仓库、截图或问题单。

## 2. 启动基础服务

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail 100
```

等待 Keycloak 启动并完成 `medical-demo` realm 导入。可在浏览器检查以下地址：

- `http://127.0.0.1:8081/realms/medical-demo/.well-known/openid-configuration`
- `http://127.0.0.1:8042/system`
- `http://127.0.0.1:8042/dicom-web/studies`（新仓库应返回空数组）

Keycloak 登录主题挂载自 `gateway/theme/medcollab-portal/`。Orthanc 模板使用 `orthancteam/orthanc:latest` 和该镜像的 `DICOM_WEB_PLUGIN_ENABLED` 开关；在验证运行环境后，可在本地 `.env` 中把 `ORTHANC_IMAGE` 固定为采用的版本或镜像摘要。交付时未在 Docker 中启动验证这些容器。

Keycloak、Orthanc 数据分别写入 Docker 命名卷。Keycloak 只在 realm 不存在时导入，不能通过重新生成 `.env` 修改现有 realm 的秘密；若需改密，应在 Keycloak 管理端与本地 `.env` 同步修改。普通重启无需重新初始化。

## 3. 安装 Python 编解码依赖

Windows PowerShell：

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install --cache-dir .runtime/pip-cache -r backend/python/requirements-seg.txt
```

Linux/macOS：

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install --cache-dir .runtime/pip-cache -r backend/python/requirements-seg.txt
```

该环境用于 DICOM SEG 编解码。启动脚本自动选择它；也可以设置 `SEGMENTATION_PYTHON` 为一个已安装相同依赖的 Python 可执行文件绝对路径。

## 4. 构建与启动

```sh
node scripts/build.mjs
```

脚本分别使用 Portal `package.json` 声明的 pnpm 12.4.1 和 OHIF 的 pnpm 12.8.1，并按锁文件安装；它通过 npx 调用版本固定的包管理器，不要求全局安装 pnpm。OHIF 构建设置 `APP_CONFIG=config/medcollab-server.js` 与 `PUBLIC_URL=/imaging/`。Java 使用随项目附带的 Maven Wrapper 执行 `package`，包含现有测试。也可以传入 `portal`、`ohif` 或 `backend` 单独构建。

构建脚本把 npm、pnpm、Maven 下载缓存与临时文件放在仓库根目录 `.runtime/`，保持与工作目录处于同一磁盘。修改 Portal 登录样式后，可运行 `node gateway/prepare-theme.mjs` 同步生成 Keycloak 主题资产。

在一个终端运行：

```sh
node scripts/start-backend.mjs
```

在另一个终端运行：

```sh
node scripts/start-gateway.mjs
```

打开 `http://127.0.0.1:8080/home`，通过登录页注册自己的新测试账号。保持使用 `127.0.0.1`，不要与 `localhost` 混用，以免 Cookie 与 OAuth 回调来源不同。Java 监听 8082，网关监听 8080。后台 H2 数据库和临时文件写入根目录 `.runtime/`；不要把它提交到 Git。端口、回调地址、主题 appUrl 与前端允许的登出来源需要保持一致，本模板固定这些本地地址。

## 5. 验证与停止

访问 `http://127.0.0.1:8080/api/health`，确认后端与影像服务状态；登录后上传经授权的测试影像，打开工作台，验证草稿、发布和 DICOM SEG 导出。两个账号之间可验证影像共享与用户搜索。源代码包不提供医学数据。

在 Java 与网关终端按 Ctrl+C 停止进程。停止容器而保留数据：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

不要加 `--volumes`，除非明确要删除 Keycloak 账号和 Orthanc 影像数据。

## 部署边界

所有发布到宿主机的服务端口只绑定 `127.0.0.1`。当前后端不向 Orthanc 发送登录凭据，所以 Orthanc 模板在容器内部允许访问、关闭其自身认证，通过宿主机回环绑定限制入口。不要把 8042 直接暴露到公网。

此模板使用 Keycloak `start-dev` 和嵌入式存储、Java H2 数据库、HTTP 与本地固定地址。对外部署前，需要配置 HTTPS/域名、生产数据库和备份、受限内部影像网络，并联动修改网关、OIDC 回调、Cookie 和主题配置；当前模板不是生产部署方案。
