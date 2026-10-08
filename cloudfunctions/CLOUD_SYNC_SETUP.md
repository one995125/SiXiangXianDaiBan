# 记得微信登录与云端保存部署说明

## 当前云端资源

云开发环境 ID：`cloud1-d4gfatip0edd01506`，对应前端配置在 `miniprogram/services/cloud-service.ts`。

必须部署的云函数：

- `sixiangLogin`：微信登录态确认，返回当前调用者 `openid/appid/unionid`。
- `sixiangSyncUserData`：同步全部持久化用户业务资料到 `sixiang_user_data`，包括礼金礼簿及旧版本遗留数据。
- `sixiangGetProfile`：读取当前用户昵称和头像资料。
- `sixiangUpdateProfile`：写入当前用户昵称和头像资料。

可选云函数：

- `sixiangDecryptWeRunData`：微信运动步数解密；不影响登录和记录云同步。
- `sixiangAdminStats`：管理员只读统计用户数和操作摘要；不接入前端页面，只建议在云函数云端测试中使用。

必须创建的集合：

- `sixiang_user_data`：用户业务数据快照，每个 `openid` 一条文档，文档 `_id` 使用 `OPENID`。
- `sixiang_users`：用户资料，每个 `openid` 一条文档，保存 `nickName/avatarUrl/updatedAt`。

集合建议规则都设置为：

```json
{
  "read": false,
  "write": false
}
```

规则文件位于：

- `cloudfunctions/database-rules/sixiang_user_data.json`
- `cloudfunctions/database-rules/sixiang_users.json`

这些规则会阻止小程序前端直连读写用户数据；真实读写都通过云函数服务端身份执行，云函数内部使用 `cloud.getWXContext().OPENID` 做用户隔离。

## 部署步骤

1. 在微信开发者工具打开项目根目录，确认 `project.config.json` 的 `cloudfunctionRoot` 是 `cloudfunctions/`。
2. 确认云开发环境为 `cloud1-d4gfatip0edd01506`。
3. 在云开发数据库中创建 `sixiang_user_data` 和 `sixiang_users` 两个集合。
   最新云函数会在首次访问时尝试自动创建缺失集合，但手动提前创建更直观，也方便立刻配置安全规则。
4. 给两个集合应用上面的安全规则，或在控制台选择“仅管理端可读写”。
5. 右键以下云函数目录，逐个选择“上传并部署：云端安装依赖”：
   - `cloudfunctions/sixiangLogin`
   - `cloudfunctions/sixiangSyncUserData`
   - `cloudfunctions/sixiangGetProfile`
   - `cloudfunctions/sixiangUpdateProfile`
6. 如果还要使用微信运动，再部署 `cloudfunctions/sixiangDecryptWeRunData`。
7. 如果要查看用户统计，再部署 `cloudfunctions/sixiangAdminStats`，并在云函数环境变量里配置至少一种管理员凭据：
   - `SIXIANG_ADMIN_OPENIDS`：你的管理员 openid，多个用英文逗号分隔。
   - `SIXIANG_ADMIN_SECRET`：仅用于云函数“云端测试”的临时密钥，建议使用足够长的随机字符串。
8. 在微信开发者工具清缓存并重新编译，进入“我的”页点击“重试上传/重新检查”。

## 本地检查

提交或部署前先运行：

```bash
npm run check:cloudbase
```

该命令会检查：

- `project.config.json` 是否指向 `cloudfunctions/`。
- `CLOUD_ENV_ID` 是否存在。
- 必要云函数是否包含 `index.js/package.json/config.json`。
- 云函数是否声明 `wx-server-sdk`。
- 云函数 `index.js` 是否通过 Node 语法检查。
- 两个用户集合规则文件是否存在且禁止前端直连读写。

注意：本地检查不能确认云函数已经部署到微信云端。截图里的 `CLOUD_FUNCTION_NOT_DEPLOYED` 需要在微信开发者工具完成云端部署后才会消失。

