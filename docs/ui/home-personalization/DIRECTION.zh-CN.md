# 首页创作方向

日期：2026-11-03。模式：Operate。自主选择，不等待额外选卡；不调用外部设计生成服务。

## 组织探索与选择

1. 全幅比较清单：适合多资料逐列查找，但少量资料被拉成空旷长表。本轮保留为可选“资料清单”，不作为唯一呈现。
2. 任务 / 指标仪表墙：需要尚不存在的进度、任务与访问历史，不能靠视觉补数据，排除。
3. 资料索引台：真实资料本身成为完整的索引记录，名称、来源、创建者、实例和创建时间构成内容；与精确比较的清单可逆切换。本轮选择。

## Direction contract

**THESIS**：以“资料索引台”承载医学 AI 训练数据集的进入与管理。少量对象有完整而精致的记录形态，多量对象可转入紧凑清单；不以仪表墙或假影像封面制造丰富。

**OWN-WORLD**：保留 MedCollab 连接标识、湖蓝与近黑、系统中文和本地 Inter。灰白工作面、零字距、短圆角、规则明确的元信息基线；来源是稳定的身份标记，不是流程状态。

**STORY**：先辨认当前个人范围，搜索或按来源定位资料，直接进入工作台；必要时查看详情和管理。团队入口始终明确，改变显示不影响资料与权限。

**FIRST VIEWPORT**：一个紧凑标题与动作带、个人 / 团队入口、搜索和显示控制；索引视图以真实记录为最大主体，清单视图以名称与可比较字段为主体。空态保留完整工作框架与真实动作。小屏重排而非缩微文字。

**FORM**：本地 code-led。design-taste workspace 的 Editorial greeting 参考（seed 1841026147）提供 1100px / 12 列对齐与常规字重数字的节奏；不照搬其问候、指标块或嵌套面板，因为本产品没有对应监测任务。对等记录卡用于真实数据集，页面章节不做浮动卡。

**FINISH**：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## 与偏好模块的接入

接受二号既定枚举，不重复维护：

- `layout: 'list' | 'cards'`，页面文案为资料清单 / 资料索引。
- `density: 'comfortable' | 'compact'`。
- `groupBy: 'none' | 'source'`。
- `fields: { owner, instances, createdAt }`。
- 名称、来源和主要操作固定，详情开关与选择由 HomePage 维护。
- 自选默认建议：`cards`、`comfortable`、`none`，三个字段均显示；若已有本机本人偏好则尊重已存值。
- Hook、状态存储与设置组件由二号独占，首页只消费 `preferences/update/reset`；不按偏好 remount 页面。

## 事实与验证边界

复用既有 session、CSRF、generation、AbortController、取消与未知写结果保护，不更改请求协议，不回归 1 GiB 导入。真实/演示/匿名隔离；偏好不保存对象内容、ID、邀请码或目的地。

参考调研机制和官方图，但不复制截图为产品素材。不新增医学影像。屏幕问题分别覆盖 0 / 3 / 30 / 300 份合成数据、长中文名、两种布局、两档密度、分组、字段、详情及关键设置。

本轮不覆盖正在被 8080 读取的 `frontends/portal/dist`。最终经 root 通知后，只输出到 Portal 内已忽略的 `.runtime/home-personalization-dist`，预览另用 Vite 空闲端口。

## 首批交审检查点

- 首版实现：`HomePage.tsx`、重写的私有 `home.css`、无业务状态的 `DatasetCollection.tsx`，消费二号独占的偏好模块；默认索引 / 舒适已经同步，已存本人偏好不覆盖。
- 预览为 `http://127.0.0.1:60833/home`，仅独立 Vite；未触碰正式 8080/8082 或主题挂载资源。
- `pnpm typecheck` 通过；资料呈现组件 5 项聚焦单测通过。偏好模块的 54 项模块 / 7 项浏览器通过记录由二号提供，不冒称为本轮全量验证。
- `tests/ui/home-experience-check.mjs` 首批通过，三个尺寸 0 / 3 / 30 / 300 份合成资料，布局、密度、分组、字段、搜索 / 选择保持、刷新保留、账号默认和安全恢复均已检查，无业务写请求、页面错误或横向溢出。
- 30 张首批 PNG 和 `verification.json` 位于 `frontends/portal/.runtime/home-personalization/round-1/`；三个 `*-contact.jpg` 仅为研究总览，原图用于评审。
- 自查观察：桌面紧凑清单首屏可直接比较约 13 条资料；手机索引首条记录起点约 420px，顶部工作带占比交独立评审判断。这只是指定合成截图的观察，不是生产指标或效率结论。
- 主审指出分组清单的 `tbody` / `scope=rowgroup` 范围需一致，已在统一收尾批次修复并补充第六项呈现测试。

## 统一收尾结果

保留“资料索引台”，仅落实合并评审的三项修正：390px 顶部工作带与紧凑行密度、768px 长名称识别尾缀、真实 `tbody` 来源分组语义。

一次定向确认输出 12 张截图，已逐张检查，位于 `frontends/portal/.runtime/home-personalization/confirmation/`。390×844 少量索引首条起点从首批约 420px 提前到 283.80px，分组索引从约 478px 提前到 319.30px；紧凑清单首屏从约 3 条增至 6 条完整记录。768×960 的 30 / 300 份清单首屏各有 11 条完整记录，全部长名允许换行且无尺寸裁切，来源与识别尾缀可见。字段隐藏截图在关闭设置后拍摄。

最终本地验证：typecheck 通过、13 文件 225 项单测通过、41 项浏览器回归通过、隔离 Vite 构建通过。正式 `dist` 21 个文件 SHA-256 全部未变，未执行 `prepare-theme`。

主审转交的独立截图复核结论为 **`Disposition=ship`**：审查员逐张查看确认目录全部 12 张原图，390px 首屏效率、768px 长名尾缀通过；字段隐藏关面板、1440px 方向保留和 390px 设置面板也无明显视觉回归。该结论仅针对截图，不替代功能、真实权限或后端验收。

本批视觉冻结，不追加审美循环。个人首页记录已合并进 [Portal DESIGN.md](../../../frontends/portal/DESIGN.md)，保留团队与登录旧事实；BRIEF 与副作用核对由主审负责。没有提交、推送或部署。详细测量、[确认结果](../../../frontends/portal/.runtime/home-personalization/confirmation/verification.json)与验证边界见 [IMPLEMENTATION.zh-CN.md](IMPLEMENTATION.zh-CN.md)。
