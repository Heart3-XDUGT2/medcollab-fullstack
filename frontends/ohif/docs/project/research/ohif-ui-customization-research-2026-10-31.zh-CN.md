# OHIF 前端主题、组件与定制案例调研

> 团队仓库归档副本。本机运行日志、临时截图及备份不随源码提交；相关证据引用以文字保留。原电脑路径仅说明历史验证环境。


日期：2026-10-31，Asia/Shanghai。

目标：为“产品工作台与用户体验”负责人寻找可复用的 OHIF UI 资源，不替换既定 OHIF 基座。

边界：在线阅读官方文档、搜索结果、项目 README 和许可证，并只读核对本机源码。未安装主题或第三方扩展，未修改 OHIF 配置、依赖与源码，未操作本机阅片页面。未完成第三方兼容性或全界面视觉验收。

## 1. 结论

**有现成资源，最值得优先使用的是 OHIF 自己的主题系统、可视化选色工具和 ui-next 组件库，而不是另找一套完整替代前端。**

- 官方已有默认配色之外的六套主题、可选的 Appearance 对话框、自定义 CSS token 和主题预览入口。
- 本机 `Viewers-3.13.13` 中确实有相关实现，不是仅看到最新文档后推测本机也支持。
- 主题主要解决颜色与组件风格，不会自动提供任务分配、多人编辑状态、版本、评论和审核。
- 本轮未找到可证明同时满足“通用完整换肤包、维护可靠、兼容本机 3.13.13”的第三方成品。此结论是本轮检索范围内的发现，不代表社区绝对不存在。
- 医院展示案例、商业定制服务、其他影像浏览器，不能直接等同于可安装的 OHIF UI 插件。

## 2. 可直接利用的官方资源

