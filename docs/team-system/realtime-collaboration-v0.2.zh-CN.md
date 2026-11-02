# 可靠掩码协作协议 v0.2

切片级自动编辑已在 [v0.3 增量协议](realtime-collaboration-v0.3.zh-CN.md) 实现。下文的整序列单写租约保留作旧客户端兼容说明；新版以 v0.3 的切片规则为准。

日期：2026-11-02。实现范围：单实例 Java 服务；同一数据集、同一序列单写多读；沿用现有单帧 CT 分割范围。

## 使用入口

重新构建并启动 Java、OHIF 和统一网关后，进入工作区，点击“开启实时协作”，展开保存栏并“申请编辑”。其余成员可实时观看；编辑者同步完成后“释放编辑权”。原设置开关默认仍关闭。

进入可靠协作的序列会有持久 `mask_rooms` 记录。此后旧版整量发布接口拒绝覆盖该序列；关闭前端开关不能绕过保护。开启前存在的私人草稿不会自动合入共享画布，可先导出，再确认加载共同画布。

## 原有协议的兼容边界

- 保留同源 `/ws/medcollab?datasetId=...&seriesId=...` 和 `{v:1,type,seq,ts,payload}` 外壳。
- 登录仍使用 Java `MEDICAL_DEMO_SESSION`；升级连接检查 Origin、数据集及团队权限，消息和广播再次检查会话与访问权限。
- `join/presence/ping/leave/room-state/activity/error` 继续使用。`join.payload.protocolVersion=2` 表示请求可靠协作能力；`room-state` 返回能力列表。
- v0.1 客户端可以接收在线状态；不把旧版 `segment-update` 当作正式保存。本版也不采用“每人绑定一个医学标签”，作者与标签分开记录。
- WebSocket 外壳 `seq` 只用于连接消息；正式操作的 `payload.seq` 是业务库中房间内连续提交的操作序号，两者不能混用。

## 消息

| 类型 | 内容 | 触发 |
|---|---|---|
| `presence` | 真实用户身份、当前标签、患者空间 `cursor.world=[x,y,z]` | 光标最多每 50ms 一次；另每 10s 心跳 |
| `members-state` | 聚合在线名单，同一账户多连接按 subject 合并 | 加入、退出、断线清理 |
| `stroke-preview` | 患者空间轨迹，最多 32 个点 | 绘制时最多每 50ms 一次；仅有效编辑者可发送 |
| `mask-committed` | 已提交的操作、作者、clientOpId、持久 seq | HTTP 事务提交成功后 |
| `lock-state` | 编辑权已变化的提示，接收者用 HTTP 读取自己的租约视图 | 申请、续租、释放 |
| `activity` | 最近操作提示 | 提交后，客户端最多保留 20 条 |

临时轨迹和光标在独立覆盖层绘制，不改真实像素；轨迹在正式操作到达或 2 秒后清理。正式操作不受临时消息是否送达影响。

## HTTP 接口

公共前缀：`/api/datasets/{datasetId}/segmentations/{seriesId}/collaboration`。写请求继续要求 CSRF；前端携带现有账户一致性头，切换账户后不能把旧队列作为新用户提交。

| 方法与路径 | 作用 |
|---|---|
| `GET /state?clientId=...` | 原子读取服务端物化掩码、对应 seq、归档 throughSeq、发布版本、租约和归档错误 |
| `GET /ops?clientId=...&after=N` | 按序补拉后续操作，每页最多 100 条，并返回高水位 |
| `POST /ops/batch` | 1–16 条操作；当前前端每批最多 4 条 |
| `POST /lease` | `{clientId,action:'acquire'}` 或 `{clientId,leaseId,action:'renew'/'release'}` |
| `POST /archive` | 请求后台生成固定水位的 SEG；返回排队确认，不等同归档成功 |

单条操作结构：

```json
{
  "clientOpId": "unique-operation-uuid",
  "baseSeq": 12,
  "segments": [{"number":1,"label":"心脏","color":[255,80,80]}],
  "masks": [{"instanceId":"authorized-orthanc-instance-id","runs":[512,20,1,900,5,0]}]
}
```

