const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const USER_DATA_COLLECTION = 'sixiang_user_data'
const USER_PROFILE_COLLECTION = 'sixiang_users'
const REMINDER_COLLECTION = 'sixiang_reminder_jobs'
const LOG_TAG = '[sixiangAdminStats]'
const PAGE_SIZE = 100
const DEFAULT_USER_LIMIT = 50
const MAX_USER_LIMIT = 100
const RECORD_TYPES = ['todo', 'anniversary', 'expiry', 'note']
const RECURRENCE_TYPES = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const REMINDER_STATUSES = ['pending', 'sending', 'sent', 'cancelled', 'failed', 'expired']
const SNAPSHOT_WARNING_BYTES = 750 * 1024
const REMINDER_OVERDUE_MS = 5 * 60 * 1000

/**
 * 管理员只读统计云函数。
 *
 * 参数：
 * - limit：返回用户明细条数，默认 50，最多 100。
 * - adminSecret：可选；当云函数配置了 SIXIANG_ADMIN_SECRET 时用于云端测试调用。
 *
 * 安全边界：
 * - 默认不会返回任何统计，必须配置 SIXIANG_ADMIN_OPENIDS 或 SIXIANG_ADMIN_SECRET。
 * - 返回结果只包含脱敏 openid 和聚合计数，不返回完整记录标题、备注、头像文件 ID 等用户内容。
 */
exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const auth = authorizeAdmin(openid, event)

  console.info(`${LOG_TAG} request`, {
    hasOpenid: Boolean(openid),
    authMode: auth.mode,
  })

  if (!auth.ok) {
    return createError(auth.code, auth.message, auth.debug)
  }

  const limit = normalizeLimit(event.limit)
  const warnings = []

  try {
    const profiles = await fetchCollectionSafely(USER_PROFILE_COLLECTION, warnings)
    const userDataDocs = await fetchCollectionSafely(USER_DATA_COLLECTION, warnings)
    const reminderJobs = await fetchCollectionSafely(REMINDER_COLLECTION, warnings)
    const report = buildStatsReport(profiles, userDataDocs, reminderJobs, limit)

    return {
      success: true,
      generatedAt: Date.now(),
      source: {
        profileCollection: USER_PROFILE_COLLECTION,
        userDataCollection: USER_DATA_COLLECTION,
        reminderCollection: REMINDER_COLLECTION,
        note: '统计来自当前云端快照，不是逐条行为埋点日志。',
      },
      ...report,
      warnings,
    }
  } catch (error) {
    console.error(`${LOG_TAG} failed`, createErrorLog(error))
    return createError(
      'ADMIN_STATS_FAILED',
      '读取管理员统计失败',
      `云函数日志搜索 ${LOG_TAG}，确认两个集合存在且云函数服务端可读。`,
    )
  }
}

function authorizeAdmin(openid, event) {
  const adminOpenids = parseList(process.env.SIXIANG_ADMIN_OPENIDS)
  const adminSecret = typeof process.env.SIXIANG_ADMIN_SECRET === 'string' ? process.env.SIXIANG_ADMIN_SECRET.trim() : ''
  const eventSecret = typeof event.adminSecret === 'string' ? event.adminSecret.trim() : ''

  if (!adminOpenids.length && !adminSecret) {
    return {
      ok: false,
      mode: 'not_configured',
      code: 'ADMIN_NOT_CONFIGURED',
      message: '管理员统计未配置访问权限',
      debug: '在 sixiangAdminStats 云函数环境变量配置 SIXIANG_ADMIN_OPENIDS 或 SIXIANG_ADMIN_SECRET 后再调用。',
    }
  }

  if (openid && adminOpenids.includes(openid)) {
    return { ok: true, mode: 'openid' }
  }

  if (adminSecret && eventSecret && safeEqual(adminSecret, eventSecret)) {
    return { ok: true, mode: 'secret' }
  }

  return {
    ok: false,
    mode: 'forbidden',
    code: 'ADMIN_FORBIDDEN',
    message: '当前用户无权查看管理员统计',
    debug: '确认当前 openid 已加入 SIXIANG_ADMIN_OPENIDS，或云端测试参数 adminSecret 与 SIXIANG_ADMIN_SECRET 一致。',
  }
}

