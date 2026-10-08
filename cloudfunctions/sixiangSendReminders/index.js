const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const _ = db.command
const USER_DATA_COLLECTION = 'sixiang_user_data'
const REMINDER_COLLECTION = 'sixiang_reminder_jobs'
const LOG_TAG = '[sixiangSendReminders]'
const BATCH_SIZE = 100
const SEND_GRACE_MS = 30 * 60 * 1000
const LEASE_MS = 2 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const TERMINAL_RETENTION_MS = 30 * ONE_DAY_MS
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]
const MONITOR_WINDOW_MS = 60 * 60 * 1000
const DEFAULT_BACKLOG_THRESHOLD = 20
const DEFAULT_FAILURE_THRESHOLD = 5
const DEFAULT_OVERDUE_MINUTES = 5
const CLEANABLE_STATUSES = ['failed', 'expired']

/**
 * 每分钟定时发送到期提醒。
 *
 * 注意：函数只消费由 sixiangReminder 创建的任务，发送前还会重新读取业务快照；
 * 即使客户端取消请求失败，已完成、已删除或已修改的记录也不会继续发送旧消息。
 */
exports.main = async (event = {}) => {
  const startedAt = Date.now()
  if (event.action === 'cleanupTerminalJobs') {
    return runProtectedCleanup(event, startedAt)
  }

  const summary = {
    recovered: 0,
    scanned: 0,
    sent: 0,
    cancelled: 0,
    expired: 0,
    retried: 0,
    failed: 0,
    cleaned: 0,
    failureCategories: {},
  }

  try {
    summary.recovered = await recoverExpiredLeases(startedAt)
    summary.cleaned = await cleanupTerminalJobs(startedAt)

    const result = await db.collection(REMINDER_COLLECTION)
      .where({
        status: 'pending',
        nextAttemptAt: _.lte(startedAt),
      })
      .orderBy('nextAttemptAt', 'asc')
      .limit(BATCH_SIZE)
      .get()
    const jobs = result.data || []
    summary.scanned = jobs.length

    for (const job of jobs) {
      const result = await processJob(job._id, startedAt)
      const outcome = typeof result === 'string' ? result : result.outcome
      if (Object.prototype.hasOwnProperty.call(summary, outcome) && typeof summary[outcome] === 'number') {
        summary[outcome] += 1
      }
      if (result && typeof result === 'object' && result.category) {
        summary.failureCategories[result.category] = Number(summary.failureCategories[result.category] || 0) + 1
      }
    }

    const health = await buildHealthSnapshot(startedAt)
    if (!health.healthy) {
      console.warn(`${LOG_TAG} health alert`, health)
    }
    console.info(`${LOG_TAG} completed`, { ...summary, health })
    return { success: true, summary, health }
  } catch (error) {
    console.error(`${LOG_TAG} failed`, createErrorLog(error))
    return {
      success: false,
      code: 'REMINDER_DISPATCH_FAILED',
      message: '定时发送微信提醒失败',
      debug: getErrorText(error),
      summary,
    }
  }
}

async function processJob(jobId, now) {
  const job = await acquireJob(jobId, now)
  if (!job) {
    return 'cancelled'
  }

  if (now - job.sendAt > SEND_GRACE_MS) {
    await markTerminal(job, 'expired', 'SEND_WINDOW_EXPIRED', '提醒已超过允许发送时间')
    return 'expired'
  }

  const validation = await validateJobAgainstRecord(job)
  if (!validation.ok) {
    await markTerminal(job, 'cancelled', validation.code, validation.message)
    return 'cancelled'
  }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: job.openid,
      page: job.pagePath,
      data: job.messageData,
      templateId: job.templateId,
      miniprogramState: normalizeMiniprogramState(process.env.SIXIANG_REMINDER_MINIPROGRAM_STATE),
      lang: 'zh_CN',
    })
    const sentAt = Date.now()
    await updateClaimedJob(job, {
      status: 'sent',
      sentAt,
      leaseExpiresAt: 0,
      updatedAt: sentAt,
      purgeAt: sentAt + TERMINAL_RETENTION_MS,
    })
    return 'sent'
  } catch (error) {
    return handleSendFailure(job, error)
  }
}

