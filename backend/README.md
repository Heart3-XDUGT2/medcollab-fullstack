# Java 后端

这里包含完整 Spring Boot 业务源码、原版静态演示页面、6 个 Java 测试类，以及 Python DICOM SEG 编解码器。当前 Portal 和 OHIF 的统一访问入口在项目根目录说明中，后端默认监听 `127.0.0.1:8082`。

## 依赖与构建

- JDK 25；Spring Boot 4.1.2。
- Maven wrapper 已包含，首次运行会下载 Maven 3.10.0 和依赖；无需全局安装 Maven。
- Python 3 与 `python/requirements-seg.txt` 中固定版本的 `highdicom`、`pydicom`，用于 DICOM SEG 发布与导出。
- 独立运行的 Keycloak 和启用 DICOMweb 的 Orthanc。

所有后端命令都在本目录 `backend/` 执行。Linux/macOS/WSL：

```bash
./mvnw test
./mvnw package
```

Windows PowerShell：

```powershell
.\mvnw.cmd test
.\mvnw.cmd package
```

使用根目录提供的部署/启动说明安装依赖并配置 Keycloak。单独启动时，在本目录运行 `java -jar target/demo-0.0.1-SNAPSHOT.jar`。Java 需要 `KEYCLOAK_CLIENT_SECRET`；用户共享搜索还需要 `KEYCLOAK_DIRECTORY_CLIENT_SECRET`。账号和密码由 Keycloak 管理，源码包不包含现有账号、密码或客户端密钥。

## 环境变量

| 变量 | 默认值或用途 |
| --- | --- |
| `SERVER_PORT` | `8082`，Java 内部服务端口 |
| `APP_BASE_URL` | `http://127.0.0.1:8080`，浏览器统一入口与 OIDC 回调来源 |
| `ORTHANC_BASE_URL` | `http://127.0.0.1:8042` |
| `KEYCLOAK_ISSUER_URI` | `http://127.0.0.1:8081/realms/medical-demo` |
| `KEYCLOAK_CLIENT_ID` | `medical-demo-web` |
| `KEYCLOAK_CLIENT_SECRET` | 必填，Web 登录客户端密钥 |
| `KEYCLOAK_DIRECTORY_CLIENT_ID` | `medical-demo-directory` |
| `KEYCLOAK_DIRECTORY_CLIENT_SECRET` | 用户查询服务账号密钥 |
| `APP_DATABASE_URL` | `jdbc:h2:file:../.runtime/database/access-control;DB_CLOSE_ON_EXIT=FALSE` |
| `SEGMENTATION_PYTHON` | `python3`；应指向装好 Python 依赖的解释器 |
| `SEGMENTATION_CODEC_SCRIPT` | `python/seg_codec.py` |
| `SEGMENTATION_WORK_DIR` | `../.runtime/segmentation` |
| `APP_DATASETS_SEED_ENABLED` | `false`，干净安装不加载旧演示数据 |

相对路径以 `backend/` 为工作目录。默认数据库与分割临时文件位于仓库根目录的 `.runtime/`，不应提交到 Git。表结构和兼容迁移由 `DatasetService`、`SegmentationService` 在启动时创建，测试使用内存 H2。`src/test/resources/public-datasets.json` 是迁移测试专用的合成清单，只有虚构 ID，不含影像或原机器的数据；它不进入应用 JAR。

## 导入影像

源码包不包含医学影像或原机器的 Orthanc 实例清单；`src/main/resources/public-datasets.json` 已置为 `[]`，默认关闭历史演示数据初始化。请保持该开关关闭，通过当前 Portal 上传入口，或经过 Java 的业务 API 创建影像集并逐个导入 DICOM，建立正确的归属与共享权限。具体路径、参数和 CSRF 要求见仓库接口交接文档；不要只向 Orthanc 直接上传后期待自动生成业务影像集。

启动后访问统一入口 `http://127.0.0.1:8080/`，注册或登录后导入自己的测试数据。旧的公共 CT 编号不再随源码分发；如另行开发公共数据初始化，应同时调整清单校验逻辑，不能直接打开历史 seed 开关。

## 目录

- `src/main/java/`：认证、影像归属、共享、DICOMweb、分割发布与导出接口。
- `src/main/resources/`：配置和保留的原版演示页面。
- `src/test/`：认证、访问控制、DICOMweb 范围与分割授权测试。
- `python/`：DICOM SEG 编解码器及依赖版本。

Orthanc 的访问由 Java 后端代理；当前服务实现面向受限内部 Orthanc 地址。浏览器应通过统一入口访问业务接口。