| 资源 | 能做什么 | 用法与边界 |
| --- | --- | --- |
| [Colors & Theming](https://docs.ohif.org/colors-and-theming/) | 查看颜色角色、预设、对比度要求，进入真实 viewer 主题预览 | 最适合负责人先看效果；文档含外部演示站，不要导入私有病例 |
| [OHIF Viewer Theming](https://ohif-theming-beta.netlify.app/) | 可视化调整颜色 token，通过 Copy Theme 导出主题文本 | 已打开并核对选色控件与复制入口；这是官方文档推荐的设计工具，不是完整工作台生成器 |
| [Appearance & Theming](https://docs.ohif.org/platform/services/customization-service/appearance-theming/) | 启用 Appearance、切预设、保存个人选择、粘贴自定义 token、URL 指定预设 | 默认不启用；不能只在 URL 加 theme 参数就认定主题一定生效 |
| [Components / ui-next](https://docs.ohif.org/components/) | 交互预览按钮、表格、菜单、弹窗、工具按钮、面板和医学专用控件 | 优先复用组件及语义，避免新增一套与阅片区割裂的 UI |
| [UI & Appearance](https://docs.ohif.org/configuration/ui/) | 组件、颜色、图标、White Labeling、UI 服务和 customization 总览 | 适合作为实施入口；白标配置可替换 Logo，但不自动完成整个产品改版 |
| [Customization Service](https://docs.ohif.org/platform/services/customization-service/customizationService/) | 按配置、模式或扩展覆盖支持定制的 UI 与行为 | 是业务面板、菜单和流程定制入口，不意味着任意组件都无需开发即可替换 |

### 六套预设

默认 OHIF Blue 之外，官方列出：

| 类型 | 名称 | 官方描述的大致方向 |
| --- | --- | --- |
| Tonal | Orchid | 紫色调 |
| Tonal | Arctic | 冷蓝色调 |
| Tonal | Verdant | 绿色调 |
| Neutral | Midnight | 接近黑色的中性分层 |
| Neutral | Slate | 冷中性灰与蓝色强调 |
| Neutral | Deep | 深色表面与较低对比的层次 |

这些预设以深色设计为主，不能把文档网站的明暗模式按钮当成 viewer 已完整支持浅色模式的证据。官方提供预设不代表它必然适合我们的中文文本、标签配色和所有布局，仍需实际检查。

### 配置入口

官方文档给出的启用方式，是向既有配置的 `customizationService` 数组加入：

```js
'@ohif/extension-default.customizationModule.theme'
```

这是供后续实施参考的配置项，本轮没有写入配置，也没有覆盖原有数组。

本机支持的自定义色值是类似 `--primary: 214 98% 60%;` 的 HSL token。不是任意整份 CSS 都能直接粘贴。

## 3. 本机兼容性核对

核对对象：`C:\Users\35775\Desktop\Viewers-3.13.13`。

| 本机证据 | 确认内容 |
| --- | --- |
| `extensions/default/src/getCustomizationModule.tsx:44` | 注册名称为 `theme` 的 customization module |
| `extensions/default/src/customizations/appearanceModalCustomization.tsx:15` | Appearance 对话框实现，包含主题选择与自定义主题交互 |
| `platform/ui-next/src/themes/index.ts:16` | 注册 orchid、arctic、verdant、midnight、slate、deep |
| `platform/ui-next/src/themes/themes.css` | 预设的实际 CSS token 覆盖 |
| `platform/ui-next/src/contextProviders/ActiveThemeProvider.tsx` | 验证 URL 预设、localStorage 持久化、body 主题类与自定义 token 注入 |
| `extensions/default/src/init.ts:30` | 注册 ActiveThemeProvider 的路径 |
| `platform/ui-next/package.json:4` | 自述基于 shadcn/ui 的可定制组件库，并声明 Radix 依赖 |
| `platform/app/src/routes/WorkList/WorkList.tsx:103` | 读取自定义 Logo 配置 |

注意：

- 当前官方文档标记为 3.13 Beta (Latest)，不能把所有在线文档内容都视为本机固定版本的契约。上表只确认相关入口存在。
- 本机还混用 `@ohif/ui` 与 `@ohif/ui-next`。旧组件、硬编码色值和外部扩展是否都能响应 token，需要逐页面验证。
- 预设的 JSON 负责注册名称等信息；本机切换通过 CSS class 生效。只编辑 JSON 色值不一定改变实际颜色。
- 浏览器保存的个人主题，不等于机构级主题管理或跨设备偏好同步。

## 4. 社区与外部资源

### A. tweakcn：可参考的通用主题工具

- [项目](https://github.com/jnsahaj/tweakcn)，[在线编辑器](https://tweakcn.com/)。
- 官方 README 定位为 Tailwind CSS / shadcn/ui 的可视化主题编辑器。
- 本轮读取的仓库许可证为 **Apache-2.0**，不是据旧印象认定为 MIT。
- 与 OHIF ui-next 的技术基础接近，可以寻找配色灵感。
- **不是 OHIF 插件**。导出的变量、色值格式及语义要映射到 OHIF；不能假设 OKLCH、字体、圆角等通用主题设置都可原样粘贴到 OHIF Appearance。
- 第一优先级仍是 OHIF 官方选色工具，匹配成本更低。

### B. PARADIM OHIF DICOM Annotator：业务面板参考

- [仓库](https://github.com/paradim-platform/ohif-dicom-annotator)。
- 已读 README 中有真实分割面板和结构属性表单截图。
- 作为 extension + mode，替换原生分割面板，增强分割表格，为每个结构填写可配置问卷，并输出关联的 SEG 与 SR。
- 值得借鉴的是“在 OHIF 内增加专业流程”的方式，不是全局换肤。
- README 声明开发测试基线为 OHIF **3.11.1**，peer 为 `^3.10.2`，不构成本机 3.13.13 / Cornerstone 5.6.8 的兼容证明。
- 此前生态审查已记录其回答持久化和完成校验限制；本轮没有安装或重新测试。

### C. ODELIA Viewer：保留上游、隔离自定义功能的参考

- [仓库](https://github.com/StratifAI-Research/odelia-viewer)。
- 是 OHIF fork，增加业务相关的 AI 工作流；README 将自有扩展、模式和配置组织在 `custom/`。
- 值得借鉴代码组织与业务功能接入方式，不必照搬其 AI 任务和整个界面。
- Viewer 仓库标注 MIT；完整 Platform 是另一个仓库，存在不同许可证及研究用途、安全配置边界，不能混为同一授权。
- 本轮没有测量视觉质量、维护活跃度或进行 API 兼容验收。

### D. 官方 Showcase：产品流程参考，不是皮肤仓库

- [完整目录](https://ohif.org/showcase/)。
- [苏黎世儿童医院案例](https://ohif.org/showcase/UCHZ)：泌尿影像模式，专门工具栏、分割标签与分析侧栏、空间/时间浏览、报告工作流。
- 对我们最有价值的是“保留专业视口，把机构流程放进工具栏和侧栏”的做法。
- 展示页不证明源码公开、可直接复用，也不证明与本机版本兼容。

## 5. 建议的使用顺序

1. 负责人先看官方 Colors & Theming 和 Components，确认我们已有的设计材料。
2. 用官方选色工具探索品牌色；选一个中性深色与一个低饱和品牌色方向即可，不急于改代码。
3. 将“工作台”和“阅片区”分开设计：前者承载病例、任务和审核；后者保留高密度专业工具与稳定视口。
4. 优先复用 ui-next 做业务面板，并通过 customization / extension / mode 接入；不默认复制全部 viewer。
5. 实施时检查中文长文本、表格密度、键盘焦点、禁用/错误/占用状态，以及标签颜色与界面强调色是否混淆。
6. 新手引导另行处理：有原生 Tours 配置可参考，但当前 Shepherd 依赖存在 AGPL/商业许可核查事项，主题资源不能解决这个问题。

## 6. 本轮未做

- 未启用本机 Appearance，没有更改用户个人主题。
- 未创建新 UI、原型或设计稿，没有发起业务开发。
- 未安装 tweakcn、PARADIM、ODELIA 或其他依赖。
- 未宣称找到可直接交付的多人协作版皮肤。
- 未将公开预览站用于上传任何私有影像或身份数据。