async function acquireJob(jobId, now) {
  try {
    return await db.runTransaction(async (transaction) => {
      const result = await transaction.collection(REMINDER_COLLECTION).doc(jobId).get()
      const job = result && result.data ? result.data : null
      if (!job || job.status !== 'pending' || Number(job.nextAttemptAt || 0) > now) {
        return null
      }

      await transaction.collection(REMINDER_COLLECTION).doc(jobId).update({
        data: {
          status: 'sending',
          leaseExpiresAt: now + LEASE_MS,
          updatedAt: now,
        },
      })
      return { ...job, status: 'sending', leaseExpiresAt: now + LEASE_MS }
    })
  } catch (error) {
    console.warn(`${LOG_TAG} acquire skipped`, { jobId, error: getErrorText(error) })
    return null
  }
}

async function validateJobAgainstRecord(job) {
  if (!job.openid || !job.recordId || !job.occurrenceKey) {
    return invalid('INVALID_JOB', '提醒任务字段不完整')
  }

  let document
  try {
    const result = await db.collection(USER_DATA_COLLECTION).doc(job.openid).get()
    document = result && result.data ? result.data : null
  } catch (error) {
    if (isNotFoundError(error)) {
      return invalid('USER_DATA_NOT_FOUND', '用户业务数据不存在')
    }
    throw error
  }

  const records = document && Array.isArray(document.records) ? document.records : []
  const record = records.find((item) => item && item.id === job.recordId)
  if (!record || record.deletedAt) {
    return invalid('RECORD_NOT_FOUND', '记录不存在或已删除')
  }
  if (Number(record.updatedAt || 0) !== Number(job.recordUpdatedAt || 0)) {
    return invalid('RECORD_CHANGED', '记录已修改，旧提醒已失效')
  }
  if (![30, 60, 1440, 4320, 10080].includes(Number(record.remindBeforeMinutes))) {
    return invalid('REMINDER_DISABLED', '记录已关闭提醒')
  }

  const isRecurring = record.type === 'todo' && record.recurrenceType && record.recurrenceType !== 'none'
  if (isRecurring) {
    const history = record.checkinHistory && typeof record.checkinHistory === 'object' ? record.checkinHistory : {}
    const entry = history[`day:${job.occurrenceKey}`]
    if (entry && Number(entry.actualCount || 0) >= 1) {
      return invalid('OCCURRENCE_COMPLETED', '该周期发生项已经完成')
    }
  } else if (record.status === 'done') {
    return invalid('RECORD_COMPLETED', '记录已经完成')
  }

  return { ok: true }
}

async function handleSendFailure(job, error) {
  const errorCode = getErrorCode(error)
  const errorMessage = getErrorText(error) || '订阅消息发送失败'
  const attemptCount = Number(job.attemptCount || 0) + 1
  const failure = classifySendFailure(errorCode, errorMessage)
  const retryable = failure.retryable

  console.warn(`${LOG_TAG} send failed`, {
    jobId: job._id,
    recordId: job.recordId,
    errorCode,
    errorMessage,
    attemptCount,
    retryable,
    failureCategory: failure.category,
  })

  // 首次发送失败后最多再尝试 3 次，间隔分别为 1、5、15 分钟。
  if (retryable && attemptCount <= RETRY_DELAYS_MS.length) {
    const now = Date.now()
    await updateClaimedJob(job, {
      status: 'pending',
      attemptCount,
      nextAttemptAt: now + RETRY_DELAYS_MS[attemptCount - 1],
      leaseExpiresAt: 0,
      lastErrorCode: errorCode,
      lastErrorMessage: truncateText(errorMessage, 200),
      failureCategory: failure.category,
      failureHint: failure.hint,
      updatedAt: now,
    })
    return { outcome: 'retried', category: failure.category }
  }

  await markTerminal(
    job,
    'failed',
    errorCode || 'SEND_FAILED',
    errorMessage,
    attemptCount,
    failure.category,
    failure.hint,
  )
  return { outcome: 'failed', category: failure.category }
}

