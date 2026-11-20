# 分区层级与有界动效

日期：2026-11-05。状态：实现、首批检查及唯一修正确认完成；独立限定 verdict 为 **P2 resolved，ship at known-findings scope**。未提交、推送或部署。

## 基线与保护

基于原目录 HEAD `3c1fb5b`，保留队友新真实收藏 / 最近及迁回的顶部导航。完整工作树安全快照为 `32c1bc92c2e511bd17a06d5f19422b7c2b2b779f`，ref `refs/safety/home-section-motion-20261105-221033`；含 tracked 和 nonignored untracked，真实索引未改。

原 60833 Vite 复用，不重装 modules，不启动真实 Java / 网关 / Keycloak / Orthanc，不运行原 backend/OHIF 构建或清理任务。源码安全快照不包含 ignored 运行数据，也不代替数据库 / 影像备份。

## 静态分区

- 数据集、继续、收藏、最近、团队统一使用平面章节标题带、图标和上 / 下分界，不给每个模块套浮动卡。
- 继续目标使用一个真实选中数据集对象框架，身份与 CT 覆盖率由同一边界及 `aria-labelledby` 关联；桌面内部竖分隔、手机横分隔。统计自身无嵌套卡片。
- 真实收藏的 ready / loading / failed、分页与写入 disabled 条件没有回退为旧未接入分支。失败与空集合仍有明确模块标题，不以零替代错误。
- 手机工具组移到总览标题行的正常 flex 布局，已移除旧 absolute 规则，长文案不与工具遮挡。
- 769 / 900 / 1000 中间宽度收紧顶部间距与账号显示宽度，完整账号仍可在账号菜单查看。

品牌、顶部导航、右上账号、原密度与模块显隐 / 顺序保留。没有新医学图、KPI、API、框架依赖或运行配置。

## 动效语义与预算

- 既有实体在**小范围且旧 / 新位置完整可见**时做位置连续，260ms 自然减速，不缩放文字。旧 / 新位置超过 160px、原先离屏、变更滚动位置或替换 DOM 表现时，只用已有 160ms 温和反馈。
- 每集合最多量测 64 个、动画 12 个；移除 / 失权对象立即消失，不复制 DOM、不保留退出影像或私有文本。中断从当前绘制位置继续，旧动画取消而非排队。滚动本身不触发重播。
- 星标先遵循真实 busy / disabled，只有可信确认状态变化才做短底色与图标反馈；初次载入、pending、未知结果不动画成成功。
- 视图切换、选中线、菜单及原生展开使用短反馈，默认内容可见、无长开场或无限循环；操作没有动画锁。
- 系统减弱动态不做实体位移，保留温和反馈与清楚选中状态；省流量 / 低核数禁用实体位移。小菜单效果局限于自身，减弱动态下仅短淡变。缺 WAAPI 时静态内容可用。

动效只拥有绘制，不拥有请求、身份、取消、缓存、写重试或业务状态。保留现有 fresh CSRF、未知结果保护、1 GiB 串行上传与真实活动接线。

## 变更文件

| 仓库相对路径                                                        | 作用                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `frontends/portal/src/ui/motion.tsx`                                | 有界 / 可取消布局连续、确认反馈、视图反馈与原生展开反馈      |
| `frontends/portal/src/ui/motion.test.tsx`                           | 10 项位移、退化、中断、预算、空 scope / 无克隆、确认边界测试 |
| `frontends/portal/src/features/home/section-motion.css`             | 章节带、继续对象归属、菜单 / 选择反馈、减弱动态与中间宽度    |
| `frontends/portal/src/features/home/WorkHome.tsx`                   | 章节图标、同一继续对象语义、集合接线；保留真实活动条件       |
| `frontends/portal/src/features/home/DatasetCollection.tsx`          | 实体绘制标记与确认后的星标反馈                               |
| `frontends/portal/src/features/home/HomePage.tsx`                   | 工具位置和视图反馈，不改业务 handlers                        |
| `frontends/portal/src/features/home/ScopeOverview.tsx`              | 工具组正常布局槽位                                           |
| `frontends/portal/src/features/home/home-top-navigation.css`        | 移除旧手机 absolute 工具规则                                 |
| `frontends/portal/src/features/home/statistics/DatasetCoverage.tsx` | 仅接原生展开反馈，不改统计模型 / 协议                        |
| `frontends/portal/tests/e2e/SectionMotion.spec.ts`                  | 24 项操作 / 减弱动态 / 低端 / 中间态与布局覆盖               |
| `frontends/portal/tests/e2e/helpers/motion-fixture.ts`              | 已有接口的受控 ready / failed / empty / demo 测试材料        |

