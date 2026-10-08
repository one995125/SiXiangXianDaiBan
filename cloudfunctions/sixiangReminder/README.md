# 微信订阅提醒部署配置

`sixiangReminder`只负责登记、重排、取消和查询提醒；`sixiangSendReminders`通过每分钟定时触发器发送到期消息。

## 1. 公众平台模板

申请一个一次性订阅模板，内容包含“事项名称、提醒时间、事项类型、温馨提示”。审核通过后记录模板 ID 和平台分配的字段键，例如 `thing1`、`date2`、`phrase3`、`thing4`。

## 2. 云函数环境变量

在`sixiangReminder`中配置：

- `SIXIANG_REMINDER_TEMPLATE_ID`：模板 ID。
- `SIXIANG_REMINDER_TITLE_FIELD`：事项名称字段键。
- `SIXIANG_REMINDER_TIME_FIELD`：提醒时间字段键。
- `SIXIANG_REMINDER_TYPE_FIELD`：事项类型字段键。
- `SIXIANG_REMINDER_TIP_FIELD`：温馨提示字段键。

在`sixiangSendReminders`中可选配置：

- `SIXIANG_REMINDER_MINIPROGRAM_STATE`：`developer`、`trial`或`formal`，未配置时为`formal`。体验版真机测试应设置为`trial`。
- `SIXIANG_REMINDER_BACKLOG_THRESHOLD`：逾期积压告警阈值，默认20条。
- `SIXIANG_REMINDER_FAILURE_THRESHOLD`：最近1小时失败告警阈值，默认5条。
- `SIXIANG_REMINDER_OVERDUE_MINUTES`：超过计划发送时间多少分钟视为积压，默认5分钟。
- `SIXIANG_REMINDER_MAINTENANCE_TOKEN`：人工清理失败/过期测试任务时使用的维护口令，请使用随机长字符串且不要写入客户端。

## 3. 数据库

创建集合`sixiang_reminder_jobs`，将前端权限设为不可读、不可写，并建立以下索引：

- `status`升序 + `nextAttemptAt`升序。
- `openid`升序 + `recordId`升序 + `updatedAt`降序。
- `status`升序 + `leaseExpiresAt`升序。
- `purgeAt`升序。

数据库规则参考`cloudfunctions/database-rules/sixiang_reminder_jobs.json`。

## 4. 部署顺序

1. 部署`sixiangReminder`并上传依赖。
2. 部署`sixiangSendReminders`并上传依赖及定时触发器。
3. 确认`sixiangSendReminders`拥有`subscribeMessage.send`云调用权限。
4. 运行`npm run check:cloudbase`检查本地目录和配置。
5. 使用真机体验版授权并创建两分钟后到期的测试事项；开发者工具无法完整验证订阅授权与服务通知。

一次性订阅授权通常只允许发送一条消息。周期计划发送后不会自动续订，必须由用户再次点击授权。

## 5. 时间、失败分类与监测

- 通知卡片中的“提醒时间”展示实际推送时间`sendAt`。例如事项18:00、提前30分钟，卡片显示17:30。
- 发送失败会保留微信原始错误码，并写入`failureCategory`与`failureHint`。当前区分：无订阅额度、模板失效、字段超长、模板字段不匹配、页面路径错误、云端授权异常、接口频控、云端网络异常和未知错误。
- 定时函数每分钟返回`health`快照；出现积压或最近1小时连续失败时写入`health alert`警告日志。可在云函数日志中搜索该关键词快速定位。

## 6. 安全清理测试任务

清理入口位于`sixiangSendReminders`，只能删除`failed`和`expired`终态任务，并要求维护口令。建议先在云函数控制台预演：

```json
{
  "action": "cleanupTerminalJobs",
  "maintenanceToken": "与环境变量一致的随机口令",
  "statuses": ["failed", "expired"],
  "olderThanHours": 0,
  "dryRun": true
}
```

确认`matched`数量后将`dryRun`改为`false`。单次最多清理100条；返回`hasMore: true`时重复执行。待发送、发送中、已发送和已取消任务不会被该接口删除。