async function markTerminal(
  job,
  status,
  errorCode,
  errorMessage,
  attemptCount = Number(job.attemptCount || 0),
  failureCategory = '',
  failureHint = '',
) {
  const now = Date.now()
  await updateClaimedJob(job, {
    status,
    attemptCount,
    leaseExpiresAt: 0,
    lastErrorCode: truncateText(errorCode, 80),
    lastErrorMessage: truncateText(errorMessage, 200),
    failureCategory,
    failureHint,
    updatedAt: now,
    purgeAt: now + TERMINAL_RETENTION_MS,
  })
}

/**
 * 仅更新本次租约实际占有的任务。
 * 用户在发送过程中编辑记录时，管理函数可能已经把同一个任务重排为 pending；
 * 这里再次核对状态、租约和记录版本，避免旧发送进程覆盖新任务。
 */
async function updateClaimedJob(job, data) {
  return db.runTransaction(async (transaction) => {
    const result = await transaction.collection(REMINDER_COLLECTION).doc(job._id).get()
    const current = result && result.data ? result.data : null
    const stillOwned = current
      && current.status === 'sending'
      && Number(current.leaseExpiresAt || 0) === Number(job.leaseExpiresAt || 0)
      && Number(current.recordUpdatedAt || 0) === Number(job.recordUpdatedAt || 0)
    if (!stillOwned) {
      console.info(`${LOG_TAG} stale lease update skipped`, { jobId: job._id })
      return false
    }
    await transaction.collection(REMINDER_COLLECTION).doc(job._id).update({ data })
    return true
  })
}

async function recoverExpiredLeases(now) {
  const result = await db.collection(REMINDER_COLLECTION)
    .where({ status: 'sending', leaseExpiresAt: _.lte(now) })
    .limit(BATCH_SIZE)
    .get()
  const jobs = result.data || []
  await Promise.all(jobs.map((job) => db.collection(REMINDER_COLLECTION).doc(job._id).update({
    data: {
      status: 'pending',
      nextAttemptAt: now,
      leaseExpiresAt: 0,
      updatedAt: now,
    },
  })))
  return jobs.length
}

async function cleanupTerminalJobs(now) {
  const result = await db.collection(REMINDER_COLLECTION)
    .where({ purgeAt: _.gt(0).and(_.lte(now)) })
    .limit(BATCH_SIZE)
    .get()
  const jobs = result.data || []
  await Promise.all(jobs.map((job) => db.collection(REMINDER_COLLECTION).doc(job._id).remove()))
  return jobs.length
}

/**
 * 生成轻量健康快照。
 *
 * 不新增监控集合，只读取现有提醒任务并通过云函数日志告警。阈值可用环境变量调整：
 * SIXIANG_REMINDER_BACKLOG_THRESHOLD、SIXIANG_REMINDER_FAILURE_THRESHOLD、
 * SIXIANG_REMINDER_OVERDUE_MINUTES。
 */
