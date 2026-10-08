const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const USER_DATA_COLLECTION = 'sixiang_user_data'
const REMINDER_COLLECTION = 'sixiang_reminder_jobs'
const LOG_TAG = '[sixiangReminder]'
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const MAX_LOOKAHEAD_DAYS = 740
const TERMINAL_RETENTION_MS = 30 * ONE_DAY_MS
const ACTIVE_STATUSES = ['pending', 'sending']
const SUPPORTED_TYPES = ['todo', 'anniversary', 'expiry']

/**
 * 微信提醒管理云函数。
 *
 * 客户端只提交 recordId 和操作意图；openid、记录内容、发生日期及发送时间均在服务端确认。
 * 模板字段由环境变量配置，避免客户端与公众平台模板字段漂移。
 */
exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const action = typeof event.action === 'string' ? event.action : ''

  console.info(`${LOG_TAG} request`, {
    action,
    hasOpenid: Boolean(openid),
  })

  try {
    if (action === 'getConfig') {
      return getConfig()
    }

    if (!openid) {
      return createError('NO_OPENID', '未获取到当前微信用户身份', '请从小程序端调用云函数，并检查 cloud.getWXContext().OPENID。')
    }

    if (action === 'getStatus') {
      return getStatus(openid, normalizeId(event.recordId))
    }

    if (action === 'register') {
      return registerReminder(openid, event)
    }

    if (action === 'reschedule') {
      return rescheduleReminder(openid, normalizeId(event.recordId))
    }

    if (action === 'cancel') {
      return cancelReminder(openid, normalizeId(event.recordId))
    }

    if (action === 'cancelAll') {
      return cancelAllReminders(openid)
    }

    return createError('INVALID_ACTION', '提醒操作不合法')
  } catch (error) {
    console.error(`${LOG_TAG} unhandled`, { action, ...createErrorLog(error) })
    return createDatabaseError('REMINDER_ACTION_FAILED', '微信提醒服务暂不可用', error)
  }
}

function getConfig() {
  const template = loadTemplateConfig()
  return {
    success: true,
    config: {
      enabled: template.enabled,
      templateId: template.enabled ? template.templateId : '',
      message: template.enabled ? '微信提醒可用' : '微信提醒暂未配置',
    },
  }
}

async function registerReminder(openid, event) {
  const recordId = normalizeId(event.recordId)
  const mode = event.mode === 'next' ? 'next' : 'current'
  if (!recordId) {
    return createError('INVALID_RECORD_ID', '缺少需要提醒的记录')
  }

  const template = loadTemplateConfig()
  if (!template.enabled) {
    return createError('TEMPLATE_NOT_CONFIGURED', '微信提醒暂未配置', '请配置 SIXIANG_REMINDER_TEMPLATE_ID 及四个模板字段环境变量。')
  }

  const recordResult = await loadOwnedRecord(openid, recordId)
  if (!recordResult.ok) {
    return recordResult.error
  }

  const activeJob = await findActiveJob(openid, recordId)
  const schedule = calculateNextSchedule(recordResult.record, mode, Date.now())
  if (!schedule.ok) {
    // 编辑后已没有可发送时间时，旧任务必须立即失效，不能继续展示或等待定时函数兜底。
    if (activeJob) {
      await markJobsCancelled([activeJob], schedule.code)
    }
    return createError(schedule.code, schedule.message)
  }

  const authorizationGranted = event.authorizationGranted === true
  if (!authorizationGranted && !activeJob) {
    return createError('AUTHORIZATION_REQUIRED', '需要先开启一次微信订阅授权')
  }

  // 授权时间只取服务端时钟；客户端只表达本次交互结果，不能指定授权时间。
  const authorizationGrantedAt = authorizationGranted ? Date.now() : activeJob.authorizationGrantedAt
  const job = buildReminderJob(openid, recordResult.record, schedule, template, authorizationGrantedAt)

  if (activeJob && activeJob._id !== job._id) {
    await markJobsCancelled([activeJob], 'RESCHEDULED')
  }

  // 文档 ID 已通过 doc(job._id) 指定；CloudBase 的 `_id` 是只读系统字段，
  // 不能再次放进 data 中写入，否则会抛出 -501007「不能更新 _id 的值」。
  const { _id: jobId, ...jobData } = job
  await db.collection(REMINDER_COLLECTION).doc(jobId).set({ data: jobData })
  console.info(`${LOG_TAG} registered`, {
    recordId,
    occurrenceKey: schedule.occurrenceKey,
    sendAt: schedule.sendAt,
  })

  return {
    success: true,
    status: toStatusView(job),
  }
}

