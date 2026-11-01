# OHIF 包清单与能力/所有权矩阵

> 团队仓库归档副本。本机运行日志、临时截图及备份不随源码提交；相关证据引用以文字保留。原电脑路径仅说明历史验证环境。


日期：2026-10-31。主报告：[源码审计](./ohif-source-audit-2026-10-31.zh-CN.md)。  
对象仅为本机 `C:\Users\35775\Desktop\Viewers-3.13.13`。本轮全部只读、未运行测试或服务；依赖表不是穷尽 SBOM。

## 1. 清点口径

实际读取 `extensions/*/package.json`、`modes/*/package.json`、入口源码及 `platform/app/pluginConfig.json`：

- **14 个扩展包、9 个模式包，全部自报 3.13.13 / MIT**。这个声明不覆盖其全部依赖/模型/WASM，也不证明来源 tag。
- **A**＝pluginConfig 默认入口自动登记；**D**＝配置已声明，但 `default:false` 不进默认入口，可由模式/配置按需加载。D 不是“不存在/不能启用”。当前用户页面实际注册了哪些模块，本轮没有查询。
- 本包 A 扩展 3 个，A 模式 7 个；生成的 pluginImports.js:11（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/platform/app/src/pluginImports.js:11`） 与此一致，loader 还包含全部已声明模块。
- pluginConfig 中的部分 `version:"3.0.0"` 为描述字段，不是构建依赖选择器；真实声明/安装为 3.13.13 和下述固定依赖。
- 重要共同 peer：React/React DOM 18.3.1、OHIF workspace 包；医学扩展常用 dcmjs 0.52.0、dicom-parser 1.8.21。表内仅突出职责相关差异。

## 2. 全部 extensions

| 目录 | packageName / 版本 | 默认入口 | 主要职责与源码 | 重要依赖及边界 |
|---|---|---|---|---|
| extensions/default | @ohif/extension-default · 3.13.13 | A | 数据源、SOP stack、布局、StudyBrowser、HP、通用命令/customization；[入口:48](../../../extensions/default/src/index.ts#L48) | dicomweb-client、dcmjs peers；SUV 计算包 1.1.0；它不是 PACS/云存储服务端 |
| extensions/cornerstone | @ohif/extension-cornerstone · 3.13.13 | A | 医学视口、工具/面板、cache/segmentation/viewport/tool/sync services；[入口:210](../../../extensions/cornerstone/src/index.tsx#L210) | CS core/tools/adapters/ai/metadata/labelmap-interpolation/polyseg 均 5.6.8；vtk36.4.1；ICR WASM0.4.0；ITK interpolation1.1.0。算法不等于临床已验证，AI 权重另算许可 |
| extensions/measurement-tracking | @ohif/extension-measurement-tracking · 3.13.13 | D | 跨序列测量追踪、提示/状态机、测量面板，与 SR 协作；[入口:21](../../../extensions/measurement-tracking/src/index.tsx#L21) | xstate4.38.3、@xstate/react3.2.2、CS/SR peers；不是团队任务/审核服务器 |
| extensions/cornerstone-dicom-sr | @ohif/extension-cornerstone-dicom-sr · 3.13.13 | D | SR SOP、文本/测量 hydration、生成与存储支持工具的测量报告；[入口:34](../../../extensions/cornerstone-dicom-sr/src/index.tsx#L34) | CS adapters/core/tools5.6.8、dcmjs；任意 SR 类型的无损编辑未证明 |
| extensions/cornerstone-dicom-seg | @ohif/extension-cornerstone-dicom-seg · 3.13.13 | D | SEG 加载/hydration、生成/下载/STOW，含 RTSS 生成命令；[入口:31](../../../extensions/cornerstone-dicom-seg/src/index.tsx#L31) | CS adapters/core5.6.8、vtk36.4.1；重叠/私有层/帧引用详见主报告 F1 |
| extensions/cornerstone-dicom-pmap | @ohif/extension-cornerstone-dicom-pmap · 3.13.13 | D | Parametric Map SOP/视口；不是常规 segment labelmap 同义词；[入口:22](../../../extensions/cornerstone-dicom-pmap/src/index.tsx#L22) | adapters/core5.6.8、vtk36.4.1；参数图物理值与颜色映射需独立验证 |
| extensions/cornerstone-dicom-rt | @ohif/extension-cornerstone-dicom-rt · 3.13.13 | D | RTSTRUCT 载入、轮廓表示/hydration、RT SOP 视口；[入口:28](../../../extensions/cornerstone-dicom-rt/src/index.tsx#L28) | 依赖 Cornerstone/OHIF peers；不能据此称完整放疗计划/剂量优化系统 |
| extensions/cornerstone-dynamic-volume | @ohif/extension-cornerstone-dynamic-volume · 3.13.13 | D | 动态体/时间点、面板和 HP；[入口:23](../../../extensions/cornerstone-dynamic-volume/src/index.ts#L23) | CS core/tools5.6.8；4D 数据显示能力，不是所有动态模态/定量已验收 |
| extensions/dicom-microscopy | @ohif/extension-dicom-microscopy · 3.13.13 | D | SM/WSI、显微视口和工具；[入口:37](../../../extensions/dicom-microscopy/src/index.tsx#L37) | dicom-microscopy-viewer0.48.6（MIT）、mathjs12.4.3、codecs；与体积 CT 分割不是同一工作流 |
| extensions/dicom-pdf | @ohif/extension-dicom-pdf · 3.13.13 | D | 封装 PDF/受支持文档读取与 MIME/签名/嵌入策略；[handler:13](../../../extensions/dicom-pdf/src/getSopClassHandlerModule.js#L13) | core/dcmjs peers；已核对防护代码，不声明整系统无漏洞 |
| extensions/dicom-video | @ohif/extension-dicom-video · 3.13.13 | D | DICOM video SOP 和对应媒体显示；[入口:13](../../../extensions/dicom-video/src/index.tsx#L13) | core/dcmjs/dicom-parser peers；视频浏览不等于时序分割/Cine 全功能编辑 |
| extensions/tmtv | @ohif/extension-tmtv · 3.13.13 | D | PET/CT ROI 阈值、总代谢肿瘤体积、相关命令/报告/HP；[入口:18](../../../extensions/tmtv/src/index.tsx#L18) | Cornerstone/core/dcmjs peers；依赖 SUV、影像与阈值协议正确，不是自动诊断证据 |
| extensions/test-extension | @ohif/extension-test · 3.13.13 | D | 测试专用面板、HP、customization；[入口:32](../../../extensions/test-extension/src/index.tsx#L32) | core/UI/React peers；不应当作已承诺业务能力 |
| extensions/usAnnotation | @ohif/extension-ultrasound-pleura-bline · 3.13.13 | A | 胸膜/B-line 标注面板与命令；[入口:20](../../../extensions/usAnnotation/src/index.ts#L20) | CS core/tools5.6.8、ui-next；专用超声标注，不是全超声 AI 平台 |

扩展都是本地前端包。表内 CS/vtk/ONNX 是底层库，DICOMweb/IdP 是外部服务，Hugging Face 是可选模型下载目的地；不能混称为“同一云平台插件”。

## 3. 全部 modes

全部版本 3.13.13，许可声明 MIT。源入口均列于表内。

| 目录 | packageName | 默认入口 | routeName / 职责 | 主要组合与源码 |
|---|---|---|---|---|
| modes/basic | @ohif/mode-basic | A | `basic` / Non-Longitudinal Basic | 基础阅片、工具、SEG/RT/SR 等依赖组合；[mode:315](../../../modes/basic/src/index.tsx#L315)。不等于编辑分割模式或服务器 readonly |
| modes/longitudinal | @ohif/mode-longitudinal | A | `viewer` / Basic Viewer | 继承 basic，增加 measurement-tracking，支持追踪/比较工作流；[mode:63](../../../modes/longitudinal/src/index.ts#L63) |
| modes/segmentation | @ohif/mode-segmentation | A | `segmentation` / 标签及轮廓制作 | 继承 basic、独立分割工具组/标签和轮廓 panel；[mode:69](../../../modes/segmentation/src/index.tsx#L69) |
| modes/tmtv | @ohif/mode-tmtv | A | `tmtv` / Total Metabolic Tumor Volume | PET+CT、tracking、TMTV，模式含具体模态/排除规则；[mode:154](../../../modes/tmtv/src/index.ts#L154) |
| modes/microscopy | @ohif/mode-microscopy | A | `microscopy` / WSI | default+dicom-microscopy；[mode:40](../../../modes/microscopy/src/index.tsx#L40) |
| modes/preclinical-4d | @ohif/mode-preclinical-4d | A | `dynamic-volume` / Preclinical 4D | cornerstone/dynamic-volume/SEG/default/TMTV；[mode:35](../../../modes/preclinical-4d/src/index.tsx#L35)，不能仅凭名字保证临床 4D |
| modes/usAnnotation | @ohif/mode-ultrasound-pleura-bline | A | `usAnnotation` / 胸膜 B-line | CS、US annotation、SR；[mode:82](../../../modes/usAnnotation/src/index.ts#L82) |
| modes/basic-test-mode | @ohif/mode-test | D | `basic-test` / 自动测试模式 | basic、tracking、test-extension 等；[mode:200](../../../modes/basic-test-mode/src/index.ts#L200) |
| modes/basic-dev-mode | @ohif/mode-basic-dev-mode | D | `dev` / 开发模式 | 工具/布局开发组合，default/CS/SR/PDF/video；[mode:47](../../../modes/basic-dev-mode/src/index.ts#L47) |

模式包不是影像引擎、后端或临床产品认证；`isValidMode` 的模态检查不等于数据质量验证。

## 4. 复用/配置/扩展/后端/独立产品能力

| 需求 | 现成可复用 | 仅配置/模式组合 | 自有扩展可承载 | 外部后端 | 独立产品/验证能力 |
|---|---|---|---|---|---|
| CT/MRI 二维、MPR、基础测量 | 原生 viewport/tools/HP | 数据源、布局、模态与工具范围 | 机构 SOP/质量提示/字段 | PACS/DICOMweb 可选 | 病种/测量协议和准确性验收 |
| 单部位分割制作 | segmentation mode、labelmap/contour、undo | 工具组、标签/编码偏好、面板 | 标签规范、交付前检查、院内 API | 若需远端保存则必须 | F1/几何/独立重开/数据质量 |
| 体渲染与分割 surface | 原生两条路径 | 预设、质量、视口数量、后端 lane | 受控面板/导出适配 | 大规模转换/存储可外置 | 表面拓扑/误差/单位交付规则 |
| SEG/RTSTRUCT/SR/CSV | 原生命令、adapters、store 接口 | 目标源、SEG mode/transfer syntax | 特定元数据、导出前后检查 | STOW/索引/备份 | 接收端兼容与往返完整性 |
| STL/OBJ | 本轮未找到成品导出链 | 不能只开配置就宣称有 | 可做薄导出扩展 | 或使用现成转换服务 | 网格单位/来源/FoR/几何验证 |
| 整体工程保存恢复 | DICOM derived reports 可复用 | 非“开个开关即可” | 快照/恢复 UI 与 API 适配 | 版本对象、事务/备份、恢复 | 工程 schema、引用/算法版本治理 |
| 用户登录 | OIDC/PrivateRoute/token headers | IdP 参数 | 宿主接口适配 | IdP/网关 | 安全与隐私方案 |
| 机构/病例授权 | UI 可配 | UI 仅反映权限 | 宿主授权信息呈现 | 必须服务端 enforcement | 数据隔离/共享/监管要求 |
| 锁/多人冲突 | 本地 segment lock 仅复用交互 | 无云写锁开关 | 获取/释放锁及冲突 UI | 租约、CAS、身份、写入授权 | 冲突与离线恢复策略 |
| 定位评论/审核 | annotation/坐标、面板/命令 | 有限的 UI 工作流组合 | 评论/审核面板、版本定位 | 评论、不可变提交、审计、通知 | 角色/审核协议、责任与验收 |
| 多病例科研统计 | 每病例量化/CSV、TMTV | 部分单位/工具配置 | 数据提取适配 | 科研数据管理/统计系统 | 纳排、统计协议、重复测量与溯源 |
| 截骨、植入物/导板设计、真实手术规划 | 不在本轮证明范围 | 不能把 3D 预设当模拟手术 | 只可作受控集成入口 | 可能接现成规划/CAD 系统 | 独立领域功能、精度、质量与目标用途评估 |

**路线含义**：先保留完整 OHIF 原生应用，通过 fork 固定版本与部署配置；优先扩展/继承模式和现有命令，不默认自造影像工作台。需后端之处先选现成系统/院内接口，报告不决定全部自研。

## 5. 依赖与外部生态边界

- 本包的前端扩展/mode 均声明 MIT，但 Shepherd 15.3.0 运行依赖声明 AGPL/Commercial 双许可，详见主报告 F4。
- vtk BSD-3-Clause、ITK 插值 Apache-2.0、OIDC Apache-2.0、模型权重和影像素材许可要分别处理；不存在一个 root MIT 就覆盖全栈的结论。
- `.recipes` 中 Orthanc/dcm4chee/Keycloak 是外部服务部署参考，不是随前端源码自动获得的病例授权、审核/审计和备份服务。
- 本包未清点到 MONAI Label、XNAT 集成、NiiVue 第三方插件作为上述 14 个扩展的一部分。不等于生态不存在，外部兼容性/商业服务由审查官另表核实。
- 插件名称中的 v3、插件自身版本、OHIF app 版本和 Cornerstone peer 范围不是同一维度；外部插件必须针对本机 CS5.6.8/React18.3.1/OHIF API 做源级兼容核查，不能仅看 npm latest。

本轮未安装外部插件、未替换依赖、未联系厂商，不恢复业务开发。
