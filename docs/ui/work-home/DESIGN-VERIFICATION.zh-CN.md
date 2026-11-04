# 工作首页设计继承核对

日期：2026-11-03。范围：既有 MedCollab 体系中的普通功能扩展，不生成新设计系统。本记录只读源码与已有原图，不替代主审在 [BRIEF.zh-CN.md](BRIEF.zh-CN.md) 中的最终裁定。

## 继承依据

已完整阅读 Impeccable `reference/document.md`，按提取实际实现、保留既有规范的原则核对；本轮不重写全局文档，不运行 context、检测、测试、构建、服务或新截图。

- 已读 Portal 的 [AGENTS.md](../../../frontends/portal/AGENTS.md)、[PRODUCT.md](../../../frontends/portal/PRODUCT.md)、[DESIGN.md](../../../frontends/portal/DESIGN.md)，以及本目录的 BRIEF、DIRECTION、IMPLEMENTATION、statistics 四份记录。
- 实际色彩来源为 [src/styles.css](../../../frontends/portal/src/styles.css)：湖蓝 `--mc-primary: #007fa3`、近黑 `--mc-ink: #171c1f`、灰白工作底色与独立警告/危险色。工作首页及统计私有 CSS 直接继承这些变量，没有另建品牌色系统。
- [src/main.tsx](../../../frontends/portal/src/main.tsx) 实际导入本地 Fontsource Inter 400/500/600/700；[home.css](../../../frontends/portal/src/features/home/home.css) 使用 Inter、Microsoft YaHei、PingFang SC 回退、零字距，14px 正文与至少 12px 元信息。首页继续目标的 20px/手机 18px 名称是局部层级，不是新的全局字体规范。
- [ui/ui.css](../../../frontends/portal/src/ui/ui.css) 的 6px 控件、8px 对话框、湖蓝焦点及浮层阴影仍是共享词汇；[WorkHome.tsx](../../../frontends/portal/src/features/home/WorkHome.tsx) 复用本地 `Button`、Lucide 和 `Link`。[work-home.css](../../../frontends/portal/src/features/home/work-home.css) 用无框章节、分隔线、双列至手机单列延续工作平面，没有把章节改为浮动卡片。
- [Brand.tsx](../../../frontends/portal/src/ui/Brand.tsx) 仍引用既有 `public/brand/medcollab-mark.svg`。本轮没有新增 shipping raster 素材，运行目录中的图像只是合成验证证据。

## 新表面事实

工作首页入口与资料库内部的“资料索引/资料清单”是两层独立选择。[preferences/model.ts](../../../frontends/portal/src/features/home/preferences/model.ts) 中新默认入口为 `work`，资料库内部默认仍为 `cards / comfortable / none`；无 `home` 字段的旧 v1 偏好兼容为 `library`，并保留原清单、密度、分组和字段选择。全局 DESIGN 的“个人首页默认资料索引”描述既有资料库，不覆盖本轮新增的默认入口；当前功能以本轮 surface brief 为准，本记录不悄悄改写旧规范。

继续、收藏、最近、资料库入口、团队按同一模块顺序渲染；显隐与顺序是个人显示配置，全部隐藏仍保留顶部资料库入口。真实偏好只存白名单显示值，按 issuer/subject 派生本机账号键；演示和匿名不持久化，不保存资料内容、ID、访问历史、凭证或目的地。源码核对支持这些实现约束，本记录不据此宣称实际多账号授权验收通过。

## 统计层级

[DatasetCoverage.tsx](../../../frontends/portal/src/features/home/statistics/DatasetCoverage.tsx) 与 [statistics.css](../../../frontends/portal/src/features/home/statistics/statistics.css) 已核对：

- 资料库消费 `compact`：原生 `details/summary` 默认收起，14px 摘要直接显示共享画布/已归档比例，或无 CT/未发布状态；待归档、合成、旧值、异常和失败仍可见。展开后才显示完整分子分母、范围说明、生成时间与手动重读。
- 工作首页继续目标及资料概览消费 `detail`，保留完整内容，不随紧凑清单一起压缩。两种层级共享同一统计模型，不因展开而新增另一套统计实现。
- 统计是“非空掩码单帧 CT / 受支持 CT 总帧”的覆盖率；共享画布 `progress` 与归档 `publishedProgress` 分开，不代表质量、审核通过或器官完整度。无 CT 不写成全部覆盖，未知/错误不伪装为零。

## 真实与演示边界

真实统计适配既有只读 API；当前 8080 实际服务不可达，未重启或升级后端，因此“适配及受控响应验证”不等于真实服务联调。真实收藏/最近仍待后端，界面保留未接能力状态；点击打开不伪记成功访问。继续仅返回数据集，不声称恢复序列、视角或本机草稿。团队入口保留独立团队语义，不转化为个人共享权限。

演示收藏/最近仅内存交互，统计分母为显式合成 CT 数据，不由实例数推导。演示、受控响应及所有截图内容均为合成，不含真实患者素材；截图不能证明 Cookie/CSRF、账号隔离、权限、后台写入或联调正确。

## 证据与结论

已有首批 [round-1](../../../frontends/portal/.runtime/work-home/round-1/) 的 42 张原图由独立 reviewer 全部审查，唯一 P2 是紧凑清单统计默认展开过多；集中修正后 [confirmation](../../../frontends/portal/.runtime/work-home/confirmation/) 有 12 张原图，含 1440/768/390 三尺寸的 30/300 份紧凑资料库和工作首页视口/全页。同一 reviewer 的定向确认结果由主审转达：`Disposition=ship`，原 P2 resolved，工作首页 detail 未见明显回归。此为定向截图结论，不扩大为交互、权限或真实服务裁定。

本核对员只查看代表性原图 `1440-library-30-compact.png` 与 `390-real-work-current-full.png`：前者对应收起摘要，后者对应完整继续统计、真实收藏/最近缺能力状态与下方团队入口，和源码记录相符；未另开视觉问题清单或补拍图片。

本轮无需改全局设计 tokens。局部模块网格、字号与摘要层级是既有体系的扩展，不是新世界。全局 DESIGN 与 `.impeccable/design.json` 的既有不同步提示仅记录为 pre-existing drift；sidecar 仍标记 `generatedAt: 2026-11-02`，本轮两者均保留，不顺带修复。

未验证真实新版后端、多账号实际授权、临床准确性或部署；未执行测试复跑，也未替换 live 产物、提交或推送。回滚快照为 `8ba8b6fb13cd5158b986286abc8fd4b75595dbf8`，本轮基线 HEAD 为 `5cf877c`。
