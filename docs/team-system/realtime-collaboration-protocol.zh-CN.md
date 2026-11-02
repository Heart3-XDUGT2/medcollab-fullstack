# 工作区实时协作协议 v0.1

日期：2026-11-02。  
状态：**接口草案，前端已按此实现连接开关与在线状态；后端 WebSocket 房间尚未实现。**  
范围：OHIF 工作区的在线成员、正在编辑的标签、光标、活动流和按人分层的掩膜增量。  
非目标：不做同一体素的 CRDT/自动合并，不做评论/审核，不做历史回放。

## 1. 设计原则

1. **HTTP 仍是唯一真相**：草稿在 IndexedDB，发布走 `/publish-labelmap`，版本冲突走 HTTP。WebSocket 只传“正在发生什么”，不替代保存/发布。
2. **按人分层**：每个协作者绑定自己的 `segmentNumber` 和颜色，只能改自己的段；不同用户不抢同一体素。
3. **服务端鉴权**：连接必须复用 Java `MEDICAL_DEMO_SESSION`，校验数据集/团队访问权限；客户端消息里的 username/role 只作显示，不作授权。
4. **断线可恢复**：重连后重新拉 `/labelmap` 和 `/status`，不依赖 WebSocket 消息补齐；服务端不保存历史消息。
5. **默认关闭**：前端设置项 `medcollab:realtime:enabled` 默认 `false`；关闭时工作区保持现有“发布后同步 + 15 秒轮询”。

## 2. 连接

```text
wss://<same-origin>/ws/medcollab?datasetId=<id>&seriesId=<orthanc-series-id>
```

- 必须与 Portal/OHIF 同源，浏览器自动携带 `MEDICAL_DEMO_SESSION`。
- 不在 URL、query、localStorage 放 token、CSRF、密码或患者信息。
- 服务端校验：登录有效、issuer 匹配、当前用户仍是该数据集/团队的可访问成员。
- 拒绝连接用 WebSocket close code：
  - `4401` 未登录/会话过期
  - `4403` 无数据集权限
  - `4404` 数据集或序列不存在
  - `4429` 房间/连接数超限
- 房间键：`datasetId + seriesId`。同一用户多标签页视为多个连接，但显示时按 `subject` 合并。

## 3. 消息封装

所有业务消息使用 JSON 文本帧：

```ts
type Envelope<T = unknown> = {
  v: 1;
  type: string;
  seq: number;        // 客户端消息递增；服务端消息也带自己的 seq
  ts: string;         // ISO-8601
  payload: T;
};
```

服务端分配的成员身份：

```ts
type Member = {
  memberId: string;        // 连接级 ID，不作为权限依据
  subject: string;         // Keycloak subject
  username: string;
  role: 'leader' | 'uploader' | 'member';
  segmentNumber: number;   // 1–64，服务端分配/确认
  color: [number, number, number];
  online: boolean;
  activeSegment: number | null;
  activeLabel: string | null;
  cursor: { imageId: string; x: number; y: number } | null;
  lastSeen: string;
};
```

## 4. 客户端 → 服务端

### 4.1 `join`

```json
{
  "v": 1,
  "type": "join",
  "seq": 1,
  "ts": "2026-11-02T09:00:00Z",
  "payload": {
    "clientId": "uuid",
    "activeSegment": 1
  }
}
```

服务端确认身份、分配 `memberId`/颜色，返回 `room-state`。

### 4.2 `presence`

每 10 秒一次；切换切片/标签/工具时立即发。

```json
{
  "v": 1,
  "type": "presence",
  "seq": 2,
  "ts": "2026-11-02T09:00:10Z",
  "payload": {
    "activeSegment": 1,
    "activeLabel": "肺动脉",
    "cursor": { "imageId": "wadors:...", "x": 0.42, "y": 0.55 }
  }
}
```

`cursor` 的 `x/y` 是视口归一化坐标 0–1；没有光标时传 `null`。服务端 TTL 30 秒，超时标记离线。

### 4.3 `segment-update`

只允许更新自己的 `segmentNumber`。`runs` 与 HTTP Labelmap 一致：`[start,length,labelNumber,...]`。

```json
{
  "v": 1,
  "type": "segment-update",
  "seq": 3,
  "ts": "2026-11-02T09:00:12Z",
  "payload": {
    "segmentNumber": 1,
    "instanceId": "<orthanc-instance-id>",
    "runs": [512, 20, 1],
    "revision": 7
  }
}
```

- 前端 debounce 200–500ms，只发变化的切片，避免整序列刷屏。
- 单条消息 ≤ 256 KiB；超限拆片或降级为“仅状态”。
- 服务端校验 segment 归属、runs 合法性、instance 属于该系列；非法消息丢弃并回 `error`。
- 这是**临时协作层**，不落库；发布仍走 `POST /publish-labelmap`。

### 4.4 `leave` / `ping`

