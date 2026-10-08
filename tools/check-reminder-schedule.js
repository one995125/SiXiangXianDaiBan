const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'cloudfunctions', 'sixiangReminder', 'index.js'), 'utf8')
const fakeDatabase = { command: { in: () => ({}) } }
const fakeCloud = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  database() { return fakeDatabase },
  getWXContext() { return { OPENID: 'test-openid' } },
}
const context = {
  require(name) {
    return name === 'wx-server-sdk' ? fakeCloud : require(name)
  },
  console,
  process: { env: {} },
  exports: {},
  module: { exports: {} },
}
context.module.exports = context.exports
vm.createContext(context)
vm.runInContext(source, context)

function schedule(record, nowText, mode = 'current') {
  return context.calculateNextSchedule(record, mode, Date.parse(nowText))
}

const oneTime = schedule({
  type: 'todo', status: 'pending', date: '2026-07-23', time: '', isAllDay: true,
  remindBeforeMinutes: 60, recurrenceType: 'none',
}, '2026-07-22T00:00:00Z')
assert.strictEqual(oneTime.ok, true)
assert.strictEqual(context.formatBeijingDateTime(oneTime.sendAt), '2026-07-23 08:00')

// 通知卡片中的“提醒时间”必须等于 sendAt，而不是事项实际发生时间 eventAt。
const oneTimeJob = context.buildReminderJob('test-openid', {
  id: 'record_one_time', title: '提前提醒测试', updatedAt: 1,
  type: 'todo', recurrenceType: 'none',
}, oneTime, {
  templateId: 'template-id', titleField: 'thing1', timeField: 'time2', typeField: 'thing3', tipField: 'thing5',
}, Date.now())
assert.strictEqual(oneTimeJob.messageData.time2.value, '2026-07-23 08:00')
assert.strictEqual(context.formatBeijingDateTime(oneTimeJob.eventAt), '2026-07-23 09:00')

const dailyNext = schedule({
  type: 'todo', status: 'pending', date: '2026-07-20', time: '09:00', isAllDay: false,
  remindBeforeMinutes: 60, recurrenceType: 'daily', checkinHistory: {},
}, '2026-07-22T00:30:00Z', 'next')
assert.strictEqual(dailyNext.occurrenceKey, '2026-07-23')

const weekly = schedule({
  type: 'todo', status: 'pending', date: '2026-07-20', time: '09:00', isAllDay: false,
  remindBeforeMinutes: 60, recurrenceType: 'weekly', weeklyDays: [1, 2, 3, 4, 5],
}, '2026-07-22T00:30:00Z')
assert.strictEqual(weekly.occurrenceKey, '2026-07-23')

const weeklyNext = schedule({
  type: 'todo', status: 'pending', date: '2026-07-20', time: '18:00', isAllDay: false,
  remindBeforeMinutes: 60, recurrenceType: 'weekly', weeklyDays: [3, 5],
}, '2026-07-22T01:00:00Z', 'next')
assert.strictEqual(weeklyNext.occurrenceKey, '2026-07-24')

const monthly = schedule({
  type: 'todo', status: 'pending', date: '2026-01-31', time: '09:00', isAllDay: false,
  remindBeforeMinutes: 60, recurrenceType: 'monthly',
}, '2026-02-01T00:00:00Z')
assert.strictEqual(monthly.occurrenceKey, '2026-02-28')

const monthlyNext = schedule({
  type: 'todo', status: 'pending', date: '2026-01-31', time: '09:00', isAllDay: false,
  remindBeforeMinutes: 60, recurrenceType: 'monthly',
}, '2026-02-28T00:30:00Z', 'next')
assert.strictEqual(monthlyNext.occurrenceKey, '2026-03-31')

const yearly = schedule({
  type: 'todo', status: 'pending', date: '2025-07-20', time: '09:00', isAllDay: false,
  remindBeforeMinutes: 60, recurrenceType: 'yearly',
}, '2026-07-22T00:00:00Z')
assert.strictEqual(yearly.occurrenceKey, '2027-07-20')

