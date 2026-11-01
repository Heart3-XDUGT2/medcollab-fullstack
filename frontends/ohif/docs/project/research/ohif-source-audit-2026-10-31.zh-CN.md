# OHIF 本地源码审计

> 团队仓库归档副本。本机运行日志、临时截图及备份不随源码提交；相关证据引用以文字保留。原电脑路径仅说明历史验证环境。


日期：2026-10-31（Asia/Shanghai）  
对象：`C:\Users\35775\Desktop\Viewers-3.13.13`；交付目录不在 OHIF 源码内。  
附表：[扩展、模式与能力/所有权矩阵](./ohif-capability-inventory-2026-10-31.zh-CN.md)。

**边界**：本轮只读源码、包清单、已安装依赖代码和现有测试文本；未写测试，未运行构建、测试、漏洞扫描或性能采样，未请求本地 3000 服务、刷新浏览器、修改依赖/配置/锁文件、启动或停止服务。此前自造工作台保持停工，其测试结果不作为 OHIF 的验证证据。

证据标记：**C**＝本机代码确认；**T**＝仓库存在相关测试且本轮静态阅读，**不是本轮运行通过**；**U**＝未实测或仍待验证。外部公告/issue 信息由审查官提供，本轮只核对本机代码，不代替其外部调研。此审计为有边界的系统性抽查，不保证穷尽全部代码、依赖、漏洞或临床风险。

## 1. 审查发现

未确认阻断原版日常试用的 P0 问题，也未确认一个已可利用的、当前未修 P1 安全漏洞。下面的 P1 指**特定分割导出路径的数据完整性优先级**，不是“OHIF 整体不可用”或临床事故已发生。

### F1 · P1 · 私有 labelmap 的局部标签值未在 SEG 导出中恢复全局 segment 编号

**触发条件**：分割含私有标签层，某个全局 segment 的局部 `labelValue` 不等于其 `segmentIndex`；例如 segment 2 的私有层以值 1 存储。该状态不是凭空构造的非法模型：本机 Cornerstone 编辑事务可以在保护其他 segment、需要分离存储时生成它。

**证据链（C）**：

