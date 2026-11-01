# OHIF ROI 历史记录错误修复交付

> 团队仓库归档副本。本机运行日志、临时截图及备份不随源码提交；相关证据引用以文字保留。原电脑路径仅说明历史验证环境。


日期：2026-10-31  
状态：**已获授权并正式应用，3000 已重载，实际安装依赖的 22 项单测和原站点 3 项交互测试通过。服务保留运行。**

阅读说明：第 1 至 7 节保留此前隔离验证与待应用阶段的记录；当前部署、验收与回滚位置以第 8 节为准。

## 1. 隔离阶段范围与现场保护

- 源码：`C:\Users\35775\Desktop\Viewers-3.13.13`。
- 实装依赖：`@cornerstonejs/core@5.6.8`、`@cornerstonejs/tools@5.6.8`。
- 报错：`Last item should be an array for grouped memos.`，调用链经过 `HistoryMemo.pushGrouped`、`AnnotationTool.createAnnotationMemo` 和 `LivewireContourTool`。
- 未直接编辑源项目的 `node_modules`，未抑制错误或关闭错误遮罩，未禁用 ROI，未全局清空用户历史。
- 未升级依赖版本，未改动影像计算、ROI 面积计算或导出算法，未初始化 Git 仓库。
- 没有操作用户或审阅者已有的浏览器标签页。
- 没有重启或停止 3000 服务。结束时仍由原 PID `47496` 监听；本次新建的 3335 隔离服务已停止。
- 原有中文本地化 68 个文件的交付后哈希全部保持不变。
- 源项目仅新增了本次三个单元测试文件；所有运行时代码、依赖补丁和锁文件修改仍位于隔离目录/待应用补丁中。

## 2. 根因与证据边界

### 已确认的历史模块缺陷

直接执行当前实装的、未经修改的 `HistoryMemo`：

```js
history.push(earlierMemo);
history.startGroupRecording();
history.push(groupedMemo);
history.undo();
history.push(nextROIMemo);
```

会抛出与用户一致的异常。原实现的撤销移动了历史游标，却没有结束分组；下一次推入 ROI memo 时，`pushGrouped` 读到的当前项不再是数组。

另外，原实现开始空分组时就占用环形历史槽位，会提前丢弃 redo 分支；满容量/回绕时取消空组还可能损坏游标。重设历史容量也未重置分组状态。

### 已确认的箭头与应用侧生命周期问题

- `ArrowAnnotateTool` 的空文字返回、取消和工具切换路径没有完整关闭所持有的分组。
- 文本回调是异步的；仅补一个无参数 `endGroupRecording()`，仍可能让旧回调关闭后续新操作的分组。
- OHIF 默认 `callInputDialog` 的 Cancel、Esc、关闭按钮原先只隐藏弹窗，不结束等待输入的 Promise，因此箭头的空文字收尾回调根本不会执行。
- 清空测量与删除分段的应用侧分组调用缺少 `try/finally`。
- Livewire 不负责开启这个箭头分组，是后续推入 memo 时触发断言的下游工具；本地化不是这些依赖缺陷的来源。

**不能据此断言用户此前的完整点击顺序。** 用户说“应该按过”并不能确认一次精确复现。本次分别证明了实装模块的最小状态机错误，以及修复版本在公共 CT 样例上的真实交互结果。

## 3. 最小修复内容

### 依赖补丁

`core`：

- 延迟到第一个真实 memo 才分配分组槽位，空组不破坏此前历史或 redo。
- 分组返回 owner token，兼容原有无参数结束调用，支持嵌套所有者。
- 撤销/重做先使当前 owner 失效并关闭分组。若当前操作为空，第一次操作只取消进行中的操作，不撤销更早的无关标注；下一次显式操作才处理已有历史。
- 容量重设同步结束分组状态。
- 保留 `pushGrouped` 的原始不变量断言，没有自动把普通 memo 包装成数组，也没有吞掉异常。

`tools`：

- 箭头持有自己的 owner；结束、取消、被动化和禁用只清理所属操作。
- 新箭头只在文字确认后提交创建 memo，取消对象不会被 redo 复活。
- 无效 owner 的迟到文字回调直接失效，不能修改新操作或关闭新分组。
- 同步文字提供器抛错仍向上传播，同时保证分组收尾。
- 更新相应 `.d.ts`，未修改 Livewire/Freehand 的成像或绘制算法。

### OHIF 应用侧

