> 源码归档说明：本文保留原实现的功能、接口与历史验证说明。新电脑启动请以仓库根目录 `deploy/README.md` 为准；`legacy-local-*` 表示未随源码分发的原本机运行工具/验证材料，原公共 CT 与实际验证记录不在包内。

# Portal / OHIF 实际服务器接入

统一入口仍是 `http://127.0.0.1:8080/home`。登录和注册沿用 Keycloak 的 Portal 主题。

2026-11-01 已在正式 WSL Java / 8080 统一入口启用并验证。原公共 CT 的 139 张和 60 张清单保留；部署验证没有发布测试掩码，临时测试账号已删除。核验记录在同目录 `deployment-verification.json`。

在首页选中影像集，点击原来的“打开工作界面”。单个 CT 序列直接进入 OHIF；包含多个 CT 序列时先选择序列。工作台地址由部署生成，业务数据集编号与 DICOM Study/Series UID 分开处理。

## 使用

1. 首次进入 OHIF，点击“确认并隐藏”收起它原有的研究用途说明。
2. 右侧选择画笔，在 CT 上绘制；鼠标滚轮切换切片。
3. 右侧“添加分割区域”可以添加多个器官标签。每序列使用一个分割，在其中添加标签；同一个像素只能属于一个标签。
4. 绘制后自动保存到浏览器 IndexedDB，底部显示本机草稿状态；刷新会恢复。也可点击“保存本机草稿”。
5. 点击“保存并发布 / 重试发布”，Java 将完整标签图编码为 Labelmap SEG，存入 Orthanc 并登记发布版本。有影像集权限的账户可读取。
6. “导出 Labelmap SEG”下载当前绘制内容的 `.dcm` 文件。Java 临时执行编码，随后清理临时文件，不创建服务器草稿，也不发布到 Orthanc。
7. “加载共享版本”读取 Orthanc 中最新的成品。若有本地修改，会先提示确认替换，建议先导出保留副本。

底部“保存与同步”默认收起为小条，点击“展开”可使用保存、发布、导出和加载按钮，并查看实际登录用户。浏览器会记住展开/收起偏好；收起时仍显示保存状态、共享更新和错误入口。公共 CT 对所有登录用户开放；私人影像集沿用现有所有者/共享成员规则。角色框架保留，当前没有新增角色权限。

无本机修改的工作台每 15 秒检查共享版本并加载更新；存在本机草稿时只提示新版本，避免覆盖。两人从同一旧版本发布时，后者收到 HTTP 409，保留本机草稿，由用户决定如何重画。当前没有自动合并、实时共同画笔或编辑租约。

浏览器草稿按 Keycloak issuer + subject + datasetId + CT seriesId 隔离，并使用 IndexedDB 事务版本检查防止两个标签页互相覆盖。OHIF 的草稿键使用 `:ohif-labelmap` 后缀；原极简绘制器的单标签本地草稿可复制升级，原记录保留。旧 Java 草稿仍可通过 `/annotation-demo` 完成原有迁移。

同一浏览器不同标签页共享登录 Cookie；同时使用两个账户，请用两个浏览器或独立浏览器配置。IndexedDB 按站点来源隔离，`127.0.0.1:8080` 与预览端口的草稿不互通。

## 数据流与格式

- CT：OHIF → 同源 Java DICOMweb → Orthanc DICOMweb。原始 DICOM 元数据和帧像素参与渲染，工作台不请求 PNG 预览。
- 草稿：OHIF Labelmap → 本机 IndexedDB；不调用 Java 草稿保存接口。
- 发布：完整多标签 JSON 快照 → Java 校验权限、CT 成员和版本 → highdicom 编码 → Orthanc → 读回核对像素 → Java 记录发布元数据。
- 成品读取：Java 根据发布登记从 Orthanc 解码 Labelmap，浏览器恢复成可编辑标签图。成品像素不在 Java 数据库中另存一份。
- 导出与新发布：Labelmap Segmentation Storage，SOP Class UID `1.2.840.10008.5.1.4.1.1.66.7`，`SegmentationType=LABELMAP`，8-bit 整数标签值，Explicit VR Little Endian。保留标签名称、颜色、源 CT 引用和空间坐标。旧 Binary SEG 继续可读。
- 三维显示由浏览器根据 CT/掩码生成，当前没有单独存储 STL/OBJ 的接口。

## 新接口

所有 `/api/datasets/{datasetId}/...` 路由都检查当前 Cookie 登录和数据集权限。POST 先获取 `/api/session`，核对 issuer/subject，使用响应中的 `csrfHeaderName` 和 `csrfToken`。

OHIF 写请求还携带 `X-Medcollab-Issuer`、`X-Medcollab-Subject`，Java 会与当前会话核对，避免其他标签页切换账户后误发布原账户的草稿。