```json
{ "v": 1, "type": "leave", "seq": 4, "ts": "...", "payload": {} }
{ "v": 1, "type": "ping", "seq": 5, "ts": "...", "payload": {} }
```

关闭页面时尽力发送 `leave`；未送达由 TTL 清理。

## 5. 服务端 → 客户端

### 5.1 `room-state`

连接成功后发送完整快照：

```json
{
  "v": 1,
  "type": "room-state",
  "seq": 1,
  "ts": "...",
  "payload": {
    "self": { "memberId": "m-1", "segmentNumber": 1, "color": [20, 107, 93] },
    "members": [ { "subject": "...", "username": "张医生", "role": "leader", "segmentNumber": 1, "color": [20,107,93], "online": true, "activeSegment": 1, "activeLabel": "肺动脉", "cursor": null, "lastSeen": "..." } ],
    "segments": [ { "segmentNumber": 1, "ownerSubject": "...", "label": "肺动脉", "color": [20,107,93] } ]
  }
}
```

### 5.2 `presence`

```json
{
  "v": 1,
  "type": "presence",
  "seq": 2,
  "ts": "...",
  "payload": {
    "subject": "...",
    "username": "李医生",
    "online": true,
    "activeSegment": 2,
    "activeLabel": "支气管",
    "cursor": { "imageId": "wadors:...", "x": 0.51, "y": 0.62 },
    "lastSeen": "..."
  }
}
```

### 5.3 `segment-update`

```json
{
  "v": 1,
  "type": "segment-update",
  "seq": 3,
  "ts": "...",
  "payload": {
    "subject": "...",
    "username": "张医生",
    "segmentNumber": 1,
    "instanceId": "<orthanc-instance-id>",
    "runs": [512, 20, 1],
    "revision": 8
  }
}
```

前端本次只缓存并更新“正在编辑”状态；ghost 掩膜渲染作为下一阶段，不在本版启用。

### 5.4 `activity`

```json
{
  "v": 1,
  "type": "activity",
  "seq": 4,
  "ts": "...",
  "payload": {
    "id": "act-1",
    "subject": "...",
    "username": "张医生",
    "kind": "segment-update",
    "text": "更新了肺动脉掩膜",
    "at": "2026-11-02T09:00:12Z"
  }
}
```

服务端只广播最近活动，不做持久历史；前端最多保留 20 条。

### 5.5 `error`

```json
{
  "v": 1,
  "type": "error",
  "seq": 5,
  "ts": "...",
  "payload": { "code": "INVALID_SEGMENT", "message": "该标签不属于当前连接", "fatal": false }
}
```

`fatal=true` 时前端停止重连并显示错误；否则继续，仅提示。

## 6. 重连与关闭

- 前端使用指数退避：1s、2s、4s、8s、最多 30s；`navigator.onLine=false` 时暂停。
- 重连成功后重新 `join`，并以 HTTP `/labelmap`、`/status` 为准；不重放旧 WebSocket 消息。
- 关闭工作区/切换 dataset/series/账号时立即断开，不保留旧房间事件。
- 服务端成员 TTL 30s；断线超过 TTL 广播离线。
- 会话失效（401/close 4401）停止重连，提示重新登录；本机草稿保留。

## 7. 前端开关与配置

设置项：

```text
localStorage['medcollab:realtime:enabled'] = 'true' | 'false'
```

默认 `false`。关闭时：

- 不建立 WebSocket；
- 协作者仍是“可访问协作者”静态名单；
- 不显示在线绿点/正在编辑/活动流；
- 保存/发布逻辑完全不变。

开启时：

- 工作区就绪后连接；
- 连接失败显示“实时协作未连接”，不回退成假在线；
- 服务器未实现时保持静态名单，不影响保存/发布。

可选部署配置（由网关注入 `window.config`）：

```js
window.config.medcollabRealtime = {
  enabled: true,
  url: '/ws/medcollab', // 同源相对路径；不要放 token
};
```

未配置时默认使用同源 `/ws/medcollab`；功能开关仍以用户设置为准。

## 8. 后端实现建议

- 优先 Java WebSocket/STOMP：直接复用 Spring Security 会话与 `DatasetService` 权限检查。
- 房间状态放内存（`ConcurrentHashMap`），TTL 清理；不写数据库。
- 每个连接只允许一个 `segmentNumber`；切换标签需服务端确认。
- 消息大小、频率、连接数限制；拒绝跨数据集订阅。
- 不要把 Orthanc 地址、Cookie、CSRF、token 放进广播。
- 若先用 Node 网关实现，必须把 Java session 校验委托给 Java，不在网关自建身份。

## 9. 本版前端范围

- 设置项开关（默认关闭）。
- WebSocket 客户端、重连、join/presence/activity/segment-update 解析。
- 在线成员、正在编辑标签、活动流、连接状态。
- ghost 掩膜/光标渲染：协议已定义，下一阶段实现；本版不显示“实时掩膜”。