- `callInputDialog.tsx` 增加可选取消通知；仅 Arrow 选择启用，保留其他调用者原有契约。
- `commandsModule.ts` 区分新箭头取消与编辑已有箭头取消：后者保留原文字，不回写空标签。
- 两处同步分组使用 owner 和 `try/finally`。
- Dialog 关闭按钮仅新增 `data-cy="dialog-close-button"` 供自动化定位，未修改外观。

本次显式改变的新箭头取消行为：取消未确认文字的箭头会移除该临时对象，且不提交创建历史；取消完毕后再次显式撤销，按正常规则撤销此前已完成的操作。这与“进行中空组被撤销时先取消该操作”是两个不同边界。

## 4. 验证结果

| 验证 | 结果 |
| --- | --- |
| 原实装历史模块最小复现 | 确认抛出同句异常 |
| 扩充后的原版历史回归 | 9 失败、1 通过；其中包含新 owner 契约用例 |
| 隔离 HistoryMemo 回归 | 10/10 |
| 实际 Arrow 类的边界单测 | 7/7 |
| 默认输入弹窗取消契约单测 | 5/5 |
| 隔离开发构建 | Rspack 编译成功，保留开发错误遮罩 |
| 公共 CT 页面交互 | 3/3，通过后再以不更新截图的方式复跑，3/3，34.6 秒 |
| 补丁实际应用与结果比对 | 5 组补丁均在新建验证目录应用成功，与测试版本内容一致 |
| 修改文件语法检查 | Babel TypeScript/JSX 解析通过 |
| pnpm 锁文件 | 隔离 manifest-only 工作区生成；offline/frozen/lockfile-only 再验证通过 |
| 依赖版本不变 | 去除补丁哈希元数据后结构等价，包数均为 2585 |
| 现场完整性 | 9 项原始基线、68 项本地化哈希全部未变 |

Arrow 单测使用实际发包的 Arrow 类和 HistoryMemo，但对外部渲染及基类 memo 协作者使用 stub；不将这些单测冒充真实影像验证。下述浏览器用例使用实际应用、工具、影像、鼠标/键盘和 SVG。

浏览器使用独立 Edge 进程与 `127.0.0.1:3335`，加载公共 study：
`1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5`，明确切到 `Body 3.0 CE` CT 序列。

三个用例覆盖：

1. 已有箭头 → 新箭头等待文字 → 点击撤销，仅删除进行中对象、保留旧标注；再启动新箭头，注入旧回调，确认不能影响新 owner；新箭头完成后的撤销/重做正常。
2. 新箭头分别通过 Cancel、Esc、关闭按钮取消；编辑已有箭头也通过这三条路径取消并保留原文；随后撤销/重做、完成 Livewire，再反复撤销/重做，保留此前箭头。
3. 未完成箭头切换到 Pan；Livewire 进行中 Esc 取消；绘制闭合 Freehand，再连续三轮撤销/重做。

第一个用例只在测试准备阶段替换文字提供器，以便延迟异步回调且不让弹窗挡住撤销按钮；实际绘制与撤销仍由真实 UI 完成。外观验证采用 SVG 线条/文本断言及视口截图，不以服务内部状态代替外观。

隔离构建对 core/tools 的裸导入及深路径导入均指向隔离整包，避免混用两份标注状态。每次页面测试均记录并校验运行时 `startGroupRecording` 与 Arrow 取消函数指纹，附带已加载脚本列表，证明不是误测原依赖。

## 5. 交付文件

证据根目录：
`C:\Users\35775\Desktop\医学标注\docs\research\ohif-roi-evidence-20261031`

正式待应用补丁位于其中的 `staged-patches`：

- `@cornerstonejs__core@5.6.8.patch`
- `@cornerstonejs__tools@5.6.8.patch`
- `application.patch`：5 个 OHIF 文件。
- `pnpm-integration.patch`：workspace 补丁注册及 pnpm 生成的锁文件差异。
- `regression-tests-pending.patch`：尚未写入源项目的 E2E 与 page-object 修改。
- `regression-tests.patch`：完整测试差异，含源项目已经新增的三个单测文件；不要对现有文件重复应用这些新增段。
- `files.json`、`patch-validation.json`、`lockfile-audit.json`、`production-integrity.json`：文件哈希、补丁验证和完整性审计。

关键证据：

- `unit-staged-final.json`：22 项单测。
- `browser-results.json`：最终不更新截图的 3 项页面测试、函数指纹、错误列表和历史诊断附件。
- `browser-baseline-generation.json`：前一轮截图生成测试。
- `viewport-livewire.png`、`viewport-freehand.png`：已人工检查的视口截图。
- `service-status-final.json`：仅原 3000 监听，3335 已停止。