## 数据结构

`sixiang_user_data` 示例：

```json
{
  "_id": "用户 OPENID",
  "openid": "用户 OPENID",
  "schemaVersion": 7,
  "revision": 1,
  "records": [],
  "categoryHistory": {
    "todo": [],
    "anniversary": [],
    "expiry": [],
    "note": []
  },
  "giftBook": {
    "contacts": [],
    "deletedGiftIds": [],
    "updatedAt": 1710000000000
  },
  "giftExchanges": {
    "contacts": [],
    "migratedGiftIds": [],
    "deletedRecordIds": [],
    "updatedAt": 1710000000000
  },
  "moodRecords": [],
  "onboardingState": null,
  "growthUnlockPromptAt": 0,
  "legacyData": {
    "todayTasks": [],
    "scoreState": null,
    "petState": null,
    "exerciseRewardState": null,
    "weRunState": null
  },
  "createdAt": 1710000000000,
  "updatedAt": 1710000000000
}
```

`sixiang_users` 示例：

```json
{
  "_id": "用户 OPENID",
  "openid": "用户 OPENID",
  "nickName": "用户填写的微信名",
  "avatarUrl": "cloud://.../sixiang/users/用户 OPENID/avatar/avatar-1710000000000.jpg",
  "updatedAt": 1710000000000
}
```

## 同步策略

- 启动时先执行 `wx.login` 和 `sixiangLogin`，再通过 `sixiangSyncUserData` 拉取或上传当前 `openid` 的业务快照。
- 当前有效业务数据包括：记录与打卡历史、自定义分类、礼金礼簿、礼尚往来、心情记录、家庭兼容状态、小暖状态、引导状态、成长提示状态和服务端成长状态。
- 老版本曾产生的今日任务、积分、旧宠物、运动奖励和微信步数结果会归档迁移，避免升级或换机后消失。
- 昵称、头像单独保存在 `sixiang_users`，头像文件位于 `sixiang/users/{openid}/avatar/`；资料写入失败时客户端保留待上传副本，下次进入“我的”页补传。
- 微信提醒任务单独保存在 `sixiang_reminder_jobs`，业务记录仍以 `sixiang_user_data` 为准。
- 登录 code、启动日志、云同步元数据、模板缓存和本机待授权队列属于设备级运行数据，不上传为用户业务数据。
- 微信运动仅同步用户可见的步数、日期、目标和状态；`encryptedData`、`iv`、`cloudID`、`sessionKey` 等一次性凭证在客户端和云函数两侧都会过滤。
- 业务数据先写本地 storage；云端失败不会影响当前操作，失败会保留 `dirtyAt`，后续可手动重试。
- 新设备必须先成功拉取当前 `openid` 的云端基线，之后才允许上传；拉取失败时不生成示例，也不允许空快照覆盖云端。
- 同一账号在另一设备产生了更新且当前设备也有离线改动时，启动同步会先合并再上传；礼簿使用整本 `updatedAt` 选择较新版本，以正确保留删除结果。
- schema 7 客户端每次上传必须携带最近一次拉取到的 `baseRevision`；云函数在事务中校验版本并递增 `revision`。版本冲突时不会写库，客户端会重新拉取、合并并限次重试。
- 礼簿和往来记录按条目 `id + updatedAt` 合并，并保存有限数量的删除 ID，确保两台设备并发新增都能保留、已删除条目不会在合并时复活。
- schema 6 旧客户端没有 `baseRevision`，发布过渡期由下述兼容层接管；schema 7 客户端的版本校验和 `SYNC_CONFLICT` 行为不变。
- `openid` 变化时，直接切换到当前账号云端快照，避免上一账号数据串号。
- 旧设备中尚未上传的数据只能在用户打开已更新的小程序后迁移；云端无法远程读取一台从未再次打开小程序的手机本地 storage。
- “清空本地与云端数据”会上传空业务快照覆盖 `sixiang_user_data`，但不会删除 `sixiang_users` 中的昵称和头像资料。