async function fetchCollectionSafely(collectionName, warnings) {
  try {
    return await fetchAllDocuments(collectionName)
  } catch (error) {
    if (isCollectionNotReady(error)) {
      warnings.push(`${collectionName} 集合未创建或不可访问，已按空集合统计。`)
      return []
    }

    throw error
  }
}

async function fetchAllDocuments(collectionName) {
  const countResult = await db.collection(collectionName).count()
  const total = countResult && typeof countResult.total === 'number' ? countResult.total : 0
  const pages = Math.ceil(total / PAGE_SIZE)
  const docs = []

  for (let page = 0; page < pages; page += 1) {
    const result = await db.collection(collectionName)
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()

    if (result && Array.isArray(result.data)) {
      docs.push(...result.data)
    }
  }

  return docs
}

function buildStatsReport(profiles, userDataDocs, reminderJobs, limit) {
  const profileMap = createProfileMap(profiles)
  const userRows = createUserRows(profileMap, userDataDocs)
  const totals = createEmptyTotals()

  userRows.forEach((row) => {
    mergeTotals(totals, row.stats)
  })

  userRows.sort((first, second) => second.lastActiveAt - first.lastActiveAt)

  const snapshotHealth = buildSnapshotHealth(userDataDocs)
  const reminderHealth = buildReminderHealth(reminderJobs)
  const funnel = buildCoreFunnel(userRows, reminderJobs)
  const alerts = buildHealthAlerts(snapshotHealth, reminderHealth)

  return {
    summary: {
      totalUsers: userRows.length,
      profileUsers: profiles.length,
      businessDataUsers: userDataDocs.length,
      activeUsersWithRecords: userRows.filter((row) => row.stats.records.total > 0).length,
      usersWithNickname: profiles.filter((profile) => typeof profile.nickName === 'string' && profile.nickName.trim()).length,
      usersWithAvatar: profiles.filter((profile) => typeof profile.avatarUrl === 'string' && profile.avatarUrl.trim()).length,
    },
    operations: buildOperationSummary(totals, profiles.length),
    funnel,
    health: {
      snapshots: snapshotHealth,
      reminders: reminderHealth,
      alerts,
    },
    totals,
    users: userRows.slice(0, limit).map((row, index) => ({
      userKey: `user-${String(index + 1).padStart(3, '0')}`,
      openidMasked: maskOpenid(row.openid),
      nickName: row.nickName,
      hasAvatar: row.hasAvatar,
      profileUpdatedAt: row.profileUpdatedAt,
      dataUpdatedAt: row.dataUpdatedAt,
      lastActiveAt: row.lastActiveAt,
      stats: row.stats,
    })),
    userLimit: limit,
  }
}

/**
 * 统计云端快照体积，只返回聚合数据，不暴露任何用户内容。
 * 750KB 为主动预警线，给云数据库单文档限制和后续字段增长留出余量。
 */
function buildSnapshotHealth(userDataDocs) {
  const sizes = userDataDocs.map((doc) => Buffer.byteLength(JSON.stringify(doc || {}), 'utf8'))
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0)
  const maxBytes = sizes.length ? Math.max(...sizes) : 0

  return {
    documents: sizes.length,
    totalBytes,
    averageBytes: sizes.length ? Math.round(totalBytes / sizes.length) : 0,
    maxBytes,
    warningBytes: SNAPSHOT_WARNING_BYTES,
    overWarningCount: sizes.filter((size) => size >= SNAPSHOT_WARNING_BYTES).length,
  }
}

/**
 * 汇总提醒队列健康度。失败原因仅保留分类计数，避免管理员统计泄露事项内容。
 */
function buildReminderHealth(reminderJobs) {
  const now = Date.now()
  const byStatus = createCountMap(REMINDER_STATUSES)
  const failureCategories = {}
  const reminderUsers = new Set()
  let overduePending = 0
  let expiredSendingLease = 0

  reminderJobs.forEach((job) => {
    if (!job || typeof job !== 'object') {
      return
    }

    const status = REMINDER_STATUSES.includes(job.status) ? job.status : 'unknown'
    byStatus[status] = (byStatus[status] || 0) + 1

    if (typeof job.openid === 'string' && job.openid) {
      reminderUsers.add(job.openid)
    }

    if (status === 'pending' && Number(job.nextAttemptAt || job.sendAt || 0) <= now - REMINDER_OVERDUE_MS) {
      overduePending += 1
    }

    if (status === 'sending' && Number(job.leaseExpiresAt || 0) > 0 && Number(job.leaseExpiresAt) <= now) {
      expiredSendingLease += 1
    }

    if (status === 'failed' || status === 'expired') {
      const category = typeof job.failureCategory === 'string' && job.failureCategory
        ? job.failureCategory.slice(0, 60)
        : 'uncategorized'
      failureCategories[category] = (failureCategories[category] || 0) + 1
    }
  })

  return {
    total: reminderJobs.length,
    users: reminderUsers.size,
    byStatus,
    overduePending,
    expiredSendingLease,
    failureCategories,
    overdueThresholdMinutes: REMINDER_OVERDUE_MS / 60000,
  }
}

