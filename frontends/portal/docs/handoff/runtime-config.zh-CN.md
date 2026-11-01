# 运行时配置与开发代理

日期：2026-11-01。

对应源码：`public/config.js`、`src/features/home/api.ts`、`vite.config.ts`。

本文件不表示后端、SSO 或工作界面已经部署。

## 1. 配置在哪里

Portal 启动前加载部署者控制的 `public/config.js`：

```javascript
window.config = {
  medcollab: {
    apiEnabled: false,
    authOrigin: null,
    logoutOrigins: [],
    workspacePath: null,
    publicSamplePath: null,
  },
};
```

以上是安全默认值，不是生产地址。构建产物中的配置文件可由部署者替换；替换后需重新加载页面。它属于公开浏览器配置，不能存放密码、client secret、Cookie、CSRF token、数据库或对象存储密钥。

配置只来自该受控对象，不读取任意查询参数、localStorage 或用户输入来决定服务地址。

## 2. 当前支持的字段

| 字段               | 默认值  | 含义与限制                                                                                                            |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `apiEnabled`       | `false` | 必须显式为布尔值 `true` 才启用相对 `/api` 请求；不是模拟登录开关                                                      |
| `authOrigin`       | `null`  | Java 认证入口的可信 HTTP(S) origin；不能带用户密码、路径、query、fragment；据此构造 `/auth/login` 和 `/auth/register` |
| `logoutOrigins`    | `[]`    | 允许 SSO 退出的纯 HTTP(S) origins；有效 `authOrigin` 也进入允许集合；不接受任意返回地址                               |
| `workspacePath`    | `null`  | 同源工作界面启动路径；以单个 `/` 开头，无反斜杠、query、fragment 或外站地址                                           |
| `publicSamplePath` | `null`  | 同源、独立公开样例入口路径，校验与 workspacePath 相同；不是所选数据集、也不会附带它的 ID                              |

`workspacePath` 与 `publicSamplePath` 是两个不同用途。不得把公开样例的成功打开当作选择的数据集已接通。

要指定具体样例，可让网关提供固定路径并由工作界面映射；当前字段不接受在路径中硬编码查询串或 DICOM UID。默认没有样例路径，不提供不存在的原生 Viewer 链接。

## 3. 生产网关示例

```javascript
window.config = {
  medcollab: {
    apiEnabled: true,
    authOrigin: 'https://medcollab.example.test',
    logoutOrigins: ['https://identity.example.test'],
    workspacePath: '/imaging/launch',
    publicSamplePath: '/imaging/public-sample',
  },
};
```

域名及路径仅为约定示例，不能直接复制后声称服务可用。其中 `/imaging/launch` 和 `/imaging/public-sample` 需要工作界面/网关团队另行实现。生产环境应使用 HTTPS；示例域名不是实际部署服务。

业务 API 没有可从浏览器随意指定的 `apiBaseUrl`。请求始终是同源 `/api`，应由网关转发 Java。Cookie、CSRF、后端拒绝响应和 HTTP 状态码要保留；API 不得被静态站点回退成 HTML。

## 4. 开发与回调不是同一件事

当前 Vite 配置仅提供前端开发服务，没有默认启用 `/api` 代理，也没有约定一个可直接使用的代理环境变量。真实业务联调需提供同源网关，或由开发负责人增加受控开发代理；具体版本以根 README 与 `vite.config.ts` 为准。即使增加代理，也只解决业务请求到达后端，不自动解决：

- Java 固定成功/失败落地到 8080 根路径；
- Keycloak 客户端 callback / post-logout allowlist；
- Cookie host、path、SameSite、Secure 及主机名混用；
- OHIF 资源 base、业务数据源、启动适配和标注保存。

两个端口不同不代表 Cookie 按端口隔离。统一使用实际约定的主机名，不混用 `localhost` 和 `127.0.0.1`，不要为了演示转发凭证到任意域名。

## 5. 配置检查顺序

1. 默认配置下三条 Portal 路由和显式示例可用，业务 API 不发送。
2. 启用 API 后先验证 `/api/session` 的匿名和登录结构。
3. 确认真正的浏览器登录回跳、本人身份及退出。
4. 用两个账号验证数据集、共享、撤权和写操作的身份边界。
5. 最后配置工作界面/样例路径，按相应交接契约验证，而不是仅确认网页有响应。

完整联调要求见 `integration-checklist.zh-CN.md`。