### schema 6→7 兼容层

- `sixiangSyncUserData` 以 `baseRevision` 是否为有效非负整数区分协议：有效值按 schema 7 乐观锁流程处理；缺失或非法值按 schema 6 旧协议处理。
- 旧协议仍执行与新协议相同的数据清洗、敏感键过滤、记录数量与快照大小限制；校验失败继续返回 `INVALID_DATA` 或 `PAYLOAD_TOO_LARGE`。
- 旧协议在事务内读取当前文档，不比较版本，按 last-write-wins 写入；现有文档没有 `revision` 时按 `1` 起算，成功写入后递增并统一保存为 `schemaVersion: 7`。
- 旧快照没有提供的同步字段继续沿用云端值，避免旧设备覆盖 schema 7 新增字段；成长状态继续使用现有派生和补全逻辑。
- 旧协议写入成功时响应包含 `legacyPush: true`，云函数同时输出 `legacy schema-6 push` 警告日志，只记录 `openid` 前 8 位用于脱敏观察。
- 上线后持续观察 1–2 周旧协议日志和 `legacyPush` 使用情况；确认旧客户端残留量已降至可接受范围，再单独评审关闭兼容路径。关闭前不要直接恢复 `CLIENT_UPGRADE_REQUIRED` 拒绝逻辑。

## 管理员统计

`sixiangAdminStats` 只读查询 `sixiang_users` 和 `sixiang_user_data`：

- 可以看到总用户数、已保存资料用户数、已有业务数据用户数。
- 可以看到从当前快照推断出的操作摘要：创建待办、创建纪念日、创建效期提醒、记录便签、创建周期目标、完成记录或打卡、维护礼簿、记录收送礼、记录心情。
- 不返回完整 `openid`、记录标题、备注、头像文件 ID 等原始内容，只返回脱敏 openid 和计数。
- 这不是行为埋点日志，不能还原用户每一次点击和完整时间线。

云端测试示例：

```json
{
  "adminSecret": "填入 SIXIANG_ADMIN_SECRET",
  "limit": 50
}
```

如果使用 `SIXIANG_ADMIN_OPENIDS` 授权，管理员本人从小程序端调用时可以不传 `adminSecret`；但当前版本没有把这个函数接到前端页面，建议只在微信开发者工具云函数测试面板里使用。

## 调试方式

- 小程序 Console 搜索 `[sixiangSyncUserData]` 查看前端调用、错误码和 debug hint。
- 云函数日志搜索 `[sixiangSyncUserData]` 查看同步函数请求和数据库错误。
- 用户资料读写分别搜索 `[sixiangGetProfile]`、`[sixiangUpdateProfile]`。
- 管理员统计搜索 `[sixiangAdminStats]`，如果返回 `ADMIN_NOT_CONFIGURED`，先配置管理员环境变量。
- 如果提示 `CLOUD_FUNCTION_NOT_DEPLOYED`，优先确认对应云函数已经在当前环境部署，而不是只存在于本地目录。
- 如果提示 `COLLECTION_NOT_READY`，确认集合已创建且环境 ID 一致；也可以重新部署最新的 `sixiangSyncUserData/sixiangGetProfile/sixiangUpdateProfile`，让云函数首次访问时尝试自动创建缺失集合。
- 如果提示 `COLLECTION_PERMISSION_DENIED`，确认集合规则没有阻止云函数服务端读写。

## 合规提醒

记录标题、备注、日期、礼簿联系人、礼物备注、心情文本及微信运动结果属于用户数据，应在小程序隐私保护指引中说明用途为“跨设备同步生活提醒、礼簿、心情和用户选择同步的运动结果”。前端不展示 `openid`，也不直接写数据库；所有用户数据读写都通过云函数按 `openid` 隔离。正式发布前需同步更新小程序隐私保护指引中的数据类型、用途和保存范围。