/**
 * 使用现有业务快照推导匿名漏斗，不记录页面浏览、点击轨迹或用户内容。
 */
function buildCoreFunnel(userRows, reminderJobs) {
  const reminderOpenids = new Set(
    reminderJobs
      .map((job) => (job && typeof job.openid === 'string' ? job.openid : ''))
      .filter(Boolean),
  )
  const stages = [
    { key: 'cloud_users', label: '已有云端数据', count: userRows.length },
    { key: 'created_record', label: '创建过记录', count: userRows.filter((row) => row.stats.records.total > 0).length },
    { key: 'completed_item', label: '完成过事项', count: userRows.filter((row) => row.stats.records.done + row.stats.records.checkins > 0).length },
    { key: 'used_recurring_plan', label: '使用过周期计划', count: userRows.filter((row) => row.stats.records.recurring > 0).length },
    { key: 'used_memory', label: '记录过纪念日或心情', count: userRows.filter((row) => row.stats.records.byType.anniversary + row.stats.moods.total > 0).length },
    { key: 'used_gift_ledger', label: '使用过礼簿', count: userRows.filter((row) => row.stats.gifts.giftBookItems + row.stats.gifts.giftExchangeItems > 0).length },
    { key: 'adopted_companion', label: '已领养小暖', count: userRows.filter((row) => row.stats.companion.adopted).length },
    { key: 'enabled_reminder', label: '开启过微信提醒', count: userRows.filter((row) => reminderOpenids.has(row.openid)).length },
  ]

  return stages.map((stage) => ({
    ...stage,
    rate: userRows.length ? Math.round((stage.count / userRows.length) * 1000) / 10 : 0,
  }))
}

function buildHealthAlerts(snapshotHealth, reminderHealth) {
  const alerts = []

  if (snapshotHealth.overWarningCount > 0) {
    alerts.push({
      level: 'warning',
      code: 'SNAPSHOT_SIZE_HIGH',
      message: `${snapshotHealth.overWarningCount} 个用户快照超过 750KB 预警线`,
    })
  }

  if (reminderHealth.overduePending > 0) {
    alerts.push({
      level: 'error',
      code: 'REMINDER_BACKLOG',
      message: `${reminderHealth.overduePending} 条提醒已积压超过 ${reminderHealth.overdueThresholdMinutes} 分钟`,
    })
  }

  if (reminderHealth.expiredSendingLease > 0) {
    alerts.push({
      level: 'error',
      code: 'REMINDER_LEASE_EXPIRED',
      message: `${reminderHealth.expiredSendingLease} 条提醒发送租约已过期`,
    })
  }

  const terminalFailures = (reminderHealth.byStatus.failed || 0) + (reminderHealth.byStatus.expired || 0)
  if (terminalFailures >= 3) {
    alerts.push({
      level: 'warning',
      code: 'REMINDER_FAILURES_HIGH',
      message: `提醒失败或过期任务累计 ${terminalFailures} 条，请检查失败分类`,
    })
  }

  return alerts
}

function createProfileMap(profiles) {
  return profiles.reduce((result, profile) => {
    const openid = getDocumentOpenid(profile)

    if (openid) {
      result[openid] = profile
    }

    return result
  }, {})
}

function createUserRows(profileMap, userDataDocs) {
  const userMap = {}

  Object.keys(profileMap).forEach((openid) => {
    const profile = profileMap[openid]
    userMap[openid] = createUserRow(openid, profile, null)
  })

  userDataDocs.forEach((doc) => {
    const openid = getDocumentOpenid(doc)

    if (!openid) {
      return
    }

    userMap[openid] = createUserRow(openid, profileMap[openid], doc)
  })

  return Object.keys(userMap).map((openid) => userMap[openid])
}

