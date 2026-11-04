# 个人显示偏好

日期：2026-11-03。模式：Operate。实现线程：二号。状态：模块稳定，已由一号接入首页；整体首页的独立视觉审查与最终统一构建另行完成。

## 共同方向

已读取本轮 `BRIEF.zh-CN.md`、一号的 `DIRECTION.zh-CN.md`、研究 REPORT、国内/国际附录、文献附录与官方图板。借鉴的是视图、密度、字段与保存范围的分离，不复制竞品图或推断不存在的后端能力。

最终共识：

- `layout: cards | list`，用户文案为“资料索引 / 资料清单”。
- `density: comfortable | compact`，文案为“舒适 / 紧凑”。
- `groupBy: none | source`，连续或按来源分组。
- 三个可选次级字段：创建者、实例数、创建时间。
- 名称、真实来源/归属和主要操作始终由首页保留，不提供隐藏权限语义的设置。
- 默认 **cards + comfortable + none，三个字段均显示**。只对首次使用、无效记录或显式恢复默认生效，不在首页挂载时覆盖本人已存的有效清单偏好。

选择变化即时更新同一组资料的表现。偏好模块不持有或改变检索、排序、选中 ID、业务弹窗、真实数据或授权；首页不应按偏好 remount。详情开关仍由 HomePage 维护，不与显示设置争夺业务状态。

## 接入契约

目录：`frontends/portal/src/features/home/preferences/`。

```tsx
import { PreferencesButton, useHomePreferences } from './preferences';

const display = useHomePreferences({
  mode: verifiedIdentity ? 'real' : 'anonymous', // demo separately passes 'demo'
  identity: verifiedIdentity, // only issuer + subject
});
const preferences = display.preferences;
<PreferencesButton model={display} />;
```

一号的实际接线以真实会话 ready + identity 判断 account 范围，不把未确认账号当已登录。导出 `PreferenceControls` 供需要内嵌控件的宿主使用；`PreferencesButton` 提供贴近工作带的非模态面板，小屏结构重排。共用 Button / Radix Dialog 管理触发、Escape 和返回焦点，原生 radio/select/checkbox 管理选项；不引入依赖。

控件正文按共用 14px 尺度，状态与范围文字不低于 12px，标题继承共用 Dialog。样式仅在组件私有前缀内，使用共用 `--mc-*` token，未修改全局样式、品牌或首页文件。

## 保存内容与身份隔离

持久化只允许这个版本化结构：

```json
{
  "version": 1,
  "preferences": {
    "layout": "cards",
    "density": "comfortable",
    "groupBy": "none",
    "fields": { "owner": true, "instances": true, "createdAt": true }
  }
}
```

| 上下文 | 保存位置 | 生命周期 |
| --- | --- | --- |
| 已确认真实账号 | 当前 origin 的 localStorage，键名为固定前缀 + issuer/subject 的 SHA-256 | 刷新可读取本人已保存偏好 |
| 匿名 / 身份未确认 | 当前 hook 的内存 | 刷新、卸载、进入真实账号时不继承 |
| 演示 | 独立内存 | 刷新、退出演示或换上下文即重置，不读取真实账号记录 |

前缀为 `medcollab.home.display.v1.`，原始 issuer、subject 和展示用户名不写入键或值。账号键通过带边界的 JSON 编码后哈希，避免拼接碰撞；没有 Web Crypto 时不降级为全局键或原始账号键。

不保存医学资料名、对象 ID/列表、查询内容、文件名、邀请码、会话、CSRF、认证或工作台目的地。结构校验拒绝额外字段、未知枚举、非布尔值和超过 2048 字符的记录；编码时仍重新做白名单检查。快照及嵌套字段冻结，调用方不能通过引用修改共享默认值。

这里的隔离是键空间与上下文隔离，不是敏感信息加密保管，也不替代后端授权。浏览器存储按 origin（含协议、主机和端口）区分；开发端口与正式入口不会自动共用偏好，不承诺跨设备、跨浏览器或云端同步。