原文件与工作副本：
`C:\Users\35775\Desktop\医学标注\backups\ohif-roi-history-20261031-01`

隔离 E2E 可复现入口：
`work\viewer\playwright.roi-isolated.config.ts` 与
`work\viewer\platform\app\.webpack\webpack.roi-isolated.cjs`。
这些配置仅用于隔离验证，不属于运行应用修复。

## 6. 维护窗口应用顺序（原计划，执行结果见第 8 节）

1. 用户先保存/导出当前标注，明确确认可以重载。再次检查现场文件哈希，发现新增用户修改时先合并，不能直接覆盖。
2. 在批准的维护窗口停止原开发服务，并建立当时的新备份。
3. 将两个依赖补丁复制到源项目 `patches/`，按 `pnpm-integration.patch` 注册。应用 `application.patch`；不直接修改安装目录。
4. 保留当前已新增的三个单测，仅应用 `regression-tests-pending.patch`。所有补丁先做 `git apply --check`；该命令不需要初始化仓库。
5. 使用同一 pnpm `12.8.1` 执行 frozen 安装，让包管理器按锁文件应用补丁。不要执行全量依赖升级。
6. 重跑单测，重启应用后在新浏览器会话做原站点回归；确认依赖实际解析到受控补丁版本，再让用户恢复标注工作。

原项目 Playwright 配置与本次隔离配置的视口尺寸、截图路径不同；本次截图不应直接作为不同尺寸的既有全套测试基线。复现本次结果应使用保留的隔离配置，正式项目测试接入时应匹配配置与基线。

## 7. 回滚与剩余边界

- 回滚同样需要保存工作和维护窗口。只恢复本次修改文件及 pnpm 补丁注册/锁文件，使用包管理器恢复原依赖；不得覆盖无关改动、删除其他补丁或清空用户历史。
- 本次备份以已完成本地化的版本为基础，回滚 ROI 修复不应回滚中文本地化。
- 未运行全仓库 E2E、完整生产构建或全仓库 TypeScript 检查；已完成隔离开发构建、目标语法检查及上述目标回归。
- `callInputDialogAutoComplete` 的自定义 `measurementLabels` 分支未纳入本次默认弹窗取消协议，未声称覆盖自定义标签组件。
- 尚未对运行中的 3000 应用安装/重载修复，因此不能称用户当前页面已经恢复。正式应用后的原站点验证仍待维护许可。
- 没有已验证的上游发布版本可直接替代本补丁，本次不以猜测性升级代替修复。

## 8. 正式维护窗口执行与原站点验收

### 授权与实际范围

用户已明确确认：“可以重载，还有几个bug先不修了”。

本轮仅应用上一轮已验证的 ROI 历史修复。没有调查或修复其他 bug，没有开展新的产品工作台、后端接口或 OHIF adapter 开发。

维护前再次核对 19 个目标与 68 个本地化文件，全部匹配基线；新建非破坏备份：

`C:\Users\35775\Desktop\医学标注\backups\ohif-roi-apply-20261031-01`

该目录保存 86 个当前文件及 `baseline.json`。先前隔离备份仍保留。

### 实际应用命令

工作目录为源项目 `C:\Users\35775\Desktop\Viewers-3.13.13`。

1. 对 `application.patch`、`pnpm-integration.patch`、`regression-tests-pending.patch` 执行 `git apply --check`；对两个依赖补丁分别在实际已安装包目录仅执行 `git apply --check`，全部通过。
2. 核对端口与进程命令行后，仅停止原 OHIF 监听 PID `47496`；没有关闭或刷新用户已有浏览器标签页。
3. 使用 `git -c core.autocrlf=false apply` 应用上述三份源项目补丁；没有重复应用已存在的三个单测。
4. 将两个正式依赖补丁复制到源项目 `patches/`，通过 `pnpm install --frozen-lockfile` 安装。实际 pnpm 为 `12.8.1`，安装退出码为 0，锁文件 resolution step skipped，下载 0；未手改 `node_modules`，未执行升级命令。
5. 用 `pnpm --filter @ohif/app run dev` 恢复原版开发服务，环境仅指定 `OHIF_OPEN=false`、`OHIF_PORT=3000`。没有加入隔离包别名或测试覆盖配置。

