# 顶部导航首页本地试版

日期：2026-11-05。状态：可预览试版，首批与一次集中修正 / 确认完成。未提交、推送、部署；不改后端、OHIF、网关或业务运行配置。

## 效果

- 移除常驻左侧栏，少量顶部主导航、右上账号；团队页复用同一顶部壳层。手机保留分类抽屉及返回焦点。
- 取消首页重复的空间导航 / 入口切换条，将入口移入顶部，标题与动作带收紧。
- 一个来源分布总览呈现当前完整个人资料库的总数及我创建 / 共享 / 公共分布，点击可切换来源范围。它不是四块 KPI，不代表团队资料合计；不查询全库 CT 以制造全局覆盖率。
- 工作首页资料模块默认靠前，显示最多六份实际数据集，明确“前六 / 当前范围总数”。名称、来源、创建者、实例数、创建时间、覆盖率、打开与管理仍复用现有组件和单一统计 model。
- 新默认模块顺序资料优先；已保存的有效显隐 / 顺序、默认入口、卡片 / 清单等偏好仍尊重，不无声覆盖。
- 未接通的真实收藏 / 最近缩成短能力状态，未伪造记录。演示收藏、取消、最近移除 / 清空仍只在内存。
- 不新增医学缩略图。已有单实例预览不等于可靠的数据集封面；没有为装饰读取整 CT、下载 Labelmap 或引入影像引擎。

## 修改文件

相对仓库根：

| 文件                                                                                                                                           | 变更                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `frontends/portal/src/ui/PortalShell.tsx`                                                                                                      | 顶部导航、账号菜单、移动抽屉；原样例入口收进账号菜单                |
| `frontends/portal/src/ui/portal-top.css`                                                                                                       | 共享顶部框架与响应式                                                |
| `frontends/portal/src/features/home/HomePage.tsx`                                                                                              | 入口接线、来源总览、六份实体预览、标题工具分组                      |
| `frontends/portal/src/features/home/WorkHome.tsx`                                                                                              | 资料实体模块、未接能力的紧凑显示                                    |
| `frontends/portal/src/features/home/ScopeOverview.tsx`                                                                                         | 同一完整个人集合的来源分布及筛选                                    |
| `frontends/portal/src/features/home/home-top-navigation.css`                                                                                   | 本试版排版、实体区、总览与手机标题                                  |
| `frontends/portal/src/features/home/preferences/model.ts`                                                                                      | 仅新默认顺序资料优先，旧有效记录不迁改                              |
| `frontends/portal/src/features/home/ScopeOverview.test.ts`、`frontends/portal/src/features/home/preferences/model.test.ts`                     | 来源计数、空集合、旧顺序保留                                        |
| `frontends/portal/tests/e2e/TopNavigation.spec.ts`                                                                                             | 顶部账号、无左栏、完整计数 / 六份预览、模块显隐、标题单行与边缘对齐 |
| `frontends/portal/tests/e2e/Home.spec.ts`、`frontends/portal/tests/e2e/WorkHome.spec.ts`、`frontends/portal/tests/e2e/pages/HomePageObject.ts` | 新入口精确定位，保留原安全 / 焦点 / 统计断言                        |
| `frontends/portal/tests/ui/work-home-check.mjs`                                                                                                | 可选输出目录及试版场景、从文档顶端捕获、几何 / 计数记录             |

原统计 / 上传 / API / 偏好 session 安全实现没有重写。根目录未跟踪的后端交接文档保留。

## 验证

| 检查                                            | 实际结果                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过                                                                                                                    |
| `node node_modules/vitest/vitest.mjs run`       | 20 文件、323 项通过                                                                                                     |
| 全量 Playwright，Chrome、60833、`--trace=off`   | 82 项通过                                                                                                               |
| Vite 隔离生产构建                               | 通过，仅写 `.runtime/home-top-navigation-dist`；先检查绝对路径不是 live `dist`                                          |
| live dist                                       | 21 文件 SHA-256 与既有基线完全相同                                                                                      |
| 三尺寸捕获                                      | 首批 36 原图，一次确认 36 原图；均无页面错误、横向溢出或业务写请求                                                      |
| 一次机械扫描                                    | 0 primary，13 advisory；为旧 DESIGN 前置 token 范围外的字号 / 来源色 / 4px 焦点角等，本地试版保留，不抑制或擅改全局规范 |

浏览器回归仍覆盖登录 / 示例隔离、fresh CSRF、换账号、取消、未知写入、1 GiB 上传、共享、团队、偏好与统计状态。一个紧凑清单接线测试改为比较进入 detail 前后已发读取数，避免将布局切换时被取消的读尝试算作 detail 重复请求；严格单资源去重与账号安全测试仍保留。

本轮只做受控响应 / 演示 UI 验证，没有重跑真实 Java / Keycloak / Orthanc 联调，不以截图代替权限或医学验收。

## 首批与一次修正

首批：Portal `.runtime/home-top-navigation/round-1/`，36 张原图。实际查看发现手机标题被动作组挤成两行；主审另指出桌面来源总览只到约 x978、未与 x1408 的实体区对齐，且文案偏实现术语。

同一批修正：手机标题与操作分组保证单行，设置 / 刷新使用总览上方空位；移除移动顶部两行间多余行距；来源分布使用完整内容宽度及三个明确可操作数字列，文案改为“可访问数据集 / 个人资料库”。不添加更多功能、不继续新美术循环。

确认：[verification.json](../../../frontends/portal/.runtime/home-top-navigation/confirmation/verification.json)，包含同场景 36 张原图及三张视口联系表（联系表不是新捕获）。已实际查看三尺寸主图、联系表与完整页面。确认关键几何：

| 视口     | 常驻侧栏 | 标题高度 / 单行高 | 来源条右边缘 / 数据集区右边缘 | 总数 / 当前实体预览 |
| -------- | -------- | ----------------- | ----------------------------- | ------------------- |
| 1440×960 | 0        | 33.59 / 33.60px   | 1408 / 1408px                 | 30 / 6              |
| 768×960  | 0        | 30.80 / 30.80px   | 750 / 750px                   | 30 / 6              |
| 390×844  | 0        | 30.80 / 30.80px   | 372 / 372px                   | 30 / 6              |

捕获均在 scrollY=0；整页图中离屏统计允许保持“尚未读取”，真实滚动时按需读取，不为截图遍历全库。数据集实体信息和打开操作不依赖统计先读完。

## 本地预览与回滚

预览：[http://127.0.0.1:60833/home](http://127.0.0.1:60833/home)。原 60833 已停止，确认端口空闲后仅启动本 Portal Vite，PID59840；日志位于 Portal `.runtime/home-top-navigation/preview.stdout.log` / `preview.stderr.log`。没有启动或重启任何真实业务服务。

默认仍安全关闭 API，可主动进入示例空间。画面中的统计 / 资料来自受控合成响应或明确演示，非真实账号截图。

安全 ref：`refs/safety/home-top-navigation-20261105` → `83f3e48db2f56ad54ec1ad5c21c6ad888a977f1d`。原未跟踪后端交接文档另在 `.runtime/safety/home-top-navigation-20261105/` 保留副本，原文件不动。未切分支或改索引。

这是本地设计试版，不是新的正式 DESIGN 规范；原 DESIGN / sidecar 不改。残余边界：真实收藏 / 最近 API 仍未接通、未添加医学封面、已保存的本人模块顺序可能不同于新默认，空账号不补造数据。是否采用试版由用户 / 主审看图决定，不提前声称独立 ship 或生产就绪。