async function buildHealthSnapshot(now) {
  const backlogThreshold = normalizePositiveInteger(process.env.SIXIANG_REMINDER_BACKLOG_THRESHOLD, DEFAULT_BACKLOG_THRESHOLD)
  const failureThreshold = normalizePositiveInteger(process.env.SIXIANG_REMINDER_FAILURE_THRESHOLD, DEFAULT_FAILURE_THRESHOLD)
  const overdueMinutes = normalizePositiveInteger(process.env.SIXIANG_REMINDER_OVERDUE_MINUTES, DEFAULT_OVERDUE_MINUTES)
  const overdueBefore = now - overdueMinutes * 60 * 1000
  const recentFailureAfter = now - MONITOR_WINDOW_MS

  try {
    const [overdueResult, failedResult, pendingResult] = await Promise.all([
      db.collection(REMINDER_COLLECTION)
        .where({ status: 'pending', nextAttemptAt: _.lte(overdueBefore) })
        .count(),
      db.collection(REMINDER_COLLECTION)
        .where({ status: 'failed' })
        .limit(BATCH_SIZE)
        .get(),
      db.collection(REMINDER_COLLECTION)
        .where({ status: 'pending' })
        .limit(BATCH_SIZE)
        .get(),
    ])
    const recentFailedJobs = (failedResult.data || []).filter((job) => Number(job.updatedAt || 0) >= recentFailureAfter)
    const retryingJobs = (pendingResult.data || []).filter((job) => (
      Number(job.attemptCount || 0) > 0 && Number(job.updatedAt || 0) >= recentFailureAfter
    ))
    const failureCategories = recentFailedJobs.concat(retryingJobs).reduce((result, job) => {
      const category = job.failureCategory || 'UNKNOWN_SEND_ERROR'
      result[category] = Number(result[category] || 0) + 1
      return result
    }, {})
    const overduePending = Number(overdueResult.total || 0)
    const recentFailures = recentFailedJobs.length
    const retrying = retryingJobs.length
    const recentFailureSignals = recentFailures + retrying
    const alertCodes = []
    if (overduePending >= backlogThreshold) {
      alertCodes.push('REMINDER_BACKLOG_HIGH')
    }
    if (recentFailureSignals >= failureThreshold) {
      alertCodes.push('REMINDER_FAILURES_HIGH')
    }
    return {
      healthy: alertCodes.length === 0,
      checkedAt: now,
      overduePending,
      recentFailures,
      retrying,
      recentFailureSignals,
      failureCategories,
      alertCodes,
      thresholds: { backlogThreshold, failureThreshold, overdueMinutes },
    }
  } catch (error) {
    console.warn(`${LOG_TAG} health check failed`, createErrorLog(error))
    return {
      healthy: false,
      checkedAt: now,
      overduePending: -1,
      recentFailures: -1,
      retrying: -1,
      recentFailureSignals: -1,
      failureCategories: {},
      alertCodes: ['REMINDER_HEALTH_CHECK_FAILED'],
      thresholds: { backlogThreshold, failureThreshold, overdueMinutes },
    }
  }
}

/**
 * 受保护的终态任务清理入口，供云函数控制台人工执行。
 *
 * 默认仅预演；只有配置维护口令并显式传入 dryRun:false 时才会删除 failed/expired。
 * 这样既能清理本轮测试垃圾，又不会让小程序客户端获得批量删除能力。
 */
async function runProtectedCleanup(event, now) {
  const configuredToken = String(process.env.SIXIANG_REMINDER_MAINTENANCE_TOKEN || '')
  const requestToken = String(event.maintenanceToken || '')
  if (!configuredToken || !safeEqual(configuredToken, requestToken)) {
    return {
      success: false,
      code: 'MAINTENANCE_UNAUTHORIZED',
      message: '维护操作未授权',
      debug: '请在云函数环境变量配置 SIXIANG_REMINDER_MAINTENANCE_TOKEN，并从云函数控制台传入相同口令。',
    }
  }

  const olderThanHours = Math.max(0, Math.min(24 * 365, Number(event.olderThanHours || 0)))
  const updatedBefore = now - olderThanHours * 60 * 60 * 1000
  const requestedStatuses = Array.isArray(event.statuses) ? event.statuses : CLEANABLE_STATUSES
  const statuses = requestedStatuses.filter((status) => CLEANABLE_STATUSES.includes(status))
  if (!statuses.length) {
    return { success: false, code: 'INVALID_CLEANUP_STATUS', message: '只允许清理失败或过期任务' }
  }

  const result = await db.collection(REMINDER_COLLECTION)
    .where({ status: _.in(statuses) })
    .limit(BATCH_SIZE)
    .get()
  const candidates = (result.data || []).filter((job) => Number(job.updatedAt || 0) <= updatedBefore)
  const dryRun = event.dryRun !== false
  if (!dryRun) {
    await Promise.all(candidates.map((job) => db.collection(REMINDER_COLLECTION).doc(job._id).remove()))
  }
  console.info(`${LOG_TAG} maintenance cleanup`, {
    dryRun,
    statuses,
    olderThanHours,
    matched: candidates.length,
  })
  return {
    success: true,
    dryRun,
    matched: candidates.length,
    removed: dryRun ? 0 : candidates.length,
    hasMore: candidates.length >= BATCH_SIZE,
  }
}