安装后再次核对应用文件、依赖 JS/声明文件、workspace 与锁文件，匹配已验证补丁内容；core/tools 实际解析位置均在原源项目安装目录，版本仍为 `5.6.8`。

本地化核验为 67 个文件逐字节不变；另 1 个 `Dialog.tsx` 仅包含已批准补丁中的 `data-cy="dialog-close-button"` 属性新增，原翻译内容未变。

### 实际安装依赖单测

未设置 `CS_HISTORY_MODULE`、`CS_ARROW_MODULE`、`OHIF_INPUT_DIALOG_MODULE` 隔离覆盖，直接运行源项目实际模块：

```powershell
node node_modules/jest/bin/jest.js --config extensions/cornerstone/jest.config.js --runInBand --runTestsByPath extensions/cornerstone/src/utils/historyRecordingRegression.test.ts extensions/cornerstone/src/utils/arrowHistoryRecordingRegression.test.ts extensions/cornerstone/src/utils/inputDialogCancellationRegression.test.ts --no-cache --json --outputFile C:\Users\35775\Desktop\医学标注\docs\research\ohif-roi-evidence-20261031\maintenance-unit-installed.json
```

结果：**3 个测试文件、22 项测试全部通过**。日志为 `maintenance-unit-installed.log`。

### 原站点浏览器验收

使用独立 Edge 测试进程，运行源项目 `tests/ROIHistoryRegression.spec.ts`；测试配置的 `baseURL` 为 **`http://127.0.0.1:3000`**，没有启动 3335，没有把隔离版测试结果当作部署验收。

```powershell
node node_modules/@playwright/test/cli.js test --config C:\Users\35775\Desktop\医学标注\docs\research\ohif-roi-evidence-20261031\playwright.maintenance.config.cjs
```

首次运行的交互断言均完成，但两个截图断言因原 dev 配置显示“仅供研究使用”提示条而与隔离 e2e 配置不同。保留了真实首次失败记录：
`maintenance-first-run.json`、`maintenance-first-run.log`、`maintenance-first-livewire.png`、`maintenance-first-freehand.png`。

对此仅增加测试会话准备步骤：page object 使用现有 `confirm-and-hide-button`，经正常 UI 确认该信息提示；没有改应用代码、隐藏错误遮罩、修改 dev 配置、替换截图基线或放宽截图阈值。两个测试侧文件的这项窄范围适配记录在 `maintenance-installed-verification.json`。

随后在同一原站点重新运行，**3/3 通过，32.1 秒，0 重试**。撤销中断、迟到回调、三种弹窗取消、取消编辑保留原文、Livewire、Freehand、工具切换及重复撤销/重做均通过；页面错误断言为空。两张截图仍使用原已审阅基线，哈希核验确认基线未变。

`maintenance-final-summary.json` 汇总了实际加载自 3000 的脚本列表、历史/箭头运行时指纹、22 项单测结果和三个原站点测试结果。

### 运行状态与日志

- 原版服务启动器 PID：`46536`。
- 最终 3000 监听 PID：`61180`，命令行为原项目 `rspack serve --config .webpack/webpack.pwa.js`。
- 临时 3335：无监听。
- 服务已保留运行：[中文入口](http://127.0.0.1:3000/?lng=zh)。
- 启动记录：`maintenance-dev-launch.json`；进程记录：`maintenance-service-status.json`。
- 服务日志：`maintenance-dev.stdout.log`、`maintenance-dev.stderr.log`。
- 安装日志：`maintenance-install.log`；浏览器日志：`maintenance-browser.log`。
- 最终核验：`maintenance-installed-verification.json`、`maintenance-final-summary.json`。

构建成功，但出现一条 `Circular dependency between chunks with runtime (app, compute, polySeg)` 警告；安装 preinstall 也记录了 Windows 创建可选符号链接的权限警告。两者均未造成命令失败，未据此扩大修复范围。

### 回滚与保留边界

回滚必须再次保存当前工作并进入维护窗口。先核对上述新备份的哈希，只恢复本次修改的既有源文件、workspace 与锁文件；新建的 ROI E2E 文件及两个依赖补丁文件按清单单独处理，保留此前已存在的三个单测及所有无关用户改动。通过同一 pnpm 的 frozen 安装恢复原依赖，不手工覆盖安装目录，不全局清空用户历史。不要把备份中的全部 86 个文件无条件覆盖回现场。

仍未执行全仓库 E2E、完整生产构建或自定义 `measurementLabels` 分支验证。其他 bug 按用户要求暂不处理。