## 取消、迟到与恢复

- 每个上下文有独立 `PreferenceSession`，无全局账号缓存。Hook 在 render 时选择新 session 的快照，在 layout cleanup 中使旧 session 的异步工作失效，避免新账号先闪现旧账号设置。
- 哈希推导、StrictMode 重启、外部存储通知均受 generation/live 检查；旧账号卸载后的回调不能读写存储，旧的 update/reset 也不继续执行。
- 初始读取未完成时允许先改显示；用户已主动修改/恢复默认后，晚到记录不回填。最终使用当前可见的完整设置，而非稍后合并旧字段。
- 损坏 JSON、旧版/未来版本或不合约结构使用当前默认并标明恢复状态；不猜测迁移，不在读取时擅自覆盖/清除记录。用户明确更改后才写入当前白名单格式。
- 存储 getter/read/write 拒绝、额度不足、键推导失败都保留本页可用的显示选项，不记录或展示底层异常文本。
- 恢复默认只删除当前账号的那一个偏好键。若删除失败，尝试写入规范默认值；二者都失败时，本页仍恢复默认，但明确提示刷新可能重新载入旧设置，不能假报已保存。
- 同账号跨标签页变化会重新读取该账号的规范记录；其他账号键和其他 Storage 区域不应用。它是本机显示响应，不是业务实时同步。

## 实际检查

**模块测试 54 项通过**：

- 23 项 schema / 哈希：默认、false 值、额外字段、旧/未来版本、超长/损坏输入、白名单编码、不可变快照、issuer/subject 边界及无弱键回退。
- 22 项会话：账号/realm 隔离、匿名/演示无存储访问、宽 session 输入只保留两个身份字段、只清本人键、读取/写入/删除失败、重置回退、迟到推导、提前更改/重置、StrictMode 和外部通知。
- 9 项 React/真实 Radix 控件：即时更新、相邻检索/选择不重置、Escape 返回焦点、换账号立即默认和关闭旧控件、等价身份不重建、上下文隔离、StrictMode、失败反馈与卸载。

**独立浏览器 E2E 7 项通过**：即时效果、刷新/恢复默认、账号/realm/匿名/演示隔离、坏/旧记录、被禁用的 localStorage、同账号标签页、1440/768/390 的键盘和边界。该 E2E 使用独立组件验证页，所有身份和资料均为合成内容，不调用业务 API；不冒称正式首页全部集成行为已经验收。

`tsc --noEmit` 通过。未安装依赖，未构建 `dist`，未部署、提交或推送。已有 1 GiB 上传/构建修复与其他线程未提交改动未回退。

## 视觉证据与运行

组件验证页：
[http://127.0.0.1:5189/src/features/home/preferences/fixture.html](http://127.0.0.1:5189/src/features/home/preferences/fixture.html)。

它只是 dev 源文件验证入口，不是正式路由或新增产品页面，也没有作为 Vite 主入口加入生产构建。

首批三尺寸 × 四状态，集中统一私有字号/后备色后一次确认。确认图共 12 张，包括 default、changed、recovered、unavailable；已全部目视核对，自动尺寸检查无横向溢出、面板越界或低于 12px 的目标文字，未发现页面运行错误或业务请求。

路径：`frontends/portal/.runtime/ui-screens/preferences/confirm/`，包含 `1440-contact.jpg`、`768-contact.jpg`、`390-contact.jpg` 和 `verification.json`。图片只有组件合成验证材料，不是用户数据或正式首页最终图。

单次 Impeccable 检测给出 6 个 advisory（私有 13/18px 字号、警告后备色与共用规范不一致），已据此改为正文 14px、继承共用标题及规范警告色；未重复开启检测/打磨循环。整体首页截图、独立视觉审查、正式接线验证和最终统一构建由一号/root 完成。