const yearlyNext = schedule({
  type: 'todo', status: 'pending', date: '2024-02-29', time: '09:00', isAllDay: false,
  remindBeforeMinutes: 60, recurrenceType: 'yearly',
}, '2026-02-28T01:00:00Z', 'next')
assert.strictEqual(yearlyNext.occurrenceKey, '2027-02-28')

const anniversary = schedule({
  type: 'anniversary', status: 'pending', date: '2020-07-20', time: '', isAllDay: true,
  remindBeforeMinutes: 1440, recurrenceType: 'none',
}, '2026-07-22T00:00:00Z')
assert.strictEqual(anniversary.occurrenceKey, '2027-07-20')
assert.strictEqual(context.formatBeijingDateTime(anniversary.sendAt), '2027-07-19 09:00')

const expiryAllDay = schedule({
  type: 'expiry', status: 'pending', date: '2026-07-23', time: '', isAllDay: true,
  remindBeforeMinutes: 60, recurrenceType: 'none',
}, '2026-07-22T00:00:00Z')
assert.strictEqual(context.formatBeijingDateTime(expiryAllDay.eventAt), '2026-07-23 09:00')
assert.strictEqual(context.formatBeijingDateTime(expiryAllDay.sendAt), '2026-07-23 08:00')

const passed = schedule({
  type: 'expiry', status: 'pending', date: '2026-07-21', time: '', isAllDay: true,
  remindBeforeMinutes: 60, recurrenceType: 'none',
}, '2026-07-22T00:00:00Z')
assert.strictEqual(passed.ok, false)
assert.strictEqual(passed.code, 'REMINDER_TIME_PASSED')

// 发送失败分类采用“错误码 + 文案特征”双重判断，兼容微信错误文案的细微变化。
const senderSource = fs.readFileSync(path.join(root, 'cloudfunctions', 'sixiangSendReminders', 'index.js'), 'utf8')
const senderDb = {
  command: {
    lte: () => ({}),
    gt: () => ({ and: () => ({}) }),
    in: () => ({}),
  },
}
const senderCloud = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  database() { return senderDb },
}
const senderContext = {
  require(name) {
    return name === 'wx-server-sdk' ? senderCloud : require(name)
  },
  Buffer,
  console,
  process: { env: {} },
  exports: {},
  module: { exports: {} },
}
senderContext.module.exports = senderContext.exports
vm.createContext(senderContext)
vm.runInContext(senderSource, senderContext)

assert.strictEqual(senderContext.classifySendFailure('43101', 'user refuse to accept').category, 'NO_SUBSCRIPTION_QUOTA')
assert.strictEqual(senderContext.classifySendFailure('40037', 'invalid template id').category, 'TEMPLATE_INVALID')
assert.strictEqual(senderContext.classifySendFailure('47003', 'value length too long').category, 'FIELD_TOO_LONG')
assert.strictEqual(senderContext.classifySendFailure('41030', 'invalid page path').category, 'PAGE_PATH_INVALID')
assert.strictEqual(senderContext.classifySendFailure('-1', 'network timeout').category, 'CLOUD_NETWORK_ERROR')
assert.strictEqual(senderContext.classifySendFailure('-1', 'network timeout').retryable, true)

// 页面接入契约：编辑重排，完成/删除/关闭取消，四个入口完成周期后均提供下一次续订。
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const formSource = read('miniprogram', 'pages', 'record-form', 'record-form.ts')
assert.match(formSource, /rescheduleWechatReminder\(record\.id\)/)
assert.match(formSource, /cancelWechatReminder\(record\.id\)/)
for (const page of ['today', 'checkins', 'calendar', 'record-detail']) {
  const pageSource = read('miniprogram', 'pages', page, `${page}.ts`)
  assert.match(pageSource, /cancelWechatReminder\(/, `${page} 缺少完成后的提醒取消`)
  assert.match(pageSource, /confirmWechatReminder\([^\n]+, 'next'\)/, `${page} 缺少下一次周期提醒续订`)
}

console.log('微信提醒专项检查通过：实际推送时间、日周月年续订、纪念日、效期、09:00、失败分类及页面接入契约。')