function createUserRow(openid, profile, dataDoc) {
  const stats = summarizeBusinessData(dataDoc)
  const profileUpdatedAt = sanitizeTimestamp(profile && profile.updatedAt)
  const dataUpdatedAt = sanitizeTimestamp(dataDoc && dataDoc.updatedAt)

  return {
    openid,
    nickName: sanitizeNickName(profile && profile.nickName),
    hasAvatar: Boolean(profile && typeof profile.avatarUrl === 'string' && profile.avatarUrl.trim()),
    profileUpdatedAt,
    dataUpdatedAt,
    lastActiveAt: Math.max(profileUpdatedAt, dataUpdatedAt),
    stats,
  }
}

function summarizeBusinessData(dataDoc) {
  const stats = {
    records: {
      total: 0,
      pending: 0,
      done: 0,
      deleted: 0,
      recurring: 0,
      byType: createCountMap(RECORD_TYPES),
      byRecurrence: createCountMap(RECURRENCE_TYPES),
      checkins: 0,
    },
    gifts: {
      giftBookContacts: 0,
      giftBookItems: 0,
      giftExchangeContacts: 0,
      giftExchangeItems: 0,
    },
    moods: {
      total: 0,
    },
    companion: {
      adopted: 0,
      exp: 0,
    },
  }

  if (!dataDoc || typeof dataDoc !== 'object') {
    return stats
  }

  const records = Array.isArray(dataDoc.records) ? dataDoc.records : []
  records.forEach((record) => summarizeRecord(record, stats.records))
  summarizeGiftBook(dataDoc.giftBook, stats.gifts)
  summarizeGiftExchanges(dataDoc.giftExchanges, stats.gifts)
  stats.moods.total = Array.isArray(dataDoc.moodRecords) ? dataDoc.moodRecords.length : 0
  if (dataDoc.companionState && typeof dataDoc.companionState === 'object') {
    stats.companion.adopted = Number(dataDoc.companionState.adoptedAt || 0) > 0 ? 1 : 0
    stats.companion.exp = Math.max(0, Math.floor(Number(dataDoc.companionState.exp || 0)))
  }

  return stats
}

function summarizeRecord(record, stats) {
  if (!record || typeof record !== 'object') {
    return
  }

  stats.total += 1

  if (record.deletedAt) {
    stats.deleted += 1
  }

  if (record.status === 'done') {
    stats.done += 1
  } else {
    stats.pending += 1
  }

  const type = RECORD_TYPES.includes(record.type) ? record.type : 'unknown'
  stats.byType[type] = (stats.byType[type] || 0) + 1

  const recurrenceType = RECURRENCE_TYPES.includes(record.recurrenceType) ? record.recurrenceType : 'none'
  stats.byRecurrence[recurrenceType] = (stats.byRecurrence[recurrenceType] || 0) + 1

  if (recurrenceType !== 'none') {
    stats.recurring += 1
  }

  if (record.checkinHistory && typeof record.checkinHistory === 'object' && !Array.isArray(record.checkinHistory)) {
    stats.checkins += Object.keys(record.checkinHistory).length
  }
}

function summarizeGiftBook(giftBook, stats) {
  if (!giftBook || typeof giftBook !== 'object' || !Array.isArray(giftBook.contacts)) {
    return
  }

  stats.giftBookContacts += giftBook.contacts.length
  giftBook.contacts.forEach((contact) => {
    if (contact && typeof contact === 'object' && Array.isArray(contact.gifts)) {
      stats.giftBookItems += contact.gifts.length
    }
  })
}

function summarizeGiftExchanges(giftExchanges, stats) {
  if (!giftExchanges || typeof giftExchanges !== 'object' || !Array.isArray(giftExchanges.contacts)) {
    return
  }

  stats.giftExchangeContacts += giftExchanges.contacts.length
  giftExchanges.contacts.forEach((contact) => {
    if (contact && typeof contact === 'object' && Array.isArray(contact.records)) {
      stats.giftExchangeItems += contact.records.length
    }
  })
}

function createEmptyTotals() {
  return {
    records: {
      total: 0,
      pending: 0,
      done: 0,
      deleted: 0,
      recurring: 0,
      byType: createCountMap(RECORD_TYPES),
      byRecurrence: createCountMap(RECURRENCE_TYPES),
      checkins: 0,
    },
    gifts: {
      giftBookContacts: 0,
      giftBookItems: 0,
      giftExchangeContacts: 0,
      giftExchangeItems: 0,
    },
    moods: {
      total: 0,
    },
    companion: {
      adopted: 0,
      exp: 0,
    },
  }
}