| 方法 | 路径（省略 `/api/datasets/{datasetId}`） | 用途 |
| --- | --- | --- |
| GET | `/workspace` | 真实序列清单，包含业务序列 ID、Study/Series/FrameOfReference UID 和切片数 |
| GET | `/dicomweb/studies` | 当前影像集的 QIDO studies |
| GET | `/dicomweb/studies/{study}/series` | 当前影像集的 QIDO series |
| GET | `/dicomweb/studies/{study}/series/{series}/instances` | 当前影像集的 QIDO instances |
| GET | `/dicomweb/studies/{study}/metadata` | 当前影像集的 study metadata |
| GET | `/dicomweb/studies/{study}/series/{series}/metadata` | 仅返回获授权切片的 metadata |
| GET | `/dicomweb/studies/{study}/series/{series}/instances/{sop}/metadata` | 指定实例 metadata |
| GET | `/dicomweb/studies/{study}/series/{series}/instances/{sop}` | WADO-RS 指定 DICOM 实例 |
| GET | `/dicomweb/studies/{study}/series/{series}/instances/{sop}/frames/1` | 单帧 CT 像素，保留 multipart 响应 |
| GET | `/dicomweb/studies/{study}/series/{series}/instances/{sop}/bulk/{tagPath}` | 获授权实例的受限 BulkData，地址不会直连 Orthanc |
| GET | `/segmentations/{seriesId}/labelmap` | `{status,data}`，状态和成品标签图 |
| POST | `/segmentations/{seriesId}/publish-labelmap` | 发布新版本，返回 Status |
| POST | `/segmentations/{seriesId}/export-labelmap` | 临时编码并下载 `.dcm`，不发布 |
| GET | `/segmentations/{seriesId}/status` | 沿用现有发布版本检查 |
| GET | `/segmentations/{seriesId}/file` | 下载已发布的 DICOM SEG |

`seriesId` 是 Orthanc 的内部系列 ID；DICOMweb URL 内 `series` 是 DICOM SeriesInstanceUID，不能混用。

Labelmap 请求示例（游程为 `[起点,长度,标签号,...]`，背景为 0，不上传背景游程）：

```json
{
  "expectedPublishedVersion": 0,
  "publicationId": "e3676cc6-0a4d-4d07-9d5e-0913bbf1a906",
  "label": "医学标注",
  "data": {
    "segments": [{"number": 1, "label": "心脏", "color": [255,80,80]}],
    "masks": [{"instanceId": "源CT的Orthanc实例ID", "runs": [512,20,1]}]
  }
}
```

请求是完整快照，未列出的切片视为全背景。允许发布全空掩码来清除已有成品，但首次发布至少有一个非零像素。发布请求编号必须持久化在本机草稿，网络中断后使用同一内容/编号重试；不要在结果不明时重新生成编号。

QIDO 支持 OHIF 使用的精确 UID/Modality 过滤以及 limit/offset。元数据和计数按数据集精确成员过滤；同一 DICOM series 的其他未授权切片不会因 UID 相同而被开放。当前入口只处理普通单帧 CT，最多 2048 张切片，体素及 JSON 大小仍受演示环境限制，最多 64 个标签，编号 1–255。它是当前 OHIF 数据源所需的受限 DICOMweb 接口，不是任意 PACS 的通用读写代理；STOW 和外部 SEG 文件注册未开放。

箭头、测量、RTSTRUCT、SR、重叠标签图层和自动合并不在本次保存范围。不要将工作台中的测量当成已经发布。

## 构建和部署

OHIF 源码：`frontends/ohif`。

使用现有环境脚本，设置 `APP_CONFIG=config/medcollab-server.js`、`PUBLIC_URL=/imaging/` 后执行 `pnpm build`。Java 使用已有 JDK 25 / Maven 构建。统一入口托管 OHIF `/imaging/`，Portal 的 runtime workspacePath 为 `/workspace`，原 5173/3000 预览不作为真实业务入口。

升级脚本：同目录的 `启用OHIF工作台.cmd`。升级会重启 Java 和统一入口，需要重新登录；原账号、CT、共享关系和已发布版本保留。之后继续使用桌面原有 01 或 14 启动。

所有源文件、临时编码目录、测试数据库、浏览器文件和构建证据在 D 盘。升级前源码备份：`legacy-local-task\work\ohif-integration\before`。

验证：41 项 Java 测试通过，9 项真实 DICOM 编解码检查通过，真实 Keycloak/Orthanc 的浏览器端到端流程通过，WSL 正式环境读取与临时导出通过。OHIF 生产构建通过，保留原工程的体积警告。仓库整体 TypeScript 检查仍存在大量其他模块的既有类型问题；新增 DatasetWorkspace/DatasetBar/接入测试没有诊断，原 medcollab mode 的包类型解析问题仍在。本次未扩展处理整个 OHIF 仓库的历史类型债务。
