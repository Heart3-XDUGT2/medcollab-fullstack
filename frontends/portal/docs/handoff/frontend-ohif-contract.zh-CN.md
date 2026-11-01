# Portal 与 OHIF 工作界面交接契约

日期：2026-11-01。

状态：2026-11-01 已通过统一网关、Java dataset-scoped DICOMweb 和 Labelmap SEG 接口接通实际 OHIF。完整字段、路由、草稿/发布和维护边界见 [当前开发交接](./current-server/前端开发维护与兼容性指南.md)。下文保留导航约定与部署建议，不定义尚未实现的实时画笔/租约功能。

范围：从首页打开某个业务数据集，以及从工作界面返回首页。

## 1. 当前已经约定什么

Portal 将列表中的一个 `Dataset` 交给受控的 `workspacePath`。未配置路径时，页面如实提示工作界面尚未接入，不把静态样例或任意 Viewer 冒充选中的数据集。

`workspacePath` 必须是部署配置中的同源路径，不能来自查询参数、localStorage 或用户输入。当前校验拒绝协议相对 URL、外站地址、反斜杠、查询和片段。正式部署值为 `/workspace`。

```text
GET /workspace
    ?datasetId=dataset-example-001
    &access=owner
    &intent=view
    &returnPath=%2Fhome
```

这是网关提供的浏览器页面导航，不是 JSON 保存请求。启动器会 GET `/api/datasets/{datasetId}/workspace` 获取 Java 的真实系列与 UID；单序列直接进入 `/imaging/medcollab/medcollab`，多序列先选择。

| 参数         | 当前含义                                        | 不能被解释为什么                 |
| ------------ | ----------------------------------------------- | -------------------------------- |
| `datasetId`  | 不透明业务数据集 ID，按 URL 规则编码            | DICOM Study/Series UID、文件路径 |
| `access`     | `owner/shared/public`，来自列表的界面上下文     | 服务端可信的授权令牌或隐私设置   |
| `intent`     | `view/annotate` 的打开意图；当前首页默认 `view` | 自动获得编辑许可                 |
| `returnPath` | 当前固定 `/home`                                | 可无条件跳转的任意外站 URL       |

接口可复用 `buildWorkspaceUrl` 的逻辑；具体实现文件路径以本仓库源码为准。若后续改变参数，Portal、工作界面和文档必须一起更新。

## 2. OHIF 接手后必须做什么

1. 根据真实服务器会话核对当前账号，不能只信查询中的 `access`、`intent` 或姓名。
2. 向业务后端核对 `datasetId` 当前是否存在、当前用户是否仍有权访问。
3. 得到该数据集的实际源影像范围和获授权的数据访问入口，映射为正确的 Study/Series/Instance/Frame。
4. 核对来源、模态、序列、坐标与标注版本，再进入相应查看/编辑模式。
5. 读取、显示、草稿保存、发布/完成和训练导出分别处理；不把截图、下载或 STOW 成功当成全部业务保存。
6. 会话过期、账号变化、失权或版本冲突时保护未保存工作，拒绝串写，不偷偷覆盖。

当前已实现受业务影像集精确成员授权保护的 QIDO/WADO-RS，根路径为 `/api/datasets/{datasetId}/dicomweb`；这是当前普通单帧 CT 所需的受限读取入口。不能绕过 Java 直接暴露整台 Orthanc，也不能因为能访问一张图就放行整套 Study。

当前启动上下文由 GET `/api/datasets/{datasetId}/workspace` 返回。草稿存 IndexedDB，发布 Labelmap SEG 后通过版本轮询同步。编辑租约、实时画笔同步和自动合并尚未实现；Portal 的 OpenAPI 是子集文件，不应据此推断 OHIF 接口是否存在。

## 3. 推荐部署方式：同一站点，不同路径

建议以一个可信 HTTPS 入口承载：

```text
https://medcollab.example.test/
    /home                   -> Portal
    /account/sign-in        -> Portal
    /sign-in                -> 明确的密码表单外观预览
    /assets/...             -> Portal 构建资源
    /api/...                -> Java 业务 API
    /auth/...               -> Java 登录/注册入口
    /login/oauth2/code/...   -> Java OIDC 回调
    /imaging/...            -> 单独构建的 OHIF / 业务 launch 适配
```

域名和路径为部署示例，不是当前可访问服务。OHIF 团队必须配置资源 base、路由 basename 和回退，避免与 Portal 的 `/assets`、`/` 抢占。同域挂载不等于两份应用共享 React 状态或 CSS；它们仍是独立页面。

开发时两个前端端口可以不同，但 Cookie 不按端口隔离；需固定同一个主机名，并通过配置正确的代理/回调测试。只改 `authOrigin` 无法修正 Java 当前固定回到 8080 根路径的行为。

跨域 Viewer、嵌入式 iframe、跨页面消息和 token 传递不属于当前契约。不得通过临时放开任意跳转、把 token 放 URL 或转发长期存储凭据来完成演示。

## 4. 返回首页与未保存保护

- 工作界面应把 `/home` 识别为可信的 Portal 返回路径；如未来部署子目录，需要统一修改该约定，不靠相对路径猜测。
- 离开前由工作界面判断实际是否有未保存标注；Portal 没有 Cornerstone 的内部状态，不能代为判断“已保存”。
- 返回后首页重新读取当前会话及列表，列表中的创建时间仍不能当作标注保存时间。
- 未约定跨应用缓存或持久化前，返回后保留筛选/选择只是可选体验，不可作为已实现承诺。
- 如未来允许可变返回路径，双方必须按同源与允许路径校验，避免开放重定向。

## 5. 两人联调时的最小验收

| 验收       | 成功证据                                                       |
| ---------- | -------------------------------------------------------------- |
| 正确数据集 | 从两个名称相近的数据集分别打开，实际来源不同且与选择一致       |
| 授权有效   | 另一账号无权限、共享撤销、篡改 access/intent 均不能绕过服务端  |
| 不误开样例 | 未接入状态不打开无关公开 CT 来冒充选中资料                     |
| 入口可刷新 | 直接打开或刷新 launch 深链接不落入错误 SPA/404                 |
| 返回明确   | 返回到 Portal，不把 /home 当成 OHIF 的路由                     |
| 保存可恢复 | 实际标注保存、关闭、重开一致，另测会话失效与冲突               |
| 数据不外泄 | 不把患者信息、原图临时链接、密码、会话或访问 token 放 URL/日志 |

前五项属于打开链；保存与像素/标签正确性仍由工作界面和后端负责，不因 Portal 迁移完成而算通过。