## 最终实跑

| 项目                | 结果                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| 产品 `tsc --noEmit` | 通过                                                                                |
| 全量 Vitest         | 23 文件、344 项通过                                                                 |
| 全量 Playwright     | 108 项通过，包含原账号、取消、偏好、真实活动与统计回归                              |
| 定向动效确认        | 24 项通过；包含运行中关键帧而非仅截图                                               |
| 隔离 Vite build     | 通过，仅 `.runtime/home-section-motion-dist`，绝对路径预检在 Portal 内且不是 `dist` |
| 原 dist 保护        | 当前已重建版本的 21 文件作为新基线；最终全部 SHA-256 一致                           |
| 独立布局基线扫描    | 主审报告 0 findings，只作机械证据，不代替层级审查                                   |

确认实际验证：大网格 fallback 没有 transform；小可见清单保留 87 / 134px 位移及 260ms 关键帧；减弱动态关键帧没有空间变换；快速筛选最终状态正确、400ms 后无排队重播，滚动无新实体动画。星标 held PUT 期间保持旧状态、disabled 且不播放成功反馈，释放真实分支受控响应后才确认。

初次动效测试有一项因“收藏”变成“取消收藏”后定位失效；改为同一实体的稳定控件定位，保留 pending 和确认语义断言。没有为测试放宽业务安全条件。

## 两轮证据

首批目录：[round-1](../../../frontends/portal/.runtime/home-section-motion/round-1/)，[索引](../../../frontends/portal/.runtime/home-section-motion/round-1/verification.json)：36 张原图，覆盖 1440×960 / 768×960 / 390×844 的真实活动 ready 受控、demo、空、失败、长名称、菜单、减弱动态和重排中间帧。

独立首批判定静态分区可交付，唯一 P2 为大跨度（桌面约 `translate(-464,270)`、手机约 544px）及旧位置离屏仍做空间 FLIP，可能扫过其他记录。一次批次增加旧 / 新完整可见、可用视口边界、滚动一致及 160px 上限；大跨度使用既有温和 fallback，**没有改时长或重做方向**。移动的小实体只临时提高绘制层级，结束恢复。

唯一确认：[confirmation](../../../frontends/portal/.runtime/home-section-motion/confirmation/)，[索引](../../../frontends/portal/.runtime/home-section-motion/confirmation/verification.json)。保留原 36 场景图，增加三张小可见清单中间帧，共 39 张；六份 motion JSON 保存真实 WAAPI 关键帧 / 暂停时刻 / 几何。已实际查看关键三尺寸静态完整图与中间帧。

主审转交同一独立 reviewer 限定 verdict：**P2 resolved，ship at known-findings scope**。该裁定只确认已知静态分区和所列动效问题，不扩张为真实权限 / 医学或新全表面认证。确认后停止代码与捕获。

## 预览、生效与限制

[http://127.0.0.1:60833/home](http://127.0.0.1:60833/home) 为原目录源码预览，明确进入演示即可查看；原 Vite 保留，没有另启 / 重启业务服务。

原 `frontends/portal/dist` **未重建**，8080 编译入口不因此更新。保护基线为 Portal `.runtime/home-section-motion/dist-before.json`，隔离产物不是部署。没有提交、推送、修改版本锁或正式 DESIGN / sidecar。

所有本轮 API 数据均为受控响应或明确演示，未运行真实后端联调、真实低端硬件帧率或全面辅助技术认证。离屏统计仍可按需读取，不以截图遍历全库；大跨度特意保守退化，不追求整页飞动。已保留队友真实收藏 / 最近与用户原有未提交文件。