function normalizeMiniprogramState(value) {
  return value === 'developer' || value === 'trial' || value === 'formal' ? value : 'formal'
}

function classifySendFailure(code, message) {
  const normalizedCode = String(code || '')
  const text = String(message || '').toLowerCase()
  const includesAny = (keywords) => keywords.some((keyword) => text.includes(keyword))

  if (normalizedCode === '43101' || includesAny(['user refuse', 'no subscription', 'no permission', '无订阅', '拒绝订阅'])) {
    return failure('NO_SUBSCRIPTION_QUOTA', false, '用户当前没有可用的一次性订阅额度，需要再次主动开启提醒。')
  }
  if (['40037', '41028', '41029'].includes(normalizedCode) || includesAny(['template id', 'template invalid', '模板失效', '模板不存在'])) {
    return failure('TEMPLATE_INVALID', false, '检查公众平台订阅模板是否仍有效，以及云函数模板 ID 是否一致。')
  }
  if (includesAny(['value length', 'too long', 'exceed max length', 'out of range', '超长', '长度超出'])) {
    return failure('FIELD_TOO_LONG', false, '模板字段超过微信限制，请缩短事项名称或提示文字。')
  }
  if (normalizedCode === '47003' || includesAny(['data format', 'parameter invalid', '字段格式', '参数不合法'])) {
    return failure('MESSAGE_DATA_INVALID', false, '检查模板字段键、字段类型和内容格式是否与公众平台模板一致。')
  }
  if (normalizedCode === '41030' || includesAny(['page path', 'invalid page', 'path invalid', '页面路径'])) {
    return failure('PAGE_PATH_INVALID', false, '检查通知跳转页面是否已在 app.json 注册，并使用不带开头斜杠的页面路径。')
  }
  if (normalizedCode === '-501001' && includesAny(['access_token', 'access token'])) {
    return failure('CLOUD_AUTH_ERROR', true, '检查云环境与小程序 AppID 绑定、云函数 openapi 权限及部署来源。')
  }
  if (['45009', '45011'].includes(normalizedCode) || includesAny(['rate limit', '频率', '频控'])) {
    return failure('RATE_LIMITED', true, '微信接口触发频控，系统会按退避间隔自动重试。')
  }
  if (['-1', '50001'].includes(normalizedCode) || includesAny(['timeout', 'network', 'system error', 'econn', 'socket hang up', '网络'])) {
    return failure('CLOUD_NETWORK_ERROR', true, '云端网络或微信接口暂时异常，系统会自动重试。')
  }
  return failure('UNKNOWN_SEND_ERROR', false, '请结合原始错误码和云函数日志定位。')
}

function failure(category, retryable, hint) {
  return { category, retryable, hint }
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function getErrorCode(error) {
  if (error && error.errCode !== undefined) {
    return String(error.errCode)
  }
  if (error && error.code !== undefined) {
    return String(error.code)
  }
  return ''
}

function invalid(code, message) {
  return { ok: false, code, message }
}

function truncateText(value, maxLength) {
  return Array.from(String(value || '')).slice(0, maxLength).join('')
}

function isNotFoundError(error) {
  const text = getErrorText(error).toLowerCase()
  return text.includes('not found') || text.includes('does not exist') || text.includes('-502005')
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

function createErrorLog(error) {
  return {
    code: getErrorCode(error),
    message: getErrorText(error),
  }
}