async function rescheduleReminder(openid, recordId) {
  if (!recordId) {
    return createError('INVALID_RECORD_ID', '缺少需要更新的记录')
  }

  const activeJob = await findActiveJob(openid, recordId)
  if (!activeJob) {
    return createError('AUTHORIZATION_REQUIRED', '当前没有可复用的微信提醒授权')
  }

  return registerReminder(openid, {
    recordId,
    mode: 'current',
    authorizationGranted: false,
  })
}

async function getStatus(openid, recordId) {
  if (!recordId) {
    return {
      success: true,
      status: createEmptyStatus(),
    }
  }

  let jobs = []
  try {
    const result = await db.collection(REMINDER_COLLECTION)
      .where({ openid, recordId })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get()
    jobs = result.data || []
  } catch (error) {
    console.error(`${LOG_TAG} getStatus failed`, createErrorLog(error))
    return createDatabaseError('STATUS_QUERY_FAILED', '读取微信提醒状态失败', error)
  }

  return {
    success: true,
    status: jobs.length ? toStatusView(jobs[0]) : createEmptyStatus(),
  }
}

async function cancelReminder(openid, recordId) {
  if (!recordId) {
    return { success: true }
  }

  try {
    const result = await db.collection(REMINDER_COLLECTION)
      .where({ openid, recordId })
      .limit(100)
      .get()
    await markJobsCancelled((result.data || []).filter((job) => ACTIVE_STATUSES.includes(job.status)), 'USER_CANCELLED')
    return {
      success: true,
      status: {
        ...createEmptyStatus(),
        status: 'cancelled',
        statusText: '提醒已取消',
      },
    }
  } catch (error) {
    console.error(`${LOG_TAG} cancel failed`, createErrorLog(error))
    return createDatabaseError('CANCEL_FAILED', '取消微信提醒失败', error)
  }
}

async function cancelAllReminders(openid) {
  try {
    let removed = 0
    while (true) {
      const result = await db.collection(REMINDER_COLLECTION).where({ openid }).limit(100).get()
      const jobs = result.data || []
      if (!jobs.length) {
        break
      }
      await Promise.all(jobs.map((job) => db.collection(REMINDER_COLLECTION).doc(job._id).remove()))
      removed += jobs.length
      if (jobs.length < 100) {
        break
      }
    }
    return { success: true, removed }
  } catch (error) {
    console.error(`${LOG_TAG} cancelAll failed`, createErrorLog(error))
    return createDatabaseError('CANCEL_ALL_FAILED', '清空微信提醒失败', error)
  }
}

async function loadOwnedRecord(openid, recordId) {
  try {
    const result = await db.collection(USER_DATA_COLLECTION).doc(openid).get()
    const document = result && result.data ? result.data : null
    const records = document && Array.isArray(document.records) ? document.records : []
    const record = records.find((item) => item && item.id === recordId)
    if (!record || record.deletedAt) {
      return { ok: false, error: createError('RECORD_NOT_FOUND', '记录不存在或已删除') }
    }
    return { ok: true, record }
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ok: false, error: createError('RECORD_NOT_FOUND', '云端记录尚未同步，请稍后重试') }
    }
    return { ok: false, error: createDatabaseError('RECORD_QUERY_FAILED', '读取云端记录失败', error) }
  }
}