function mergeTotals(totals, stats) {
  totals.records.total += stats.records.total
  totals.records.pending += stats.records.pending
  totals.records.done += stats.records.done
  totals.records.deleted += stats.records.deleted
  totals.records.recurring += stats.records.recurring
  totals.records.checkins += stats.records.checkins
  RECORD_TYPES.forEach((type) => {
    totals.records.byType[type] += stats.records.byType[type] || 0
  })
  RECURRENCE_TYPES.forEach((type) => {
    totals.records.byRecurrence[type] += stats.records.byRecurrence[type] || 0
  })
  totals.gifts.giftBookContacts += stats.gifts.giftBookContacts
  totals.gifts.giftBookItems += stats.gifts.giftBookItems
  totals.gifts.giftExchangeContacts += stats.gifts.giftExchangeContacts
  totals.gifts.giftExchangeItems += stats.gifts.giftExchangeItems
  totals.moods.total += stats.moods.total
  totals.companion.adopted += stats.companion.adopted
  totals.companion.exp += stats.companion.exp
}

function buildOperationSummary(totals, profileUsers) {
  return [
    { key: 'profile_saved', label: '保存用户资料', count: profileUsers },
    { key: 'record_created', label: '创建记录', count: totals.records.total },
    { key: 'todo_created', label: '创建待办', count: totals.records.byType.todo },
    { key: 'anniversary_created', label: '创建纪念日', count: totals.records.byType.anniversary },
    { key: 'expiry_created', label: '创建效期提醒', count: totals.records.byType.expiry },
    { key: 'note_created', label: '创建便签', count: totals.records.byType.note },
    { key: 'recurring_goal_created', label: '创建周期目标', count: totals.records.recurring },
    { key: 'record_done_or_checkin', label: '完成记录或打卡', count: totals.records.done + totals.records.checkins },
    { key: 'gift_book_used', label: '维护礼簿', count: totals.gifts.giftBookItems },
      { key: 'gift_exchange_used', label: '记录往来', count: totals.gifts.giftExchangeItems },
    { key: 'mood_saved', label: '记录心情', count: totals.moods.total },
  ].filter((item) => item.count > 0)
}

function createCountMap(keys) {
  return keys.reduce((result, key) => {
    result[key] = 0
    return result
  }, {})
}

function getDocumentOpenid(doc) {
  if (!doc || typeof doc !== 'object') {
    return ''
  }

  if (typeof doc.openid === 'string' && doc.openid) {
    return doc.openid
  }

  if (typeof doc._id === 'string' && doc._id) {
    return doc._id
  }

  return ''
}

function sanitizeNickName(value) {
  const nickName = typeof value === 'string' ? value.trim() : ''
  return nickName ? nickName.slice(0, 20) : ''
}

function sanitizeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeLimit(value) {
  const limit = Math.floor(Number(value))

  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_USER_LIMIT
  }

  return Math.min(MAX_USER_LIMIT, limit)
}

function parseList(value) {
  if (typeof value !== 'string') {
    return []
  }

  return value.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function safeEqual(first, second) {
  if (first.length !== second.length) {
    return false
  }

  let result = 0
  for (let index = 0; index < first.length; index += 1) {
    result |= first.charCodeAt(index) ^ second.charCodeAt(index)
  }

  return result === 0
}

function maskOpenid(openid) {
  if (typeof openid !== 'string' || openid.length <= 10) {
    return '***'
  }

  return `${openid.slice(0, 4)}***${openid.slice(-4)}`
}

function createError(code, message, debug) {
  return {
    success: false,
    code,
    message,
    debug,
  }
}

function createErrorLog(error) {
  return {
    errMsg: getErrorText(error),
    errCode: error && error.errCode ? error.errCode : '',
  }
}

function getErrorText(error) {
  if (!error) {
    return ''
  }

  if (typeof error === 'string') {
    return error
  }

  return String(error.errMsg || error.message || JSON.stringify(error))
}

function isCollectionNotReady(error) {
  const message = getErrorText(error).toLowerCase()
  return (
    message.includes('collection') &&
    (
      message.includes('not found') ||
      message.includes('not exist') ||
      message.includes('does not exist') ||
      message.includes('不存在') ||
      message.includes('未创建')
    )
  )
}