1. privateLabelmap.js:56（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/tools/dist/esm/stateManagement/segmentation/labelmapModel/privateLabelmap.js:56`） 的 `moveSegmentToPrivateLabelmap` 创建独立层；第 79、105 行把目标体素写为 **1**，第 119–123 行将全局 segment 绑定为 `{labelmapId, labelValue: 1}`。
2. labelmapEditTransaction.js:73（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/tools/dist/esm/stateManagement/segmentation/labelmapModel/labelmapEditTransaction.js:73`） 在保护其他标签并遇到冲突时调用上述移动；不是所有画笔操作都会触发。overwrite 策略、锁和实际编辑路径影响可达条件。
3. [SEG commandsModule.ts:132](../../../extensions/cornerstone-dicom-seg/src/commandsModule.ts#L132) 直接读取 `segImage.getPixelData()`，按原像素值填 `segmentsOnLabelmap`；第 194 行的 metadata 按**全局** `segmentIndex` 编号。第 242 行对各层调用同一 builder，未传该层绑定或进行 `labelValue → segmentIndex` 转换。
4. Segmentation_4X.js:121（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/adapters/dist/esm/adapters/Cornerstone/Segmentation_4X.js:121`） 用输入的 segment 值索引 metadata，第 172 行将该编号交给 DICOM 写入。因此上例中的局部值 1 会被当成全局 segment 1，而不是 2。

**影响**：可能导出结构完整但 segment 身份错误的 SEG；“重叠时自动改用 binary SEG”解决的是编码能否表示重叠，**不解决这个编号映射问题**。只有所有层的值都恰好等于全局 segment 编号时，当前假设才成立。

**验证状态**：静态数据流确认，**未在用户页面执行绘制/导出，也未用独立 DICOM 解析器复现成品文件**。不能宣称用户当前数据已经损坏。仓库的 [重叠渲染测试:16](../../../tests/OverlappingSegmentationRendering.spec.ts#L16) 验证画面而非这条私有层导出往返，不足以排除此风险。

**决策建议**：在该条件下的 SEG 交付通过独立往返验证前，不将其用于可靠科研量化交付或术前工程交接。优先核对上游相关修复的实际差异与当前包，再决定稳定基线/补丁；不要现场改 `node_modules`。未来验证应逐 segment 比较掩膜、标签名、颜色、源 SOP/frame 引用，而不是只看“保存成功”或导出文件能打开。已知 issue #6349/#6352 只能作外部对照，本结论来自本机调用链，不是由 issue 版本号推导。

### F2 · P2 · 取消一个服务订阅会取消同事件其他订阅者的待执行防抖

- **位置**：[pubSubServiceInterface.ts:57](../../../platform/core/src/services/_shared/pubSubServiceInterface.ts#L57)。
- **触发条件**：同事件存在尚未执行的 debounced 回调；另一个订阅被取消。
- **代码行为（C）**：`listeners.filter` 内对**每个** callback 调用 `clearDebounceTimeout`，之后才以 `id !== listenerId` 决定保留谁。保留下来的订阅者，其待执行工作也已经被取消。
- **交叉证据**：[debounce.js:26](../../../platform/core/src/utils/debounce.js#L26) 明确清除 timeout；[segmentationHandlers.ts:18](../../../extensions/cornerstone/src/utils/segmentationHandlers.ts#L18) 实际用此防抖机制更新分割统计，等待为 1000 ms。
- **影响**：某次统计/UI 派生更新可能丢失，直到后续事件重新触发；不是永久失去订阅，也不能据此认定体素数据被删除。
- **验证状态**：静态控制流确认；本轮未运行双订阅回归，未确认用户三维高 CPU 与之有关。
- **建议**：后续经授权补“取消 A 不影响 B 的 pending callback”回归，按上游修复优先处理；本轮不修改。

### F3 · P3 · 重建工具函数没有返回已累计的缺帧数量，不等于界面漏掉缺帧警示

- **位置**：[isDisplaySetReconstructable.js:149](../../../platform/core/src/utils/isDisplaySetReconstructable.js#L149)。
- **触发条件**：单帧序列的间距检查进入 `MISSING_FRAMES` 分支。
- **代码行为（C）**：第 183 行累加 `missingFrames`，但第 193 行只返回 `{value: true, averageSpacingBetweenFrames}`，不返回缺帧计数，与函数内“返回缺帧数量”的注释不一致。当前 [SOP handler:84](../../../extensions/default/src/getSopClassHandlerModule.js#L84) 也没有将该计数挂到 display set 上；约第 151 行的旧 `imageSet.missingFrames` 分支是注释，不是运行路径。
- **静态例子**：同尺寸/同 IOP 的层位置 `z=[0,1,2,3,4,5,7,8,9,10,11,12]`，均值为 `12/11`；20% 容差下普通间距被接受，2 的间距可走缺帧分支，计数随后没有输出。这是按公式推演，**没有运行测试**。
- **其他边界**：多帧分支第 117 行仍留有间距一致性 TODO；第 244 行名为 perpendicular distance 的函数实际算欧氏距离，而非沿切片法向的投影。后续 Cornerstone 还有自己的体积构造检查，不能据此直接断言最终渲染/测量必然错误。
- **已有独立警示（C）**：[getDisplaySetMessages.ts:47](../../../extensions/default/src/getDisplaySetMessages.ts#L47) 仍调用单帧检查；[checkSingleFrames.ts:34](../../../extensions/default/src/utils/validations/checkSingleFrames.ts#L34) 调用间距检查，[areAllImageSpacingEqual.ts:53](../../../extensions/default/src/utils/validations/areAllImageSpacingEqual.ts#L53) 可以独立添加 `MISSING_FRAMES` 消息。因此不能从计数未返回推导“用户完全收不到缺帧警示”。此项仅列工具函数返回信息/注释契约的问题，不列为已证实的错误重建。
- **影响/建议**：依赖该工具函数获取精确缺帧数量的集成拿不到该字段；当前数量字段未进入 UI，不夸大其实际影响。`isReconstructable=true` 仍不是原扫描完整或术前精度证明。后续以源清单、IPP/IOP/PixelSpacing、重复/缺层和倾斜数据验收原生链路；必要质量提示优先扩展/上游处理，不另造几何引擎。

### F4 · 发行前许可门槛 · OHIF MIT 不代表所有运行依赖均 MIT

**C**：本机 `shepherd.js` 为 **15.3.0**，package.json:16（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/shepherd.js/package.json:16`） 标 `AGPL-3.0`，LICENSE.md:3（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/shepherd.js/LICENSE.md:3`） 自述 AGPL/Commercial 双许可。

不是只存在一个未使用的开发包：[Onboarding.tsx:2](../../../platform/ui-next/src/components/Onboarding/Onboarding.tsx#L2) 运行时导入 Shepherd，[ViewerLayout:220](../../../extensions/default/src/ViewerLayout/index.tsx#L220) 使用 Onboarding。

闭源、商用、网络提供、再分发及既有授权需要结合实际集成由合适人员核实。**不据此直接断言整个产品必须 AGPL、商用违法或必须购买**；AGPL 本身也不等于禁止商用。本轮不购买、联系厂商、移除或替换依赖。WASM、模型权重及其他依赖许可仍需单独清点，见附表。

### 已核对、不列为当前未修漏洞：Encapsulated PDF 公告

审查官提供 [GHSA-xwgp-w3pj-q5h3 / CVE-2026-118670](https://github.com/OHIF/Viewers/security/advisories/GHSA-xwgp-w3pj-q5h3)，涉及不可信封装文档 MIME 导致 DOM XSS；外部公告的修复 npm 版本含 3.13.10，源码 tag 门槛另算，不能混为一个版本表。

本机 PDF 扩展声明 3.13.13，且**确实读到了防护代码**，不是只凭版本超出就宣布修复：

- [displayableDocumentTypes.ts:60](../../../extensions/dicom-pdf/src/utils/displayableDocumentTypes.ts#L60)：类型 allowlist；PDF 有签名检查，HTML/XML 等走空 sandbox 的 iframe。
- [loadDisplayableDocument.ts:89](../../../extensions/dicom-pdf/src/utils/loadDisplayableDocument.ts#L89)：验证签名，并强制使用规范 MIME 创建 Blob，而非信任来源服务器 Content-Type。
- [PDF viewport:126](../../../extensions/dicom-pdf/src/viewports/OHIFCornerstonePdfViewport.tsx#L126)：object/iframe 分流；第 87 行清理 Object URL。仓库有两个相关工具测试文件（T），本轮未运行。

没有打开恶意文件或构造利用样本。结论仅为“本机存在针对该类问题的防护路径”，不是 PDF 解析器或整系统安全证明。

## 2. 来源身份与依赖基线

| 项目 | 本机观察（C） | 不能据此推定 |
|---|---|---|
| 来源形态 | 目录无 `.git`；有源码、配置、测试、`.gitmodules`、已安装 node_modules，符合用户提供的 ZIP 工作目录 | 无法做 git status/diff/tag 验证，不能证明与官方某个 tag 逐字一致或没有下载前/安装后改动 |
| root/app/各扩展模式版本 | root `package.json:127`、app `package.json:3`、23 个扩展/模式清单均为 3.13.13 | 目录名、package 自报版本不能替代来源签名/上游 tag 核验 |
| commit.txt | `6dd150d401ad73d60632a23378b7dfd4b5142690` | 是文本标识，不是本轮验证过的 git HEAD |
| version.json | `3.13.0-beta.89`，commit 文本与上项相同；version.txt 为 3.13.13 | 元数据不一致，未自行修；构建的 VERSION_NUMBER 从 version.txt 读，不能说 UI 必然显示 beta.89 |
| 包管理/运行时 | packageManager=`pnpm@12.8.1`，engines Node≥24/pnpm≥12；本轮只读 Node 命令为 v24.21.0；`.node-version` 为 24.15.0 | 未执行 pnpm 安装/升级或重新验证全新机器安装 |
| 构建 | app 的普通 dev/build 使用 Rspack；`dev:fast` 使用 RSBuild。AGENTS 中 Yarn/Webpack 5/模块联邦的描述不全适用 | 自动生成 dynamic import/resolve alias 不等于已启用运行时 Module Federation |
| lock | root pnpm-lock.yaml 有 **2 个 YAML 文档**：第一个是 pnpm 自举依赖，第二个是 31 importer、2570 package 的工作区图；已安装 `.pnpm/lock.yaml` 与第二文档解析后语义相等 | 单文档 YAML 解析器会报 multiple documents，不能误判成坏锁文件或“只锁 pnpm 未锁应用” |

实际安装与声明重点版本：

| 依赖 | 本机版本/许可声明 |
|---|---|
| Cornerstone core/tools/adapters/metadata/dicom-image-loader/ai/polymorphic-segmentation/labelmap-interpolation | 5.6.8 / MIT |
| vtk.js | 36.4.1 / BSD-3-Clause |
| dcmjs / dicomweb-client / dicom-microscopy-viewer | 0.52.0 / 0.10.4 / 0.48.6，均声明 MIT |
| React / React DOM | 18.3.1 / MIT |
| onnxruntime-web | 1.17.1 / MIT；模型权重不由此获许可 |
| @icr/polyseg-wasm / ITK-Wasm contour interpolation | 0.4.0 / MIT；1.1.0 / Apache-2.0；未穷尽 WASM 内第三方 NOTICE |
| OIDC clients | oidc-client 1.11.5、oidc-client-ts 3.3.0 / Apache-2.0 |
| Rspack / RSBuild | app 就近解析 @rspack/core=2.0.3，root 的同名包为 1.7.11；cli=2.0.3、dev-server=2.0.1；RSBuild=1.7.3。是不同上下文的解析结果，不直接视为损坏安装 |

未联网比较 npm tarball 完整性；“实际版本”指本机 manifest 和模块解析结果。`pnpm-workspace.yaml` 关于 Cornerstone 5.0.0 的注释不如实际 5.6.8 pin 可靠；pluginConfig 的若干 version=3.0.0 也不控制此解析。

记录指纹（SHA-256，未修改这些文件）：

| 文件 | 哈希 |
|---|---|
| root package.json | `3B6519AE4D9358F7C7333A3E411A7578D36AABC73852EAB4EC87759D8194E5B0` |
| root pnpm-lock.yaml | `58A97AB541D86D4135224EE449B65195DDB4A27099F767F85B19406759AB47FD` |
| pnpm-workspace.yaml | `E24E944DB7F57C93F030E9306EB6B5630A1EA84ED4E6669F61D9DEED57DC8150` |
| node_modules/.pnpm/lock.yaml | `3B73143B05FB6F71B1A1814454EE5B9FC801EDFB793EDFA1F3EF45C230172DA3` |
| platform/app/pluginConfig.json | `D0D7768E3524A309D653CCAF0D9C0D0F5FF3FC105190D2E05468CDDD03E02D5D` |

## 3. 架构地图与扩展所有权

```text
app-config.js/window.config
  → platform/app/src/index.js（可选动态配置）
  → appInit.js（服务、Commands/Extension/Provider managers）
  → pluginImports.js（由 pluginConfig 生成的已知模块动态导入）
  → extension 注册模块 + modeFactory
  → routes/Mode（模式依赖按需加载、布局、生命周期、数据源）
  → DisplaySet/SOP handler → Cornerstone viewport/cache/segmentation services
  → Cornerstone core/tools + vtk / adapters / codecs / Workers
  → 下载 DICOM 或 dataSource.store.dicom → 外部 DICOMweb STOW
```

| 层 | 职责/证据 | 建议所有权 |
|---|---|---|
| platform/app | React 启动、路由、OIDC 入口、Local 文件入口、构建与插件清单；[appInit:40](../../../platform/app/src/appInit.js#L40) | 保留原生；站点配置和部署边界受控修改，避免整壳重写 |
| platform/core | ServicesManager、CommandsManager、ExtensionManager、DisplaySet/Measurement/Customization/HP 等业务基础服务 | 保持上游兼容；确有通用缺陷优先提上游/最小补丁 |
| platform/ui 与 ui-next | 两代共享组件库并存，非两个独立 viewer；现有扩展仍混合依赖 | 扩展复用组件，不自行拼一套替代工作台 |
| platform/i18n | 本地 locale 和按环境启用的 Locize 路径；[i18n:47](../../../platform/i18n/src/index.js#L47) | 本地翻译/术语可扩展；不假设新功能中文覆盖完整 |
| extensions | SOP、viewport、panel、tool/command、dataSources、HP、customization 等模块；各包注册方式见附表 | 自有机构扩展承载差异化面板、命令、API 适配 |
| modes | 工作流组合、工具组、布局、依赖、有效性、生命周期；[segmentation mode:69](../../../modes/segmentation/src/index.tsx#L69) 从 basic 继承 | 首选继承/组合原生 mode，限制范围并配置工具，不复制其引擎 |
| 底层库 | Cornerstone 医学显示/交互/缓存；vtk 渲染；adapters/dcmjs 编解码；WASM/ONNX 算法 | 固定兼容闭包；不直接改 node_modules，不把库接口当成品特性 |
| 外部后端 | DICOMweb、IdP、存储/授权/审核/审计；仓库含 Orthanc/dcm4chee/Keycloak 的部署 recipes | 可选现成后端或院内接口；“需后端”不等于自动决定全部自研 |

**服务/命令**：`ServicesManager` 注册实例，`CommandsManager` 以 context 查找命令，允许扩展复用/覆盖；不是远程 RPC。`PubSubService` 是同页面事件及本机回调，[广播实现:82](../../../platform/core/src/services/_shared/pubSubServiceInterface.ts#L82) 不提供服务器消息总线。

**加载**：[writePluginImportsFile:28](../../../platform/app/.webpack/writePluginImportsFile.js#L28) 对 `default:false` 跳过的是默认入口列表；生成 loader 仍包含对应模块。[Mode.tsx:92](../../../platform/app/src/routes/Mode/Mode.tsx#L92) 根据 mode.extensions 按需导入。因此不能把“默认不注册”写成“未启用/不存在/打不进去”。编译期已声明插件可走 alias，外部 runtime import 则属于可信可执行配置边界。

**配置定制**：CustomizationService 有 bootstrap/global/mode 分层；本包 URL customization 默认读取受配置 prefix 允许的 JSONC/JSON5 **数据**，不是直接执行 JS，[解析实现:753](../../../platform/core/src/services/CustomizationService/CustomizationService.ts#L753)。模式继承、工具/面板/HP 组合和站点模块应先于改 core。

## 4. 真实病例闭环：已有路径与缺口

下表全部 **U：本轮未实测**；C/T 分别只表示代码/现有测试证据。

| 环节 | 本机代码能力（C） | 测试证据（T）/限制 |
|---|---|---|
| 本地导入 | [Local:82](../../../platform/app/src/routes/Local/Local.tsx#L82)、filesToStudies、DicomLocalDataSource，文件/文件夹进入 dicomlocal；不是上传到自造服务 | 本轮不导入文件；生产默认配置未登记 dicomlocal，dev 配置有 |
| 远端加载 | QIDO/WADO-URI/WADO-RS、静态 WADO、DICOMJSON/proxy、多帧/分 SOP；[DicomWeb:136](../../../extensions/default/src/DicomWebDataSource/index.ts#L136) | 要验证具体 PACS、编码、CORS/auth、缺帧/损坏；非通用“任意格式”承诺 |
| 几何与体积 | IPP/IOP 排序、PixelSpacing/体积 metadata、stack/streaming volume；reconstructable 判据有 F3 边界 | 有 sortInstancesByPosition 测试；未做真实斜切、倾斜机架、缺层或独立测量校准 |
| 二维/MPR/融合 | 原生 Stack/Volume，以及可选 Generic/next；HP 驱动布局、同步/十字定位；不是只有二维阅片器 | MPR、跳转、SEG/RT hydration 后转 MPR 等 specs；不是运行结果 |
| 标签与轮廓编辑 | segmentation mode、Brush/擦除/阈值/剪裁/填充、轮廓/Spline/Livewire 等工具；原生会话内 undo/redo、segment 显隐/锁 | 有 LabelMapSegLocking、Contour CRUD/锁等测试。锁不是跨用户租约；撤销不是服务器不可变版本 |
| 重叠 | next 组装 `labelmaps + segmentBindings`；[Next backend:83](../../../extensions/cornerstone/src/services/SegmentationService/backends/NextSegmentationBackend.ts#L83) | 默认 legacy 组装是单一 flattened 表示（[Legacy:101](../../../extensions/cornerstone/src/services/SegmentationService/backends/LegacySegmentationBackend.ts#L101)）；next 的非 volume-slice 视图也只显示主层并发 console 警告。需固定 lane/布局，不能笼统称全部场景重叠正确 |
| 体渲染 vs surface | vtk volume ray casting 与 segmentation Surface 是不同路径；3D 默认分割表示会选 Surface（[SegService:365](../../../extensions/cornerstone/src/services/SegmentationService/SegmentationService.ts#L365)）；polySeg 转换可走 Worker | 有 SEG hydration/3D specs，不等于表面网格几何精度或拓扑独立验收 |
| SEG 导出 | [SEG commands:95](../../../extensions/cornerstone-dicom-seg/src/commandsModule.ts#L95)，调用 adapters；默认 LABELMAP SEG `.66.7` + RLE，支持按数据源覆盖为 binary `.66.4`；重叠自动切 binary | F1 编号风险；源帧未缓存有显式抛错；不能承诺所有 PACS/Enhanced multiframe 编码兼容 |
| RTSTRUCT 导出 | 同一 commandsModule 的 generateContour/downloadRTSS/storeSegmentation(modality=RTSTRUCT) 调 adaptersRT | 不是仅 RTSTRUCT 导入；源 FoR/轮廓平面/多帧和颜色需外部工具重开验证 |
| SR/测量 | [SR commands:28](../../../extensions/cornerstone-dicom-sr/src/commandsModule.ts#L28) 生成支持工具的 SR，下载/存储；存在 hydration | SRHydration/SRHydrationThenReload；非任意 SR 内容均可编辑/无损往返的证明 |
| CSV/图片 | [commands:827](../../../extensions/cornerstone/src/commandsModule.ts#L827) 有 measurement/segmentation CSV；另有视口图片下载 | CSV 不等于多病例科研数据库；需单位、协议、缺失值和公式文本风险审查 |
| STL/OBJ | 对 app/core/extensions/modes 的实现源码搜索，未找到原生成品 STL/OBJ 写出命令/下载链 | 不能因 vtk 有 writer 就说 OHIF 已支持；可另做受控扩展/导出服务，仍不重造 viewer |

### 保存、恢复与失败判定

[createStoreFunction:784](../../../extensions/default/src/commandsModule.ts#L784) 分为下载/剪贴板/命名数据源。DICOMweb 分支最终 [await storeInstances:500](../../../extensions/default/src/DicomWebDataSource/index.ts#L500)，异常会向上抛出；[createReportAsync:28](../../../extensions/default/src/Actions/createReportAsync.tsx#L28) 会显示错误，不能说“完全没有失败处理”。

但要注意：

- 命名存储函数在 await 远端写入**前**就把 derived instance 注册到内存 metadata/cache（default commands 第 837–845 行附近）。若 STOW 失败，当前页面仍可能有生成结果；其存在不证明远端保存成功，也不是已验证的回滚/离线队列。
- dicomlocal 的 store 是 Blob 下载（[本地 store:181](../../../extensions/default/src/DicomLocalDataSource/index.js#L181)），不是工程数据库或浏览器自动草稿。
- MeasurementService 是内存 Map，模式退出会 clear；[MeasurementService:732](../../../platform/core/src/services/MeasurementService/MeasurementService.ts#L732) 和 [Cornerstone exit:171](../../../extensions/cornerstone/src/index.tsx#L171) 有明确状态/缓存清理。
- 重开已有 SEG/SR/RT 的 hydration 是原生成品能力；**未找到整个制作工程的自动落盘恢复、跨会话 undo、离线冲突合并或不可变审核提交实现**。个别 UI/preferences/model cache 的持久化不能替代它。
- 新 DICOM instance UID、predecessor 链有复用价值，但不是“每次保存自动不可变版本 + 审核人签署 + 机构权限”的完整保证。多份 SR/SEG 放同一 series 的展示/选择/重开要专门验收。

## 5. 3D 高 CPU 专项：事实与待 profile 假设

**尚未定位根因**。用户报告集中于 3D 交互；审查官此前短时 OS 采样未复现持续满载。本轮未新增采样，也不知道当前浏览器硬件加速、实际 viewport lane、显示设备、actor 数、数据大小、光照/采样质量和 dev 工具状态。不能用 React 19 的外部 issue 解释这里安装的 React 18.3.1。

### 已确认的链路（C）

```text
鼠标/触摸拖拽
  → TrackballRotateTool._dragCallback
  → rotateCamera（两轴变换）→ setViewportCamera / viewport.setCamera
  → camera modified 通知 + clipping range 更新 + render 请求
  → BaseRenderingEngine 的 Set + requestAnimationFrame 合并
  → 具体 Legacy/Generic Volume3D render path
  → vtk camera/uniform 更新、volume ray casting / surface actor 绘制
```

| 代码事实 | 含义与边界 |
|---|---|
| TrackballRotateTool:16（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/tools/dist/esm/tools/TrackballRotateTool.js:16`） 默认 rotateSampleDistanceFactor=2；mousedown 调 sampleDistance，document mouseup 恢复并 render | 已有交互降质，不应重复宣称“没有降采样”；它对默认 actor mapper 起作用，不保证所有 actor 都同步降质 |
| 同文件约 180–198 行一次拖拽调用两次 rotateCamera 并请求 render；VolumeViewport3D:107（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/VolumeViewport3D.js:107`） setCamera 也请求 render | 请求次数≠实际完整绘制次数；但 camera/事件/UI 工作不一定全部被引擎 rAF 合并 |
| BaseRenderingEngine:282（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/BaseRenderingEngine.js:282`） 用 Set 去重，第 294 行只安排一个 rAF | 不可建议“先加 rAF”却忽略现有合并；需要量实际 frames 和 handler 成本 |
| VTK Texture:47（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@kitware/vtk.js/Rendering/OpenGL/Texture.js:47`）、VolumeMapper:742（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@kitware/vtk.js/Rendering/OpenGL/VolumeMapper.js:742`） 有 mtime/资源句柄检查 | 没证据说每个 mousemove 都重解码/重传整卷或重新生成表面；首次上传、data modified、actor/mapper 变更仍可能有大成本 |
| [quality 配置:8](../../../extensions/cornerstone/src/customizations/volumeRenderingCustomization.ts#L8) 为 1–4；[Legacy quality:203](../../../extensions/cornerstone/src/services/ViewportService/backends/LegacyViewportOperations.ts#L203) 按质量平方缩小 sampleDistance | q=4 的步距约为 q=1 的 1/8；是射线采样量级关系，不是测得 CPU/FPS 倍数。该设置当前只取 actor[0] |
| core init:17（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/core/dist/esm/init.js:17`） 默认 ContextPool、webGlContextCount=7；OHIF 可选 legacy/兼容 generic/direct next | 这些是源码默认，不证明用户当前 session 后端；配置和 URL 可覆盖 |
| core init 识别 softwareRasterizer；CPU rendering 与软件 WebGL 是不同维度 | 高 CPU 不等于一定走 Cornerstone CPU fallback，也可能是软件光栅器执行 WebGL；本轮未读取 chrome://gpu |
| [orientation marker:25](../../../extensions/cornerstone/src/Viewport/Overlays/ViewportOrientationMarkers.tsx#L25) 监听 camera modified 并 setState；scale overlay 有 parallelScale 改变检查 | 存在需要 profile 的 JS/React 通知工作；不能仅凭监听器就量化其为瓶颈或断言每事件一次 React commit |
| [worker init:24](../../../extensions/cornerstone/src/initWADOImageLoader.js#L24) 按硬件并发和 app worker 上限取最小；polySeg Worker 上限 1 | 解码/表面转换可以在 Worker；不代表所有渲染或 metadata/统计都离开主线程 |
| cache:16（本机参考：`C:/Users/35775/Desktop/Viewers-3.13.13/node_modules/@cornerstonejs/core/dist/esm/cache/cache.js:16`） image cache 默认 3 GiB；OHIF init 可覆盖 | 不是整个浏览器内存上限；压缩 Part10 registry、JS、WASM、GPU textures、model cache另算 |

有清理代码：模式退出清空请求池、metadata cache、presentation stores、segmentations；工具也有 ResizeObserver/event 的移除逻辑。**不能据此宣称不存在泄漏，也不能泛称“没有清理所以持续重建”**。Trackball 的 mouseup 恢复在窗口失焦/工具切换等边界是否总执行仍待测试，不列为已确认 CPU 根因。

### 下一轮优先验证顺序（此轮不执行）

1. 固定真实场景：同一数据集、viewport lane/type、1 个/多个 3D viewport、actor 数、灯光/质量；区分静置、拖拽、松手、绘制标签后的时间段。
2. 先确认真实 GPU/软件光栅器/硬件加速、浏览器版本和设备像素比；不能只读 `useCPURendering=false` 就认定硬件 GPU 在工作。
3. 用浏览器 CPU/Performance、GPU/内存及必要的 Worker/network trace 分开看。区分解码/metadata/首次 texture 上传、ray casting、surface conversion、camera/overlay React commit、GC。不要在用户未授权时录入可能含病例信息的 trace。
4. **先用已有控制**：质量设为实际支持的 1、减少同时 3D/融合 actor、使用较轻的原生光照预设；通过 mode/toolGroup 配置试验 Trackball 的既有降质参数。一次只变一个因素。
5. 若 trace 确认 overlay 或订阅成本，再做局部扩展/可上游的小改动；不先换引擎、不直接改 node_modules、不盲加 debounce 牺牲交互准确性。

源码有 `?debug=true` stats overlay 入口（cornerstone init 第 72 行附近），但此轮没有更改用户 URL。其显示值和开销都应在获准的 profile 中标明。

## 6. 云端协作、数据与安全边界

### 认证不是病例授权

应用不只是一个裸 token 字符串：有 OIDC clients、登录/登出/回调和 [PrivateRoute:3](../../../platform/app/src/routes/PrivateRoute.tsx#L3)。但 [UserAuthenticationService:43](../../../platform/core/src/services/UserAuthenticationService/UserAuthenticationService.ts#L43) 是可注入实现，DICOMweb 会附 Authorization；查询参数 token 也有注入/清理路径。它们不能替代 PACS/网关上的 token 校验、机构/病例/操作级授权。

| 需求 | 本包可复用 | 前端之外仍需 |
|---|---|---|
| 用户登录 | OIDC/PrivateRoute、请求 header 注入 | IdP、受众/过期校验、后端拒绝未经授权请求 |
| 病例/机构隔离 | 可选数据源和工作列表 UI | 服务端 tenant/case ACL、隔离存储与共享撤销 |
| 标签锁/多人写冲突 | [segment lock:2103](../../../extensions/cornerstone/src/services/SegmentationService/SegmentationService.ts#L2103) 是本客户端状态；viewport sync/MultiMonitor 是本地显示协同 | 病例/标签租约、过期写拒绝、版本 compare-and-swap、会话身份 |
| 评论定位 | 可借用 annotation 世界坐标、FoR/source UID、现有面板/命令 | 评论记录、版本锚定、权限、线程/处理状态、通知 |
| 提交审核 | WorkflowSteps/模式/面板可呈现流程 | 不可变提交、角色分离、审核签署/退回、强制规则与审计 |
| 版本与恢复 | DICOM instance UID/predecessor、SEG/SR/RT hydration | 对象不可变策略、版本索引、原图与标签 hash、整工程恢复、备份恢复演练 |
| 审计/保留 | 浏览器事件与日志不是合规审计账本 | 服务端访问/修改/导出日志、防篡改、保留/删除、部署地区要求 |

本包没有交付上述完整协作后端；recipes 是集成参考，不是服务已部署/已配置好。`disableEditing`、隐藏按钮或 readonly 面板不应成为权限边界。

### 网络出口与动态配置

- 默认/开发配置包含公开 CloudFront DICOMweb 数据源；临床私有部署要明确替换和限制，而非只加登录。[dev config:117](../../../platform/app/public/config/dev.js#L117)。
- 动态 `?url=` 数据源有实际防护：[secureConfigFetch.js:57](../../../extensions/default/src/utils/secureConfigFetch.js#L57) 对带 Authorization 的跨源配置检查显式 allowlist；配置 fetch 使用 `redirect:error`、`no-referrer`，不直接转发 bearer。不能泛称“任意 URL 会直接带 token 取配置”。
- 但实际 DICOMweb/WADO 请求采用全局认证 header（DicomWebDataSource 第 216 行附近、initWADOImageLoader 第 29 行附近）。已配置数据源和 BulkDataURI 的实际目的地仍须纳入可信出口治理，尤其不要把公有示例源与私有 token 默认混用。此处是部署条件风险，**本轮未证实 token 已泄露**。
- `dangerouslyUseDynamicConfig/configUrl` 是另一入口：本包默认与 dev 示例未启用；若启用，要严控配置源。配置内 extension/module 的 JS 加载与 JSONC customization 的“只读数据”不是同一信任边界。
- AI 包默认模型 URL 在 Hugging Face 的 `resolve/main`，激活相关工具后可下载；本机代码是浏览器 ONNX 推理，**没有因此证明图像会上传 HF**。模型来源、权重许可、内容版本/hash、缓存容量需单独治理，或在批准后配置为受控本机/机构源。
- Locize 受 USE_LOCIZE 等环境开关控制；Rollbar 在可选 rollbar HTML template 中引用 CDN/遥测；不能把它们都说成普通 index 默认已发送病例。生产应审查实际构建入口/出口，必要时脱敏日志/trace。
- [netlify.toml:33](../../../netlify.toml#L33) 当前 CSP 为 **Report-Only**，相关 Nginx recipes 的示例行还被注释。它不是强制拦截策略；不代表本地 3000 的实际 header 已经核验。

### 其他剩余风险

- 不可信 DICOM/SEG/SR/RT 的尺寸、帧数、压缩/解压、标签数、损坏数据、重叠层数和导出内存峰值需资源约束。cache 限额不能覆盖全部内存。
- 源图/掩膜/轮廓/表面/测量应以 SOP/frame/FoR、spacing/direction/origin、单位及算法参数绑定；图像能看见不证明几何、测量或表面精度适用于具体术式。
- STOW HTTP 成功不自动证明所有 derived frame 被接收、可检索、可独立重开；失败后页面还保有内存对象不等于持久化。
- CSV 若用于 Excel，外部文本/标签的公式语义和转义需专门检查；本轮未运行 Office 或验证利用。
- pnpm-workspace 含 5 个 ignoreGhsas 及多项安全 overrides；这些是仓库说明/策略，不是甲方对风险的批准。未运行 pnpm audit，不发布“无公开漏洞”结论。
- 软件、WASM、模型、影像数据和宿主部署许可是不同层；本轮不是完整 SBOM/许可证法律审查。
- 本包源码、MIT 许可或某项上游修补均不构成特定地区医疗器械注册、临床诊断/手术用途认证。

## 7. 面向决策的建议

**已经确定以 OHIF 为基座，不再默认自造 viewer。** 建议路线是：可复核的 OHIF fork 基线 + 受控站点配置 + 尽量薄的自有扩展/模式 + 现成/院内后端集成；核心通用缺陷优先跟上游处理。

| 使用方向 | 当前可复用 | 必须先补齐/验证 |
|---|---|---|
| 科研阅片与分割制作 | DICOMweb/本地加载、2D/MPR、工具、SEG/RT/SR、CSV、TMTV 等现成能力 | 原生导出往返、F1、标签/测量协议、队列与数据版本、数据授权；CSV 不是科研统计平台 |
| 术前工程制作 | 解剖分割、MPR、mask surface 检查、基础量化与专家查看可作基础 | 单部位/术式的几何与边界验证、失败恢复、审阅交付协议、STL/网格/单位验证及可能的 CAD；不能声称已等价 Mimics 全流程 |
| 临床诊断/真实手术决策 | 本轮不作可用性结论 | 目标用途、地区、专业责任、质量/验证/审批要求另行评估 |
| 多人云端闭环 | 前端现成显示/编辑/模式/服务接口 | 后端授权、锁/CAS、评论、审核、不可变版本、存储和审计；先评估现成系统，不自动决定自研 |

**优先验证队列，均是下一轮经确认后的任务，不在本轮执行**：

1. 固定可追溯源码/依赖基线并核实 Shepherd 等实际授权；不要仅按 ZIP 文件名选“稳定版”。
2. 私有标签层（全局 2、局部 1）和重叠 SEG 独立往返；对照当前导出代码与上游修补，不只做渲染截图。
3. 源帧未缓存、Enhanced multiframe 仅一帧有标签、LABELMAP+RLE/binary SEG 的源 frame 引用及接收端兼容。
4. STOW 成功/部分失败/拒绝、关闭再开、同一 series 多份 SEG/SR 的选择与历史恢复；保存到本地文件与远端存储分开验收。
5. 原生几何测试：乱序、重复/缺层、非等距、倾斜/斜切、非零 origin、增强多帧、单位与 SR/RT 引用；独立工具校验，不复用旧自造工作台测试冒充。
6. F2 双订阅回归，以及 F3 的缺帧诊断传播检查；只在获准后加/跑测试。
7. 上述约束下的真实 3D profile，优先现有配置/模式与渲染质量控制；没有 trace 前不宣称 CPU 根因。
8. 再选择最薄的机构扩展、模式及后端集成边界；外部插件须逐项核验本地 Cornerstone **5.6.8**、React **18.3.1** 的 peer/API 兼容，不因名字含 OHIF v3 或版本数字更高就安装。

本轮没有新增实现授权；报告不自动恢复业务开发。