async function findActiveJob(openid, recordId) {
  const result = await db.collection(REMINDER_COLLECTION)
    // 与状态查询共用 openid + recordId + updatedAt 复合索引；
    // 终态任务会定期清理，取最近记录后在云函数内筛选即可避免额外的 status 复合索引。
    .where({ openid, recordId })
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get()
  const jobs = result.data || []
  return jobs.find((job) => ACTIVE_STATUSES.includes(job.status)) || null
}

async function markJobsCancelled(jobs, reason) {
  if (!jobs.length) {
    return
  }
  const now = Date.now()
  await Promise.all(jobs.map((job) => db.collection(REMINDER_COLLECTION).doc(job._id).update({
    data: {
      status: 'cancelled',
      terminalReason: reason,
      updatedAt: now,
      purgeAt: now + TERMINAL_RETENTION_MS,
    },
  })))
}

function buildReminderJob(openid, record, schedule, template, authorizationGrantedAt) {
  const now = Date.now()
  const idSource = `${openid}|${record.id}|${schedule.occurrenceKey}`
  const jobId = `reminder_${crypto.createHash('sha1').update(idSource).digest('hex')}`
  const title = truncateText(record.title, 20)
  const typeText = getRecordTypeText(record)
  const messageData = {}
  messageData[template.titleField] = { value: title }
  // 模板中的“提醒时间”必须展示微信实际尝试推送的时间，而不是事项截止时间。
  // 例如事项 18:00、提前 30 分钟提醒时，通知卡片应显示 17:30。
  messageData[template.timeField] = { value: formatBeijingDateTime(schedule.sendAt) }
  messageData[template.typeField] = { value: typeText }
  messageData[template.tipField] = { value: '点击查看详情' }

  return {
    _id: jobId,
    openid,
    recordId: record.id,
    occurrenceKey: schedule.occurrenceKey,
    recordType: record.type,
    recordUpdatedAt: normalizeTimestamp(record.updatedAt),
    templateId: template.templateId,
    messageData,
    pagePath: `pages/record-detail/record-detail?id=${encodeURIComponent(record.id)}&date=${schedule.occurrenceKey}`,
    eventAt: schedule.eventAt,
    sendAt: schedule.sendAt,
    nextAttemptAt: schedule.sendAt,
    status: 'pending',
    authorizationGrantedAt,
    attemptCount: 0,
    leaseExpiresAt: 0,
    sentAt: 0,
    lastErrorCode: '',
    lastErrorMessage: '',
    failureCategory: '',
    failureHint: '',
    terminalReason: '',
    purgeAt: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function calculateNextSchedule(record, mode, now) {
  if (!record || !SUPPORTED_TYPES.includes(record.type)) {
    return scheduleError('UNSUPPORTED_RECORD', '当前记录类型不支持微信提醒')
  }
  if (record.deletedAt || (record.recurrenceType === 'none' && record.status === 'done')) {
    return scheduleError('RECORD_FINISHED', '已完成或已删除的记录不能开启提醒')
  }

  const beforeMinutes = normalizeBeforeMinutes(record.remindBeforeMinutes)
  if (!beforeMinutes) {
    return scheduleError('REMINDER_DISABLED', '请先选择提前提醒时间')
  }

  const time = normalizeRecordTime(record)
  if (record.type === 'anniversary') {
    return calculateAnniversarySchedule(record, time, beforeMinutes, now)
  }
  if (record.type === 'todo' && record.recurrenceType && record.recurrenceType !== 'none') {
    return calculateRecurringSchedule(record, time, beforeMinutes, now, mode === 'next')
  }

  const eventAt = beijingDateTimeToTimestamp(record.date, time)
  const sendAt = eventAt - beforeMinutes * 60 * 1000
  if (!eventAt || sendAt <= now + 5000) {
    return scheduleError('REMINDER_TIME_PASSED', '提醒时间已错过，请调整日期或时间')
  }
  return {
    ok: true,
    occurrenceKey: record.date,
    eventAt,
    sendAt,
  }
}

function calculateAnniversarySchedule(record, time, beforeMinutes, now) {
  const source = parseDateText(record.date)
  if (!source) {
    return scheduleError('INVALID_DATE', '纪念日日期不正确')
  }
  const current = getBeijingDateParts(now)
  for (let year = Math.max(current.year, source.year); year <= current.year + 2; year += 1) {
    const day = Math.min(source.day, daysInMonth(year, source.month))
    const dateText = formatDateParts(year, source.month, day)
    const eventAt = beijingDateTimeToTimestamp(dateText, time)
    const sendAt = eventAt - beforeMinutes * 60 * 1000
    if (sendAt > now + 5000) {
      return { ok: true, occurrenceKey: dateText, eventAt, sendAt }
    }
  }
  return scheduleError('NO_FUTURE_OCCURRENCE', '没有找到可提醒的下一次纪念日')
}

function calculateRecurringSchedule(record, time, beforeMinutes, now, nextOnly) {
  const start = parseDateText(record.date)
  if (!start) {
    return scheduleError('INVALID_DATE', '周期计划开始日期不正确')
  }
  const today = getBeijingDateParts(now)
  const todaySerial = datePartsToSerial(today)
  const searchStart = nextOnly ? todaySerial + 1 : todaySerial

  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    const candidate = serialToDateParts(searchStart + offset)
    const dateText = formatDateParts(candidate.year, candidate.month, candidate.day)
    if (dateText < record.date || !isRecurringDueOnDate(record, candidate, start)) {
      continue
    }
    const eventAt = beijingDateTimeToTimestamp(dateText, time)
    const sendAt = eventAt - beforeMinutes * 60 * 1000
    if (sendAt > now + 5000) {
      return { ok: true, occurrenceKey: dateText, eventAt, sendAt }
    }
  }
  return scheduleError('NO_FUTURE_OCCURRENCE', '没有找到可提醒的下一次计划')
}

function isRecurringDueOnDate(record, candidate, start) {
  const type = record.recurrenceType
  if (type === 'daily') {
    return true
  }
  if (type === 'weekly') {
    const days = Array.isArray(record.weeklyDays) ? record.weeklyDays.map(Number) : []
    return days.includes(getWeekday(candidate))
  }
  if (type === 'monthly') {
    return candidate.day === Math.min(start.day, daysInMonth(candidate.year, candidate.month))
  }
  if (type === 'yearly') {
    return candidate.month === start.month && candidate.day === Math.min(start.day, daysInMonth(candidate.year, candidate.month))
  }
  return false
}

function loadTemplateConfig() {
  const templateId = normalizeEnv(process.env.SIXIANG_REMINDER_TEMPLATE_ID)
  const titleField = normalizeTemplateField(process.env.SIXIANG_REMINDER_TITLE_FIELD)
  const timeField = normalizeTemplateField(process.env.SIXIANG_REMINDER_TIME_FIELD)
  const typeField = normalizeTemplateField(process.env.SIXIANG_REMINDER_TYPE_FIELD)
  const tipField = normalizeTemplateField(process.env.SIXIANG_REMINDER_TIP_FIELD)
  return {
    enabled: Boolean(templateId && titleField && timeField && typeField && tipField),
    templateId,
    titleField,
    timeField,
    typeField,
    tipField,
  }
}

function normalizeTemplateField(value) {
  const field = normalizeEnv(value)
  return /^[a-z_]+\d+$/i.test(field) ? field : ''
}

function normalizeEnv(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeId(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : ''
}

function normalizeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function normalizeBeforeMinutes(value) {
  const allowed = [30, 60, 1440, 4320, 10080]
  const number = Number(value)
  return allowed.includes(number) ? number : 0
}

function normalizeRecordTime(record) {
  if (record.isAllDay || !/^\d{2}:\d{2}$/.test(record.time || '')) {
    return '09:00'
  }
  return record.time
}

function parseDateText(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null
  }
  return { year, month, day }
}

function beijingDateTimeToTimestamp(dateText, timeText) {
  const date = parseDateText(dateText)
  if (!date || !/^\d{2}:\d{2}$/.test(timeText)) {
    return 0
  }
  const [hour, minute] = timeText.split(':').map(Number)
  if (hour > 23 || minute > 59) {
    return 0
  }
  return Date.UTC(date.year, date.month - 1, date.day, hour - 8, minute, 0, 0)
}

function getBeijingDateParts(timestamp) {
  const date = new Date(timestamp + BEIJING_OFFSET_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function datePartsToSerial(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / ONE_DAY_MS)
}

function serialToDateParts(serial) {
  const date = new Date(serial * ONE_DAY_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function getWeekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatBeijingDateTime(timestamp) {
  const date = new Date(timestamp + BEIJING_OFFSET_MS)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function getRecordTypeText(record) {
  if (record.type === 'anniversary') {
    return '纪念日'
  }
  if (record.type === 'expiry') {
    return '到期提醒'
  }
  return record.recurrenceType && record.recurrenceType !== 'none' ? '周期计划' : '待办'
}

function truncateText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : ''
  return Array.from(text).slice(0, maxLength).join('') || '待办事项'
}

function toStatusView(job) {
  const statusTextMap = {
    pending: `将在 ${formatStatusDateTime(job.sendAt)} 提醒`,
    sending: '微信提醒正在发送',
    sent: '提醒已发送',
    cancelled: '提醒已取消',
    failed: getFailureStatusText(job.failureCategory),
    expired: '提醒时间已错过',
  }
  return {
    status: job.status,
    statusText: statusTextMap[job.status] || '微信提醒未开启',
    sendAt: normalizeTimestamp(job.sendAt),
    sendAtText: job.sendAt ? formatBeijingDateTime(job.sendAt) : '',
    hasActiveAuthorization: ACTIVE_STATUSES.includes(job.status),
    canActivate: !ACTIVE_STATUSES.includes(job.status),
    errorCode: typeof job.lastErrorCode === 'string' ? job.lastErrorCode : '',
    errorCategory: typeof job.failureCategory === 'string' ? job.failureCategory : '',
    errorHint: typeof job.failureHint === 'string' ? job.failureHint : '',
  }
}

function getFailureStatusText(category) {
  const textMap = {
    NO_SUBSCRIPTION_QUOTA: '订阅额度已用完，请重新开启提醒',
    TEMPLATE_INVALID: '提醒模板失效，请稍后再试',
    FIELD_TOO_LONG: '提醒内容过长，请缩短标题后重试',
    MESSAGE_DATA_INVALID: '提醒内容格式不匹配，请稍后再试',
    PAGE_PATH_INVALID: '提醒跳转页面异常，请稍后再试',
    CLOUD_AUTH_ERROR: '云端授权异常，请稍后再试',
    CLOUD_NETWORK_ERROR: '云端网络异常，请重新开启提醒',
    RATE_LIMITED: '提醒发送繁忙，请稍后再试',
  }
  return textMap[category] || '提醒未能发送，点击重新开启'
}

function createEmptyStatus() {
  return {
    status: 'none',
    statusText: '微信提醒未开启',
    sendAt: 0,
    sendAtText: '',
    hasActiveAuthorization: false,
    canActivate: true,
    errorCode: '',
    errorCategory: '',
    errorHint: '',
  }
}

function formatStatusDateTime(timestamp) {
  const date = new Date(timestamp + BEIJING_OFFSET_MS)
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function scheduleError(code, message) {
  return { ok: false, code, message }
}

function createError(code, message, debug = '') {
  return { success: false, code, message, debug }
}

function createDatabaseError(code, message, error) {
  return createError(code, message, getErrorText(error))
}

function createErrorLog(error) {
  return {
    message: getErrorText(error),
    code: error && error.errCode ? error.errCode : error && error.code ? error.code : '',
  }
}

function getErrorText(error) {
  if (error && typeof error.message === 'string') {
    return error.message
  }
  if (error && typeof error.errMsg === 'string') {
    return error.errMsg
  }
  return String(error || '')
}

function isNotFoundError(error) {
  const text = getErrorText(error).toLowerCase()
  return text.includes('not found') || text.includes('does not exist') || text.includes('-502005')
}
