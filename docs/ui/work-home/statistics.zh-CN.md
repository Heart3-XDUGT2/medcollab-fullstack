# 首页统计模块

日期：2026-11-03。状态：统计模块与独立验证完成，可供集成。二号只编辑 `statistics/**`、独立 Statistics E2E/验证页与本记录；一号负责首页、集合、偏好和最终页面集成。

## 最终接线签名

```tsx
import {
  useAnnotationStatistics,
  DatasetCoverage,
  makeSyntheticDatasetStatistics,
} from "./statistics";

const statistics = useAnnotationStatistics({
  mode,
  apiEnabled: config.apiEnabled,
  identity: phase === "ready" && mode === "real" ? identity.current : null,
  scopeSignal,
  sessionApi: api,
  demoData: syntheticStatsByDatasetId,
  onAccessIssue: (issue) => {
    /* existing account loss / remove resource only; no reload loop */
  },
});
<DatasetCoverage model={statistics} datasetId={dataset.id} variant="compact" />;
<DatasetCoverage
  model={statistics}
  datasetId={selected.id}
  variant="detail"
  active
/>;
```

所有重复入口传同一个页面 model，共享请求与缓存。默认近视口懒读，`active` 立即读取选中对象，`active={false}` 不请求。`useDatasetStatistics(model,id,{enabled})` 供自定义宿主布局，返回状态、data、stale、error、source 与 refresh；同模型还提供独立序列/本人统计 hook。

model 接受已经确认的 issuer+subject，不识别用户名；用父 scopeSignal 和卸载失效旧上下文。只消费现有 GET，不要求修改共享 `api.ts`。能力标记缺失/旧健康路由的 404 不通知资料删除。已确认 v1 的资源失权每个上下文最多通知一次，不让主页面清空后自动重读形成循环。

演示数据必须显式给 CT 分母，例如：

```ts
makeSyntheticDatasetStatistics("demo-id", {
  totalSlices: 12,
  annotatedSlices: 5,
  publishedAnnotatedSlices: 4,
});
```

不能传 `instanceCount` 充当 CT 总帧。没有提供合成记录的演示对象保持未知，不自动生成零。当前不声明真实后端联调通过，旧 8080 服务不可达且本轮不重启。

## 实现与安全边界

- `contract.ts` 白名单解析 v1 普通对象；校验安全整数、分子分母、比例与两位百分数、序列绑定和加权合计、操作序号/归档水位、个人历史操作公式。返回冻结对象，不保留成功体额外字段。
- `api.ts` 只发既有 health、本人、数据集、序列 GET；Cookie 同域、no-store、拒绝重定向。响应 JSON 流上限 2 MiB；拒绝 HTML、无效 UTF-8、非法 JSON 和超限响应。只显示本地安全文案，不回显 HTTP 正文或网络原始错误。
- 公开 health 先行，确认精确 `annotationStatsApi: "v1"` 后才进行统计读前、读后身份检查。缺标记/旧 health404 不额外请求 session，不通知资源失效。health 不包含账号统计；仍只有 real + API 启用 + 已确认 issuer/subject 才会探测。
- 同一 scope 内复用请求与缓存，最大 2 个活动 job、16 个排队 job。超限显示 deferred 并允许手动读取，不做隐藏的全表遍历。成功缓存按需新鲜期 30 秒，没有轮询。
- 最后一个消费者释放时取消请求。若 5 秒冷却内重新出现消费者，仅安排一个 scope 内的一次性恢复 timer；再次全部离开、卸载、账号失效或父取消均清掉 timer。失败/423 不自动重试。修复了取消后快速回到视口可能永久 idle 的审查问题，并补模型、React 和浏览器回归。
- stats404 会再次核验 health 能力与当前身份。降级缺能力不删除宿主资料，同时撤下旧统计和并发迟到结果。确认 v1 后的 403/404 清掉该资源的计数并最多通知一次；401/身份变化清空整个 scope。
- 423/5xx/非法统计仅在身份仍可信时保留上次结果并标旧；不能确认身份或未核实404时不展示旧计数。宿主通知抛错不会触发重试或未处理 promise 拒绝。
- 冷统计读截止 150 秒（兼容旧 SEG 首次补计数）、session 15 秒、health 10 秒；父取消、迟到 fetch/流读取/session 均有取消和代际保护。
- `DatasetCoverage` 为无框紧凑/详情控件，14px 主数据、12px 元信息；共享/归档均有分子分母和百分比。明确区分无 CT、未发布、已有归档但掩码为空、待归档、归档异常、旧值、缺能力和失败。归档错误不回显服务器原始正文。部分覆盖即使舍入为100，也只显示 `<100%`。
- 不写浏览器存储，不取 Labelmap/文件/像素，不写后端、不增 API 路径、不生成影像。无外部设计服务或医学素材上传。

## 验证结果

2026-11-03 在原目录、本机现有依赖上执行：