`runs` 是从 0 开始、按行排列的 `[start,length,newLabel,...]`。0 表示擦除。它表达体素变化，不依赖另一端重新运行画笔算法。实例必须属于当前已授权序列；本版源影像均为单帧，不假装支持多帧/MRI。

操作带完整当前标签定义；大片修改按游程拆分，最终操作才移除已删除标签的定义。单条 JSON ≤192KiB，一批 ≤1MiB。通过 `clientOpId + 房间` 唯一约束及作者、内容哈希去重，相同编号不同内容返回 409。

## 保存与恢复

1. 绘制立即更新本机像素。每约 400ms 提取修改；草稿、待发送操作和已排队的掩码状态在同一个 IndexedDB 记录内原子保存，事务成功后才发送。
2. Java 在短数据库事务中校验权限、编辑租约和 `baseSeq`，写 `mask_ops` 并更新 `mask_rooms` 的物化掩码；返回确认后广播。操作与序号共同提交，失败整批回滚。
3. 初次加入先订阅，再读取带 seq 的一致状态，期间收到的操作暂存。随后只按连续序号应用，重复消息忽略，乱序消息暂存。
4. 重连在现有掩码和游标上向前补拉。另每 3 秒补拉一次，修复“数据库提交成功后、广播前服务崩溃”的窗口。
5. 页面刷新会重新核对本机待发送编号是否已提交。没有他人修改时，可重新申请编辑权后继续发送；发现基线不一致时保留私人草稿并停止自动覆盖。

本版 Outbox 复用 `maskDrafts` IndexedDB 表，以草稿中的 `collaboration.pending` 保存，不增加 Dexie 依赖。账户、数据集、序列仍隔离；不在 IndexedDB 保存 Cookie、CSRF 或登录 Token。编辑租约编号只代表业务编辑权。

## 编辑租约

租约 30 秒，持有者每 10 秒续租。不同页面具有不同 clientId，同一用户也不能从另一页面抢占有效租约。过期后重新申请产生新 leaseId，旧 leaseId 不再能提交。Socket 在线状态不等于编辑权。

断线时，原编辑者可继续保存本机修改；重连后必须通过服务端租约和序号校验。租约已交给他人时，旧修改保留为私人草稿。会话失效和权限撤销后停止共享写入。

## SEG 归档

默认每 20 秒扫描到期修改，或累计 100 条操作后触发下一次扫描（扫描间隔 1 秒）。可通过 `app.collaboration.archive-ms`、`app.collaboration.archive-operations`、`app.collaboration.scan-ms` 配置。无修改不归档。

固定本次水位 H 和掩码后生成独立持久任务 `mask_snapshot_jobs`；编码、Orthanc 上传和读回校验在操作事务之外执行，上传期间新操作可继续提交。成功后用短事务登记新 SEG 版本及 `through_seq=H`，期间的新操作继续留在当前物化掩码中。失败不推进水位，保留操作并重试同一任务；已记录的上传结果直接复用。

`mask_ops` 不因归档而删除，快照版本不原地覆盖。上传成功但进程在记录 Orthanc ID 前崩溃，可能留下未登记对象；重试不会丢操作，但本版不宣称跨 Orthanc/数据库恰好一次，也不会自动删除疑似孤立影像。

## 部署和验证边界

- 统一 Node 网关已增加 `/ws/medcollab` Upgrade 转发，透传 Cookie 和 Origin，剥除伪造的转发身份头。部署到其他反向代理时也须配置 WebSocket Upgrade，并设置正确的 `APP_BASE_URL`。
- 当前房间目录和任务互斥适用于单 Java 实例；多实例部署还需共享广播及跨实例任务互斥，不能仅增加副本数。
- 单房间最多 32 个连接；单用户最多 8 个连接；每连接消息上限 60/s；超时及慢连接清理。
- 自动化覆盖真实登录会话的 WebSocket 握手、同房间广播、房间隔离、Origin/权限拒绝，以及操作幂等、序号回放、编辑权、体素擦除和固定水位归档。
- 自动化中的 DICOM 编码及 Orthanc 使用替身；真实影像的双浏览器绘制、MPR 光标位置、真实 Orthanc SEG 归档仍须在目标运行环境验收。
