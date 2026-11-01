# MedCollab 真实服务器端到端测试

`playwright.medcollab-server.config.ts` 连接完整的 Portal / Java / Keycloak / Orthanc 服务。
它会注册两个测试账号、发布两个分割版本，并导出 DICOM SEG。因此请使用可重建的独立测试环境。
源码包不携带医学影像、账号、浏览器配置或旧环境的运行数据。

前提：Node.js 24 或更新版本；按当前 `package.json` 安装 pnpm 12.8.1，并在 OHIF 根目录执行
`pnpm install --frozen-lockfile`。使用 Playwright Chromium 时先执行 `pnpm exec playwright install chromium`；
也可以把 `MEDCOLLAB_E2E_BROWSER_PATH` 设置为本机 Chromium/Edge 的可执行文件路径。

在测试环境启动全部服务并构建前端。Keycloak 必须允许注册，并启用包内的 Portal 登录主题。
准备一个对新注册用户可见的公共 QA 数据集：只包含一个普通单帧 CT 序列，至少两张切片，
没有已发布分割（版本为 0），影像中间区域可用于绘制。自行提供有使用权限的测试影像。
该数据集由 Java 的公共数据集配置提供；普通私有上传不会自动成为公共数据集。

在 `frontends/ohif` 下设置环境变量，然后运行：

```sh
MEDCOLLAB_E2E_ENABLED=1 \
MEDCOLLAB_E2E_ORIGIN=http://127.0.0.1:8080 \
MEDCOLLAB_E2E_DATASET_ID=your-public-qa-dataset-id \
pnpm exec playwright test --config playwright.medcollab-server.config.ts
```

PowerShell 使用 `$env:MEDCOLLAB_E2E_ENABLED='1'` 等语法设置相同变量，再运行最后一行命令。
默认未启用或未指定数据集时，测试标记为 skipped；缺少合适公共数据集、切片或空白发布状态时也明确跳过。
跳过不表示集成通过。明确启用后若服务不可用，测试给出前置条件错误。

默认输出目录为 OHIF 下 `.runtime/medcollab-e2e/`，可用 `MEDCOLLAB_E2E_RUNTIME` 覆盖。
其中 `qa-runtime.json` 累积记录创建的 Keycloak 用户 subject 和 Orthanc SEG id；
`evidence/` 保存报告、截图和导出。这些运行数据均不应提交。测试不自动删除账号或发布结果；
请通过测试环境的管理工具清理对应对象，或重建测试环境，再准备版本为 0 的数据集重新运行。
不要只删除 SEG 而保留 Java 发布元数据。

## 上游 OHIF 通用测试数据

本组合仓库不是原 OHIF Git 仓库，因此不保留嵌套 `.gitmodules` 和缺失的 gitlink。
上游通用测试需要的可选数据可在 OHIF 根目录显式运行 `pnpm test:data` 获取。
该命令从 `https://github.com/OHIF/viewer-testdata-dicomweb.git` 浅克隆到 `testdata/`；
已有非空目录会保留，不覆盖、不更新。`testdata/` 被忽略，不纳入组合仓库。
这套上游夹具不能自动替代上面需要预先导入到 Java / Orthanc 的 MedCollab QA 数据集。