| 验证                                                                | 结果                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 产品源码 `tsc --noEmit`                                             | 通过                                                                                                                      |
| 独立 `tests/statistics/tsconfig.json`（含模块测试、验证页和新 E2E） | 通过                                                                                                                      |
| `vitest run src/features/home/statistics`                           | 4 文件，87 项通过                                                                                                         |
| `Statistics.spec.ts`                                                | 10 项通过，本机 Chrome、独立 61037 预览、所有 `/api/**` 受控拦截                                                          |
| 视口/几何                                                           | 1440 / 768 / 390；覆盖数值、空 CT、零值、无发布、归档错误、缺演示统计；无横向溢出与数值列碰撞，减弱动效、键盘焦点通过     |
| 单次机械设计扫描                                                    | 无阻塞项；3 条 advisory：示例标记 4px 角半径、独立验证页 16px/22px 字号。沿用现有小标记和标题尺度，不改全局 DESIGN 或侧车 |

重点单测覆盖：比值边界和舍入、加权合计、序列绑定、个人计数公式；GET 路径/凭据/超时/流大小；health缺能力、v1资源404、降级并发、401、换号、父取消、StrictMode、共享消费者、并发/队列上界、冷却恢复、无自动轮询、旧值、演示零网络、未知及非法合成记录。

浏览器回归包括：重复入口一读、旧 health 缺标记/404 不额外读 session、不误报资源失效；v1 404 一次通知；423 旧值与手动恢复；最后消费者隐藏/显示后的有界恢复；换号与转匿名清旧值；三尺寸合成状态。

首轮独立验证页发现 `Brand` default import 接错，已修正。后续原 60833 对 React 等预构建依赖返回 `504 Outdated Optimize Dep`，该轮测试未完成页面加载，不计为通过；没有删除依赖或重启原服务。新增独立验证配置 `tests/statistics/vite.config.ts`，缓存仅在 `.runtime/statistics/vite-cache`，61037 最终 10 项通过。StrictMode 的首 scope 可能发出随后被取消的公开 health 探测，测试允许至多两次启动探测；同资源统计仍只读取一次。

## 本地证据与复核

以下均在 `frontends/portal/`，为忽略的本机输出，非交付医学素材：

- `.runtime/statistics/first/synthetic-1440.png`
- `.runtime/statistics/first/synthetic-768.png`
- `.runtime/statistics/first/synthetic-390.png`
- `.runtime/statistics/e2e-confirmation/`：最终浏览器运行结果。
- `.runtime/statistics/vite.stdout.log`、`vite.stderr.log`：独立预览日志。

已逐张查看三尺寸截图；字段数字可辨、分子分母与比例一致，0 与未知区分清楚，无悬浮卡片/嵌套卡片，无医学假缩略图。验证页自身不是产品布局验收，一号/主审仍负责集成页面截图和最终构建。沿用既有 MedCollab 冷白/湖蓝、Inter 与中文回退字体，未启动新视觉方向或外部生成流程。机械 context 提示 `.impeccable/design.json` 与 DESIGN 不同步，按范围限制仅记录，不擅自刷新。

独立验证预览：`http://127.0.0.1:61037/tests/statistics/index.html`。默认全为明确标注的合成数据，无 API 请求；“受控接口响应”仅用于拦截测试，不是登录或真实服务接线。该页位于 tests，不加入产品路由和默认构建入口。

## 尚未声明完成

本模块的“适配与受控响应验证通过”不等于新版 Java / Keycloak / Orthanc、多账号实际授权、冷旧 SEG 补计数或临床联调通过。真实后端、主页面最终集成回归和隔离生产构建由后续/一号负责。本执行未碰 live dist、登录主题、后端、网关、实际配置、依赖安装或运行数据；未提交、推送、部署或重启旧服务。

## P2 紧凑清单定向修正

同一独立 reviewer 在 42 张完整集成截图中只提出一项 P2：1440/768/390 的 `library-30-compact` 与 `library-300-compact` 六图中，每份资料默认展开的统计挤占清单密度。本次只针对该项修正，不重做方向、不改主页面或全局样式、不改请求/状态语义。

compact 改为默认收起的 CT 覆盖率摘要：14px 主文字直接保留“共享画布 / 已归档”比例；未发布 SEG、待归档、合成示例、归档异常、旧值与错误状态仍直接可见。原生 details/summary 通过鼠标、Enter/Space 展开，完整分子分母、归档说明、计数范围、生成时间及手动重读仍可达。展开不增加统计请求，取消/缓存/身份边界完全沿用。detail 继续完整展开，继续入口与资料概览不被一起压缩。

补充验证：模块单测现为 90 项（4 文件），独立测试/验证页类型检查通过；新增三尺寸 compact 浏览器回归 3 项通过，并重跑7项既有协议/生命周期用例，共10项非截图浏览器测试通过。断言摘要高度不超过 64px、主字号14px、无横向溢出，默认不显示逐条标题/刷新/明细，键盘展开后可见完整计数及刷新，折叠不重读，detail 保持完整；423旧值与失败说明直接出现在收起摘要。证据为忽略目录 `.runtime/statistics/compact-review-e2e/`。

未自行捕获额外截图、构建 dist 或开启新视觉循环；由一号统一构建及原六场景一次确认捕获，主审交同一 reviewer 定向确认。本记录不提前声明 reviewer 已改为 ship。
