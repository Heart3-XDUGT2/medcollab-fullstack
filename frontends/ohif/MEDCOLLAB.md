# MedCollab OHIF 团队说明

本仓库保存团队已经修改的 OHIF 源码。后续开发从本仓库的共同提交开始，不要重新下载官方 ZIP 后各自修改。

团队仓库：[Heart3-XDUGT2/medcollab-ohif](https://github.com/Heart3-XDUGT2/medcollab-ohif)。`main` 保存共同基线；仓库目前为私有，队友需要获得访问权限。

## 来源与边界

- 上游：[OHIF/Viewers](https://github.com/OHIF/Viewers)。
- 核实的上游标签：`v3.13.13`，提交 `1fa151f5133934c953a2ab4c0056ca91f929c32f`。
- 本机原有 ZIP 的 `commit.txt/version.json` 曾记录另一个较早提交；它们不是 Git HEAD，不能用于断言当前代码逐字等于该旧提交。
- 本次导入保存当前应用源码、本地化、受控依赖补丁及测试，不宣称所有差异都来自本轮开发。
- 当前已有中文与 ROI 修复，尚未实现完整多人协作后端。其他 bug 暂不扩展修复。

原上游 `LICENSE`、各包声明和公开示例素材保留。依赖/插件/模型的许可独立核查，特别注意 Shepherd 的 AGPL/商业许可事项。研究用途提示、目标用途验证和医疗合规不能由 MIT 许可证替代。

## 开发启动

使用仓库声明的 Node.js 24+ 和 pnpm 12.8.1；以 package manifest 与锁文件为准，不升级整套依赖来解决本地安装问题。

```powershell
pnpm install --frozen-lockfile
pnpm --filter @ohif/app run dev
```

默认中文入口：

```text
http://127.0.0.1:3000/?lng=zh
```

英文入口为 `?lng=en-US`。也可在用户偏好里选择语言。切换或刷新前保存工作；开发服务器不是云端病例/权限数据库。

如果 3000 已被占用，请使用空闲端口，不要关闭其他人的服务。认证、影像服务和部署参数按团队约定配置；不得提交真实凭证。

## 两类修改

### 简体中文本地化

- 翻译资源主要在 `platform/i18n/src/locales/zh/`，通过现有 i18next 注册和调用。
- 常用列表、工具、分割面板、偏好及提示完成首轮资源覆盖；部分硬编码文案接入翻译函数。
- 保留英文回退与语言切换，少量专科资源和原始服务器诊断仍可能是英文。
- 患者/检查原始描述、用户标签、DICOM UID/代码和必要缩写不做强制翻译。

### ROI 历史记录修复

依赖正式补丁：

```text
patches/@cornerstonejs__core@5.6.8.patch
patches/@cornerstonejs__tools@5.6.8.patch
```

由 `pnpm-workspace.yaml` 的 `patchedDependencies` 与 `pnpm-lock.yaml` 共同管理。安装时由 pnpm 应用，不直接修改 `node_modules`。

应用侧还包含分组收尾、默认箭头输入框取消通知等修复。验证覆盖撤销/重做后继续绘制、取消、工具切换和迟到回调；不代表所有影像/导出场景已验收。

## 目标回归

翻译资源和语言切换：

```powershell
node node_modules/jest/bin/jest.js --config platform/i18n/jest.config.js --runInBand --no-cache
```

历史、箭头和默认输入弹窗取消：

```powershell
node node_modules/jest/bin/jest.js --config extensions/cornerstone/jest.config.js --runInBand --runTestsByPath extensions/cornerstone/src/utils/historyRecordingRegression.test.ts extensions/cornerstone/src/utils/arrowHistoryRecordingRegression.test.ts extensions/cornerstone/src/utils/inputDialogCancellationRegression.test.ts --no-cache
```

本机维护验收：翻译回归 5 项；ROI 相关回归 22 项；原站点 3 条 ROI 交互用例通过。新电脑必须按自身环境复测，不能把本机记录当成新环境的通过结果。

端到端回归入口为 `tests/ROIHistoryRegression.spec.ts`，遵循 `.agents/skills/ohif-test-agent/SKILL.md` 和项目 Playwright 配置。公开数据、浏览器、服务端口、截图平台等需满足实际测试条件，不要无条件更新截图或放宽阈值。

## 公开演示数据

- 不删除或清理 OHIF 自带的公开演示图片、文档素材和既有测试截图。
- `testdata` 按上游 `.gitmodules` 作为子模块引用保存，远端为官方 `viewer-testdata-dicomweb`。
- 若需要本地测试数据，可在理解下载大小后按项目测试说明初始化该子模块；仅浏览远端公开样例不代表已初始化本地测试数据。
- 不把 `node_modules`、构建缓存、运行报告、认证状态或本机秘密当成演示数据提交。

## 三人交接

- [总览与职责](./docs/project/handoff/README.zh-CN.md)。
- [第二人：OHIF 标注端](./docs/project/handoff/owner-2-ohif.zh-CN.md)。
- [第三人：后端与协作](./docs/project/handoff/owner-3-backend.zh-CN.md)。
- [共同样例、流程和契约 v0.1](./docs/project/handoff/integration-contract-v0.1.zh-CN.md)。

接口文档是待三人共同确认的草案，不是已经存在的服务。历史研究记录中的原电脑路径只说明当时的验证现场，不能作为队友电脑的部署路径。
归档研究报告不包含本机日志、临时截图或备份；公开上游素材和上游既有测试基线仍保留在源码中。ROI 本机验收使用的截图配置与默认全套配置不同，不能直接冒充默认配置的截图基线。

## 提交约定

每人从共同基线开功能分支，通过审查和目标测试后合并。源数据、凭证和个人环境配置不入库；公开演示数据保留原有组织方式。上游升级、共享 UI 和依赖补丁修改须通知相关负责人。
