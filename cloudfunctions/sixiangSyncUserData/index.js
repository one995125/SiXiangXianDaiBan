const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const COLLECTION_NAME = 'sixiang_user_data'
const LOG_TAG = '[sixiangSyncUserData]'
const MAX_PAYLOAD_SIZE = 900 * 1024
const MAX_RECORD_COUNT = 2000
const MAX_CONTACT_COUNT = 100
const MAX_GIFT_COUNT_PER_CONTACT = 200
const MAX_GIFT_EXCHANGE_CONTACT_COUNT = 100
const MAX_GIFT_EXCHANGE_RECORD_COUNT_PER_CONTACT = 300
const MAX_MIGRATED_GIFT_ID_COUNT = 1000
const MAX_DELETED_ENTRY_ID_COUNT = 2000
const MAX_MOOD_COUNT = 500
const MAX_CHECKIN_HISTORY_COUNT = 370
const ALLOWED_RECORD_TYPES = ['todo', 'anniversary', 'expiry', 'note']
const ALLOWED_REPEAT_RULES = ['none', 'yearly']
const ALLOWED_STATUSES = ['pending', 'done']
const ALLOWED_RECURRENCE_TYPES = ['none', 'daily', 'weekly', 'monthly', 'yearly']
// 与客户端 TodoQuadrantId 保持一致；旧值在 sanitizeQuadrant 中兼容迁移。
const ALLOWED_QUADRANTS = ['do-now', 'schedule', 'quick', 'avoid']
const ALLOWED_NOTE_KINDS = ['long_term', 'temporary']
const ALLOWED_ANNIVERSARY_MODES = ['elapsed', 'countdown']
const ALLOWED_RECORD_VISIBILITIES = ['private', 'family']
const ALLOWED_MOODS = ['happy', 'calm', 'tired', 'stressed', 'sad']
const GROWTH_MILESTONE_IDS = ['first_plan_created', 'first_item_completed', 'first_memory_added']
const SYNC_DATA_FIELDS = [
  'records',
  'categoryHistory',
  'giftBook',
  'giftExchanges',
  'moodRecords',
  'familyState',
  'companionState',
  'onboardingState',
  'growthUnlockPromptAt',
  'legacyData',
]
const LEGACY_SENSITIVE_KEYS = new Set(['encryptedData', 'iv', 'cloudID', 'code', 'sessionKey', 'session_key'])

/**
 * 记得业务数据同步云函数。
 *
 * 参数：
 * - action: 'pull' | 'push' | 'growthCheckin'
 * - data: push 时传入 schemaVersion=7 的完整用户业务快照
 * - baseRevision: push 时必须携带最近一次 pull/push 获得的云端版本
 *
 * 安全边界：
 * - 身份只使用 cloud.getWXContext() 的 OPENID，不信任前端传入的 openid。
 * - 每个 openid 固定对应一条 _id 相同的文档，不提供跨用户查询接口。
 * - 旧版业务状态允许迁移，但微信运动临时密文、登录 code、sessionKey 等敏感凭证永不落库。
 */
exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  console.info(`${LOG_TAG} request`, {
    action: event.action || '',
    hasOpenid: Boolean(openid),
    collection: COLLECTION_NAME,
  })

  if (!openid) {
    return createError('NO_OPENID', '未获取到用户身份，请确认云函数由小程序端调用')
  }

  if (event.action === 'pull') {
    return pullUserData(openid, event.bootstrap)
  }

  if (event.action === 'push') {
    return pushUserData(openid, event.data, event.baseRevision)
  }

  if (event.action === 'growthCheckin') {
    return checkInGrowth(openid)
  }

  return createError('INVALID_ACTION', '同步动作不合法')
}

async function pullUserData(openid, rawBootstrap) {
  try {
    const result = await db.collection(COLLECTION_NAME).doc(openid).get()
    const data = result && result.data ? result.data : null
    const growthState = data
      ? ensureExistingUserGrowthState(data.growthState, data.createdAt)
      : null

    const revision = data ? getDocumentRevision(data) : 0

    return {
      success: true,
      openid,
      data: data ? stripPrivateFields(data) : null,
      updatedAt: data && isFiniteNumber(data.updatedAt) ? data.updatedAt : 0,
      revision,
      growthState,
    }
  } catch (error) {
    if (isDocumentNotFound(error)) {
      return createFirstUserDocument(openid, rawBootstrap)
    }

    if (isCollectionNotReady(error) && await ensureCollectionExists()) {
      return createFirstUserDocument(openid, rawBootstrap)
    }

    console.error(`${LOG_TAG} pull failed`, createDatabaseLog(error))
    return createDatabaseError('pull', error)
  }
}

async function pushUserData(openid, rawData, rawBaseRevision) {
  if (!isFiniteNumber(rawBaseRevision) || !Number.isInteger(rawBaseRevision) || rawBaseRevision < 0) {
    return createError(
      'CLIENT_UPGRADE_REQUIRED',
      '当前版本不支持安全的多设备同步，请更新小程序后重试',
      '新版客户端会先读取云端 revision，再执行带版本校验的上传。',
    )
  }

  const sanitized = sanitizePayload(rawData)

  if (!sanitized.ok) {
    return createError('INVALID_DATA', sanitized.message)
  }

  const payloadText = JSON.stringify(sanitized.data)

  if (Buffer.byteLength(payloadText, 'utf8') > MAX_PAYLOAD_SIZE) {
    return createError('PAYLOAD_TOO_LARGE', '同步数据过大，请减少历史记录后重试')
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const now = Date.now()
      let previousDocument = null

      try {
        const oldDocument = await transaction.collection(COLLECTION_NAME).doc(openid).get()
        previousDocument = oldDocument && oldDocument.data ? oldDocument.data : null
      } catch (error) {
        if (!isDocumentNotFound(error)) {
          throw error
        }
      }

      const currentRevision = previousDocument ? getDocumentRevision(previousDocument) : 0
      if (rawBaseRevision !== currentRevision) {
        return {
          success: false,
          code: 'SYNC_CONFLICT',
          message: '云端数据已被另一台设备更新，本次未覆盖，正在重新合并',
          debug: `baseRevision=${rawBaseRevision}, currentRevision=${currentRevision}`,
          openid,
          revision: currentRevision,
        }
      }

      const createdAt = previousDocument && isFiniteNumber(previousDocument.createdAt)
        ? previousDocument.createdAt
        : now
      const growthState = previousDocument
        ? ensureExistingUserGrowthState(previousDocument.growthState, createdAt)
        : createNewGrowthState({}, now)
      const nextRevision = currentRevision + 1
      const documentData = {
        openid,
        schemaVersion: 7,
        ...sanitized.data,
        revision: nextRevision,
        createdAt,
        updatedAt: now,
      }

      // 旧数据文档可能没有第7版新增字段；客户端明确提供空值才代表清空，未提供则沿用云端值。
      if (previousDocument) {
        SYNC_DATA_FIELDS.forEach((field) => {
          if (!sanitized.providedFields[field] && Object.prototype.hasOwnProperty.call(previousDocument, field)) {
            documentData[field] = previousDocument[field]
          }
        })
      }

      documentData.growthState = deriveGrowthMilestones(growthState, documentData, now)
      await transaction.collection(COLLECTION_NAME).doc(openid).set({ data: documentData })

      return {
        success: true,
        openid,
        updatedAt: now,
        revision: nextRevision,
        growthState: documentData.growthState,
      }
    })
  } catch (error) {
    console.error(`${LOG_TAG} push failed`, createDatabaseLog(error))
    return createDatabaseError('push', error)
  }
}

/**
 * 使用服务端北京时间完成成长签到；客户端不传日期，同一天重复调用不会增加进度。
 */
async function checkInGrowth(openid) {
  try {
    return await db.runTransaction(async (transaction) => {
      const result = await transaction.collection(COLLECTION_NAME).doc(openid).get()
      const documentData = result && result.data ? result.data : null
      if (!documentData) {
        return createError('GROWTH_NOT_READY', '成长状态尚未初始化，请重新进入小程序')
      }

      const now = Date.now()
      const currentRevision = getDocumentRevision(documentData)
      const growthState = ensureExistingUserGrowthState(documentData.growthState, documentData.createdAt)
      if (growthState.cohort === 'legacy' || growthState.giftUnlockedAt) {
        return { success: true, openid, growthState, revision: currentRevision }
      }

      const today = formatBeijingDate(now)
      if (!growthState.checkinDates.includes(today)) {
        growthState.checkinDates = growthState.checkinDates.concat(today).sort()
      }
      unlockGrowthIfReady(growthState, now)
      const nextRevision = currentRevision + 1

      await transaction.collection(COLLECTION_NAME).doc(openid).update({
        data: { growthState, revision: nextRevision, updatedAt: now },
      })

      return { success: true, openid, growthState, updatedAt: now, revision: nextRevision }
    })
  } catch (error) {
    if (isDocumentNotFound(error)) {
      return createError('GROWTH_NOT_READY', '成长状态尚未初始化，请重新进入小程序')
    }
    console.error(`${LOG_TAG} growth checkin failed`, createDatabaseLog(error))
    return createDatabaseError('growth-checkin', error)
  }
}

async function createFirstUserDocument(openid, rawBootstrap) {
  const now = Date.now()
  const bootstrap = sanitizeGrowthBootstrap(rawBootstrap)
  // 旧客户端不会传 bootstrap；兼容发布窗口内仍按老用户放行，避免先部署云函数造成误锁。
  const growthState = !bootstrap.provided || bootstrap.hasLegacyEvidence
    ? createLegacyGrowthState(bootstrap.acquisitionSource, now)
    : createNewGrowthState(bootstrap, now)
  const documentData = {
    openid,
    schemaVersion: 7,
    records: [],
    categoryHistory: createEmptyCategoryHistory(),
    giftBook: { contacts: [], deletedGiftIds: [], updatedAt: now },
    giftExchanges: { contacts: [], migratedGiftIds: [], deletedRecordIds: [], updatedAt: now },
    moodRecords: [],
    familyState: null,
    companionState: null,
    onboardingState: null,
    growthUnlockPromptAt: 0,
    legacyData: createEmptyLegacyData(),
    growthState,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await db.collection(COLLECTION_NAME).doc(openid).set({ data: documentData })
    return { success: true, openid, data: null, updatedAt: now, revision: 1, growthState }
  } catch (error) {
    console.error(`${LOG_TAG} growth bootstrap failed`, createDatabaseLog(error))
    return createDatabaseError('growth-bootstrap', error)
  }
}

async function ensureCollectionExists() {
  if (typeof db.createCollection !== 'function') {
    console.warn(`${LOG_TAG} createCollection unavailable`, {
      collection: COLLECTION_NAME,
    })
    return false
  }

  try {
    await db.createCollection(COLLECTION_NAME)
    console.info(`${LOG_TAG} collection created`, {
      collection: COLLECTION_NAME,
    })
    return true
  } catch (error) {
    if (isCollectionAlreadyExists(error)) {
      console.info(`${LOG_TAG} collection already exists`, {
        collection: COLLECTION_NAME,
      })
      return true
    }

    console.error(`${LOG_TAG} create collection failed`, createDatabaseLog(error))
    return false
  }
}

function sanitizePayload(rawData) {
  if (!isPlainObject(rawData)) {
    return invalidPayload('同步数据必须是对象')
  }

  const records = Array.isArray(rawData.records) ? rawData.records : []

  if (records.length > MAX_RECORD_COUNT) {
    return invalidPayload(`记录数量不能超过 ${MAX_RECORD_COUNT} 条`)
  }

  return {
    ok: true,
    providedFields: SYNC_DATA_FIELDS.reduce((result, field) => {
      result[field] = Object.prototype.hasOwnProperty.call(rawData, field)
      return result
    }, {}),
    data: {
      records: records.map(sanitizeRecord).filter(Boolean),
      categoryHistory: sanitizeCategoryHistory(rawData.categoryHistory),
      giftBook: sanitizeGiftBook(rawData.giftBook),
      giftExchanges: sanitizeGiftExchanges(rawData.giftExchanges),
      moodRecords: sanitizeMoodRecords(rawData.moodRecords),
      familyState: sanitizeFamilyState(rawData.familyState),
      companionState: sanitizeCompanionState(rawData.companionState),
      onboardingState: sanitizeOnboardingState(rawData.onboardingState),
      growthUnlockPromptAt: sanitizeOptionalTimestamp(rawData.growthUnlockPromptAt) || 0,
      legacyData: sanitizeLegacyData(rawData.legacyData),
    },
  }
}

function sanitizeOnboardingState(rawState) {
  if (!isPlainObject(rawState)) return null
  return {
    initializedAt: sanitizeOptionalTimestamp(rawState.initializedAt) || 0,
    seeded: Boolean(rawState.seeded),
    skippedBecauseUserHadData: Boolean(rawState.skippedBecauseUserHadData),
  }
}

function createEmptyLegacyData() {
  return {
    todayTasks: [],
    scoreState: null,
    petState: null,
    exerciseRewardState: null,
    weRunState: null,
  }
}

/**
 * 兼容归档旧版本产生的本地用户数据。未知业务字段做有限深度 JSON 清洗，
 * 同时递归移除微信运动临时密文和登录凭证，防止凭证进入持久化数据库。
 */
function sanitizeLegacyData(rawData) {
  if (!isPlainObject(rawData)) return createEmptyLegacyData()
  return {
    todayTasks: Array.isArray(rawData.todayTasks)
      ? rawData.todayTasks.slice(0, MAX_RECORD_COUNT).map((item) => sanitizeLegacyJsonValue(item, 0)).filter(isPlainObject)
      : [],
    scoreState: sanitizeLegacyJsonObject(rawData.scoreState),
    petState: sanitizeLegacyJsonObject(rawData.petState),
    exerciseRewardState: sanitizeLegacyJsonObject(rawData.exerciseRewardState),
    weRunState: sanitizeLegacyWeRunState(rawData.weRunState),
  }
}

function sanitizeLegacyWeRunState(rawState) {
  if (!isPlainObject(rawState)) return null
  return compactObject({
    authorized: typeof rawState.authorized === 'boolean' ? rawState.authorized : undefined,
    synced: typeof rawState.synced === 'boolean' ? rawState.synced : undefined,
    syncedAt: sanitizeOptionalTimestamp(rawState.syncedAt) || 0,
    syncDate: sanitizeString(rawState.syncDate, 20),
    stepCount: sanitizeNonNegativeInteger(rawState.stepCount, 0, 1000000),
    stepText: sanitizeString(rawState.stepText, 40),
    targetSteps: sanitizeNonNegativeInteger(rawState.targetSteps, 0, 1000000),
    reachedTarget: typeof rawState.reachedTarget === 'boolean' ? rawState.reachedTarget : undefined,
    statusText: sanitizeString(rawState.statusText, 200),
    lastError: sanitizeString(rawState.lastError, 200),
  })
}

function sanitizeLegacyJsonObject(value) {
  const sanitized = sanitizeLegacyJsonValue(value, 0)
  return isPlainObject(sanitized) ? sanitized : null
}

function sanitizeLegacyJsonValue(value, depth) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 1000)
  if (isFiniteNumber(value)) return value
  if (depth >= 8) return null
  if (Array.isArray(value)) {
    return value.slice(0, 2000).map((item) => sanitizeLegacyJsonValue(item, depth + 1))
  }
  if (!isPlainObject(value)) return null

  return Object.keys(value).slice(0, 200).reduce((result, key) => {
    if (LEGACY_SENSITIVE_KEYS.has(key)) return result
    result[key.slice(0, 100)] = sanitizeLegacyJsonValue(value[key], depth + 1)
    return result
  }, {})
}

/**
 * 只保留小暖养成所需字段，避免旧探索/卡牌数据重新进入业务快照。
 * rewardHistory 兼作跨页面、跨设备防重复凭证，最多保留2000条。
 */
function sanitizeCompanionState(rawState) {
  if (!isPlainObject(rawState) || rawState.version !== 2 || rawState.petId !== 'xiaonuan') {
    return null
  }

  const rewardHistory = Array.isArray(rawState.rewardHistory)
    ? rawState.rewardHistory
      .slice(-2000)
      .map((entry) => {
        if (!isPlainObject(entry)) return null
        const key = sanitizeString(entry.key, 180)
        if (!key) return null
        return {
          key,
          amount: sanitizeNonNegativeInteger(entry.amount, 0, 100),
          rewardedAt: sanitizeTimestamp(entry.rewardedAt),
        }
      })
      .filter(Boolean)
    : []

  const checkinDates = Array.isArray(rawState.checkinDates)
    ? Array.from(new Set(rawState.checkinDates.map(sanitizeOptionalDate).filter(Boolean))).slice(-2000)
    : []

  return {
    version: 2,
    petId: 'xiaonuan',
    name: '小暖',
    adoptedAt: sanitizeTimestamp(rawState.adoptedAt),
    exp: sanitizeNonNegativeInteger(rawState.exp, 0, 10000000),
    checkinDates,
    rewardHistory,
    introShownAt: sanitizeTimestamp(rawState.introShownAt),
    updatedAt: sanitizeTimestamp(rawState.updatedAt),
  }
}

function sanitizeRecord(rawRecord) {
  if (!isPlainObject(rawRecord)) {
    return null
  }

  const title = sanitizeString(rawRecord.title, 200)
  if (!title) {
    return null
  }

  const type = ALLOWED_RECORD_TYPES.includes(rawRecord.type) ? rawRecord.type : 'todo'
  const familyId = sanitizeFamilyId(rawRecord.familyId)
  const visibility = sanitizeRecordVisibility(rawRecord.visibility, familyId)
  const isAllDay = Boolean(rawRecord.isAllDay || !sanitizeTime(rawRecord.time))
  const time = isAllDay ? '' : sanitizeTime(rawRecord.time)
  const date = sanitizeDate(rawRecord.date)
  const remindBeforeMinutes = sanitizeRemindBeforeMinutes(rawRecord.remindBeforeMinutes)
  const recurrenceType = sanitizeRecurrenceType(rawRecord.recurrenceType, type)
  const category = sanitizeString(rawRecord.category, 40) || getDefaultCategory(type)
  const noteKind = type === 'note'
    ? (ALLOWED_NOTE_KINDS.includes(rawRecord.noteKind) ? rawRecord.noteKind : category === '临时便签' ? 'temporary' : 'long_term')
    : 'long_term'
  const quadrant = noteKind === 'temporary'
    ? 'avoid'
    : sanitizeQuadrant(rawRecord.quadrant)

  return compactObject({
    id: sanitizeString(rawRecord.id, 100) || createFallbackId('record'),
    type,
    title,
    category,
    noteKind,
    scheduleVersion: rawRecord.scheduleVersion === 2 ? 2 : 1,
    quadrant,
    quadrantOrder: isFiniteNumber(rawRecord.quadrantOrder) && rawRecord.quadrantOrder >= 0 ? rawRecord.quadrantOrder : 0,
    typeOrder: isFiniteNumber(rawRecord.typeOrder) && rawRecord.typeOrder >= 0 ? rawRecord.typeOrder : 0,
    anniversaryMode: sanitizeAnniversaryMode(rawRecord.anniversaryMode, type, title, category),
    date,
    time,
    isAllDay,
    remindAt: sanitizeOptionalTimestamp(rawRecord.remindAt),
    remindBeforeMinutes,
    repeatRule: type === 'anniversary' ? 'yearly' : ALLOWED_REPEAT_RULES.includes(rawRecord.repeatRule) ? rawRecord.repeatRule : 'none',
    recurrenceType,
    weeklyDays: recurrenceType === 'weekly' ? sanitizeWeeklyDays(rawRecord.weeklyDays, date) : [],
    targetCount: recurrenceType === 'none' ? 0 : 1,
    targetUnit: recurrenceType === 'none' ? '' : '次',
    checkinHistory: recurrenceType === 'none' ? {} : sanitizeCheckinHistory(rawRecord.checkinHistory),
    status: recurrenceType === 'none' && ALLOWED_STATUSES.includes(rawRecord.status) ? rawRecord.status : 'pending',
    note: sanitizeString(rawRecord.note, 1000),
    visibility,
    familyId: visibility === 'family' ? familyId : '',
    pinnedAt: noteKind === 'temporary' ? 0 : sanitizeOptionalTimestamp(rawRecord.pinnedAt),
    createdAt: sanitizeTimestamp(rawRecord.createdAt),
    updatedAt: sanitizeTimestamp(rawRecord.updatedAt),
    deletedAt: sanitizeOptionalTimestamp(rawRecord.deletedAt) || null,
  })
}

function sanitizeGiftBook(rawBook) {
  if (!isPlainObject(rawBook)) {
    return {
      contacts: [],
      deletedGiftIds: [],
      updatedAt: Date.now(),
    }
  }

  const contacts = Array.isArray(rawBook.contacts)
    ? rawBook.contacts.slice(0, MAX_CONTACT_COUNT).map(sanitizeGiftContact).filter(Boolean)
    : []

  return {
    contacts,
    deletedGiftIds: sanitizeStringList(rawBook.deletedGiftIds, MAX_DELETED_ENTRY_ID_COUNT, 100),
    updatedAt: sanitizeTimestamp(rawBook.updatedAt),
  }
}

function createEmptyCategoryHistory() {
  return {
    todo: [],
    anniversary: [],
    expiry: [],
    note: [],
  }
}

/** 仅保存用户自定义分类建议；每类最多20项，避免无界增长。 */
function sanitizeCategoryHistory(rawHistory) {
  const source = isPlainObject(rawHistory) ? rawHistory : {}
  return ['todo', 'anniversary', 'expiry', 'note'].reduce((result, key) => {
    result[key] = sanitizeStringList(source[key], 20, 20)
    return result
  }, createEmptyCategoryHistory())
}

function sanitizeQuadrant(value) {
  if (value === 'do') return 'do-now'
  if (value === 'delegate') return 'quick'
  return ALLOWED_QUADRANTS.includes(value) ? value : 'schedule'
}

function sanitizeGiftContact(rawContact) {
  if (!isPlainObject(rawContact)) {
    return null
  }

  const name = sanitizeString(rawContact.name, 20)
  if (!name) {
    return null
  }

  const gifts = Array.isArray(rawContact.gifts)
    ? rawContact.gifts.slice(0, MAX_GIFT_COUNT_PER_CONTACT).map(sanitizeGiftRecord).filter(Boolean)
    : []

  return {
    id: sanitizeString(rawContact.id, 100) || createFallbackId('gift_contact'),
    name,
    relation: sanitizeString(rawContact.relation, 12) || '联系人',
    avatar: sanitizeString(rawContact.avatar, 4) || '🎁',
    birthday: sanitizeOptionalDate(rawContact.birthday),
    wishes: sanitizeStringList(rawContact.wishes, 8, 20),
    note: sanitizeString(rawContact.note, 200),
    gifts,
    createdAt: sanitizeTimestamp(rawContact.createdAt),
    updatedAt: sanitizeTimestamp(rawContact.updatedAt),
  }
}

function sanitizeGiftRecord(rawGift) {
  if (!isPlainObject(rawGift)) {
    return null
  }

  const title = sanitizeString(rawGift.title, 30)
  if (!title) {
    return null
  }

  return {
    id: sanitizeString(rawGift.id, 100) || createFallbackId('gift'),
    direction: rawGift.direction === 'received' ? 'received' : 'sent',
    title,
    occasion: sanitizeString(rawGift.occasion, 20) || '日常',
    date: sanitizeDate(rawGift.date),
    amount: sanitizeAmount(rawGift.amount),
    note: sanitizeString(rawGift.note, 200),
    createdAt: sanitizeTimestamp(rawGift.createdAt),
    updatedAt: sanitizeOptionalTimestamp(rawGift.updatedAt) || sanitizeTimestamp(rawGift.createdAt),
  }
}

function sanitizeGiftExchanges(rawBook) {
  if (!isPlainObject(rawBook)) {
    return {
      contacts: [],
      migratedGiftIds: [],
      deletedRecordIds: [],
      updatedAt: Date.now(),
    }
  }

  const contacts = Array.isArray(rawBook.contacts)
    ? rawBook.contacts.slice(0, MAX_GIFT_EXCHANGE_CONTACT_COUNT).map(sanitizeGiftExchangeContact).filter(Boolean)
    : []

  return {
    contacts,
    migratedGiftIds: sanitizeStringList(rawBook.migratedGiftIds, MAX_MIGRATED_GIFT_ID_COUNT, 100),
    deletedRecordIds: sanitizeStringList(rawBook.deletedRecordIds, MAX_DELETED_ENTRY_ID_COUNT, 100),
    updatedAt: sanitizeTimestamp(rawBook.updatedAt),
  }
}

function sanitizeGiftExchangeContact(rawContact) {
  if (!isPlainObject(rawContact)) {
    return null
  }

  const name = sanitizeString(rawContact.name, 20)
  if (!name) {
    return null
  }

  const records = Array.isArray(rawContact.records)
    ? rawContact.records.slice(0, MAX_GIFT_EXCHANGE_RECORD_COUNT_PER_CONTACT).map(sanitizeGiftExchangeRecord).filter(Boolean)
    : []

  return {
    id: sanitizeString(rawContact.id, 100) || createFallbackId('gift_exchange_contact'),
    name,
    relation: sanitizeString(rawContact.relation, 12),
    avatar: sanitizeString(rawContact.avatar, 4) || '🎁',
    records,
    createdAt: sanitizeTimestamp(rawContact.createdAt),
    updatedAt: sanitizeTimestamp(rawContact.updatedAt),
  }
}

function sanitizeGiftExchangeRecord(rawRecord) {
  if (!isPlainObject(rawRecord)) {
    return null
  }

  const giftName = sanitizeString(rawRecord.giftName, 30)
  if (!giftName) {
    return null
  }

  const amount = sanitizeAmount(rawRecord.amount)
  const hasAmount = Boolean(rawRecord.hasAmount && amount > 0)

  return {
    id: sanitizeString(rawRecord.id, 100) || createFallbackId('gift_exchange'),
    direction: rawRecord.direction === 'sent' ? 'sent' : 'received',
    entryKind: rawRecord.entryKind === 'cash' || Boolean(rawRecord.sourceGiftId) ? 'cash' : 'gift',
    giftName,
    date: sanitizeDate(rawRecord.date),
    amount: hasAmount ? amount : 0,
    hasAmount,
    note: sanitizeString(rawRecord.note, 200),
    sourceGiftId: sanitizeString(rawRecord.sourceGiftId, 100),
    createdAt: sanitizeTimestamp(rawRecord.createdAt),
    updatedAt: sanitizeOptionalTimestamp(rawRecord.updatedAt) || sanitizeTimestamp(rawRecord.createdAt),
  }
}

function sanitizeMoodRecords(rawRecords) {
  if (!Array.isArray(rawRecords)) {
    return []
  }

  return rawRecords.slice(0, MAX_MOOD_COUNT).map(sanitizeMoodRecord).filter(Boolean)
}

function sanitizeMoodRecord(rawRecord) {
  if (!isPlainObject(rawRecord)) {
    return null
  }

  const mood = ALLOWED_MOODS.includes(rawRecord.mood) ? rawRecord.mood : 'happy'
  const moodMeta = getMoodMeta(mood)

  return {
    id: sanitizeString(rawRecord.id, 100) || createFallbackId('mood'),
    mood,
    label: moodMeta.label,
    emoji: moodMeta.emoji,
    color: moodMeta.color,
    note: sanitizeString(rawRecord.note, 300),
    createdAt: sanitizeTimestamp(rawRecord.createdAt),
    date: sanitizeDate(rawRecord.date),
  }
}

function stripPrivateFields(documentData) {
  return {
    schemaVersion: 7,
    records: Array.isArray(documentData.records) ? documentData.records : [],
    categoryHistory: sanitizeCategoryHistory(documentData.categoryHistory),
    giftBook: isPlainObject(documentData.giftBook)
      ? documentData.giftBook
      : { contacts: [], deletedGiftIds: [], updatedAt: 0 },
    giftExchanges: isPlainObject(documentData.giftExchanges)
      ? documentData.giftExchanges
      : { contacts: [], migratedGiftIds: [], deletedRecordIds: [], updatedAt: 0 },
    moodRecords: Array.isArray(documentData.moodRecords) ? documentData.moodRecords : [],
    familyState: isPlainObject(documentData.familyState) ? documentData.familyState : null,
    companionState: sanitizeCompanionState(documentData.companionState),
    onboardingState: sanitizeOnboardingState(documentData.onboardingState),
    growthUnlockPromptAt: sanitizeOptionalTimestamp(documentData.growthUnlockPromptAt) || 0,
    legacyData: sanitizeLegacyData(documentData.legacyData),
    updatedAt: isFiniteNumber(documentData.updatedAt) ? documentData.updatedAt : 0,
  }
}

function sanitizeGrowthBootstrap(rawBootstrap) {
  return {
    provided: isPlainObject(rawBootstrap),
    hasLegacyEvidence: Boolean(rawBootstrap && rawBootstrap.hasLegacyEvidence),
    acquisitionSource: rawBootstrap && rawBootstrap.acquisitionSource === 'growth_share' ? 'growth_share' : 'direct',
  }
}

function createLegacyGrowthState(acquisitionSource, now) {
  return {
    version: 1,
    cohort: 'legacy',
    firstSeenAt: now,
    checkinDates: [],
    milestoneIds: [],
    giftUnlockedAt: now,
    unlockReason: 'legacy',
    acquisitionSource: acquisitionSource === 'growth_share' ? 'growth_share' : 'direct',
  }
}

function createNewGrowthState(rawBootstrap, now) {
  const bootstrap = sanitizeGrowthBootstrap(rawBootstrap)
  return {
    version: 1,
    cohort: 'new',
    firstSeenAt: now,
    checkinDates: [],
    milestoneIds: [],
    giftUnlockedAt: 0,
    unlockReason: '',
    acquisitionSource: bootstrap.acquisitionSource,
  }
}

/** 已有云文档但没有成长字段时一律视为老用户，避免客户端升级后误锁。 */
function ensureExistingUserGrowthState(rawState, fallbackFirstSeenAt) {
  if (!isPlainObject(rawState) || rawState.version !== 1) {
    return createLegacyGrowthState('direct', isFiniteNumber(fallbackFirstSeenAt) ? fallbackFirstSeenAt : Date.now())
  }

  const cohort = rawState.cohort === 'legacy' ? 'legacy' : 'new'
  const checkinDates = Array.isArray(rawState.checkinDates)
    ? rawState.checkinDates
      .filter((date, index, list) => /^\d{4}-\d{2}-\d{2}$/.test(String(date)) && list.indexOf(date) === index)
      .slice(-3660)
      .sort()
    : []
  const milestoneIds = Array.isArray(rawState.milestoneIds)
    ? rawState.milestoneIds.filter((id, index, list) => GROWTH_MILESTONE_IDS.includes(id) && list.indexOf(id) === index)
    : []
  const state = {
    version: 1,
    cohort,
    firstSeenAt: isFiniteNumber(rawState.firstSeenAt) ? rawState.firstSeenAt : Date.now(),
    checkinDates,
    milestoneIds,
    giftUnlockedAt: isFiniteNumber(rawState.giftUnlockedAt) ? Math.max(0, rawState.giftUnlockedAt) : 0,
    unlockReason: rawState.unlockReason === 'legacy' || rawState.unlockReason === 'growth' ? rawState.unlockReason : '',
    acquisitionSource: rawState.acquisitionSource === 'growth_share' ? 'growth_share' : 'direct',
  }

  if (cohort === 'legacy') {
    state.giftUnlockedAt = state.giftUnlockedAt || state.firstSeenAt
    state.unlockReason = 'legacy'
  } else if (state.giftUnlockedAt) {
    state.unlockReason = 'growth'
  }

  return state
}

function deriveGrowthMilestones(rawState, snapshot, now) {
  const state = ensureExistingUserGrowthState(rawState, now)
  if (state.cohort === 'legacy' || state.giftUnlockedAt) {
    return state
  }

  const records = Array.isArray(snapshot.records) ? snapshot.records : []
  const moods = Array.isArray(snapshot.moodRecords) ? snapshot.moodRecords : []
  const earned = new Set(state.milestoneIds)

  if (records.some((record) => !isDemoEntity(record) && record.type === 'todo' && record.recurrenceType !== 'none' && !record.deletedAt)) {
    earned.add('first_plan_created')
  }

  if (records.some((record) => record.status === 'done' || hasCompletedCheckin(record.checkinHistory))) {
    earned.add('first_item_completed')
  }

  if (
    records.some((record) => !isDemoEntity(record) && record.type === 'anniversary' && !record.deletedAt) ||
    moods.some((mood) => !isDemoEntity(mood))
  ) {
    earned.add('first_memory_added')
  }

  state.milestoneIds = GROWTH_MILESTONE_IDS.filter((id) => earned.has(id))
  unlockGrowthIfReady(state, now)
  return state
}

function hasCompletedCheckin(history) {
  return isPlainObject(history) && Object.keys(history).some((key) => isPlainObject(history[key]) && isFiniteNumber(history[key].completedAt))
}

function isDemoEntity(value) {
  return isPlainObject(value) && String(value.id || '').startsWith('demo_')
}

function unlockGrowthIfReady(state, now) {
  const progress = Math.min(7, state.checkinDates.length + state.milestoneIds.length)
  if (!state.giftUnlockedAt && progress >= 7) {
    state.giftUnlockedAt = now
    state.unlockReason = 'growth'
  }
}

function formatBeijingDate(timestamp) {
  const date = new Date(timestamp + (8 * 60 * 60 * 1000))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function getDocumentRevision(documentData) {
  return isPlainObject(documentData) && isFiniteNumber(documentData.revision)
    ? Math.max(1, Math.floor(documentData.revision))
    : 1
}

function createDatabaseError(action, error) {
  const code = classifyDatabaseError(action, error)

  return createError(code, getDatabaseErrorMessage(action, code), getDatabaseDebugHint(code))
}

function classifyDatabaseError(action, error) {
  const text = getErrorText(error).toLowerCase()

  if (text.includes('permission') || text.includes('denied') || text.includes('权限')) {
    return 'COLLECTION_PERMISSION_DENIED'
  }

  if (
    text.includes('collection') &&
    (text.includes('not found') || text.includes('not exist') || text.includes('does not exist') || text.includes('不存在'))
  ) {
    return 'COLLECTION_NOT_READY'
  }

  return action === 'pull' ? 'PULL_FAILED' : 'PUSH_FAILED'
}

function getDatabaseErrorMessage(action, code) {
  if (code === 'COLLECTION_PERMISSION_DENIED') {
    return `云端集合 ${COLLECTION_NAME} 权限不允许当前云函数读写`
  }

  if (code === 'COLLECTION_NOT_READY') {
    return `云端集合 ${COLLECTION_NAME} 未创建或不可访问`
  }

  if (action === 'pull') {
    return '读取云端业务数据失败，请确认集合已创建'
  }

  return '写入云端业务数据失败，请确认集合权限和云函数环境'
}

function getDatabaseDebugHint(code) {
  if (code === 'COLLECTION_PERMISSION_DENIED') {
    return `确认 ${COLLECTION_NAME} 集合安全规则允许云函数读写，并在云函数日志搜索 ${LOG_TAG} 查看原始数据库错误。`
  }

  if (code === 'COLLECTION_NOT_READY') {
    return `在云开发数据库创建 ${COLLECTION_NAME} 集合，确认当前云函数环境正确，然后回到“我的”页点重试。`
  }

  return `在微信开发者工具云函数日志搜索 ${LOG_TAG}，确认 ${COLLECTION_NAME} 集合、权限和云函数运行环境。`
}

function createDatabaseLog(error) {
  return {
    collection: COLLECTION_NAME,
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

function createError(code, message, debug) {
  return {
    success: false,
    code,
    message,
    debug: debug || getDefaultDebugHint(code),
  }
}

function getDefaultDebugHint(code) {
  if (code === 'NO_OPENID') {
    return `确认 ${LOG_TAG} 由小程序端 wx.cloud.callFunction 调用，并在云函数日志检查 cloud.getWXContext().OPENID。`
  }

  return `请在微信开发者工具 Console 搜索 ${LOG_TAG}，并在云函数日志中查看详细错误。`
}

function invalidPayload(message) {
  return {
    ok: false,
    message,
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isDocumentNotFound(error) {
  const message = getErrorText(error).toLowerCase()
  if (message.includes('collection')) {
    return false
  }

  return message.includes('does not exist') || message.includes('document.get:fail') || message.includes('not found')
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

function isCollectionAlreadyExists(error) {
  const message = getErrorText(error).toLowerCase()
  return message.includes('collection') && (message.includes('already exist') || message.includes('exists') || message.includes('已存在'))
}

function sanitizeString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function sanitizeFamilyId(value) {
  return sanitizeString(value, 100)
}

function sanitizeRecordVisibility(value, familyId) {
  if (value === 'family' && familyId && ALLOWED_RECORD_VISIBILITIES.includes(value)) {
    return 'family'
  }

  return 'private'
}

function sanitizeFamilyState(rawFamilyState) {
  if (!isPlainObject(rawFamilyState)) {
    return null
  }

  const familyId = sanitizeFamilyId(rawFamilyState.familyId)

  if (!familyId) {
    return null
  }

  const createdAt = sanitizeTimestamp(rawFamilyState.createdAt)

  return {
    familyId,
    displayName: sanitizeString(rawFamilyState.displayName, 24) || '我的家庭',
    createdAt,
    updatedAt: sanitizeOptionalTimestamp(rawFamilyState.updatedAt) || createdAt,
  }
}

function sanitizeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : formatDate(new Date())
}

function sanitizeOptionalDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : ''
}

function sanitizeTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || '')) ? value : ''
}

function sanitizeTimestamp(value) {
  return isFiniteNumber(value) && value > 0 ? value : Date.now()
}

function sanitizeOptionalTimestamp(value) {
  return isFiniteNumber(value) && value > 0 ? value : undefined
}

function sanitizeRemindBeforeMinutes(value) {
  return sanitizeNonNegativeInteger(value, 0, 10080)
}

function sanitizeRecurrenceType(value, recordType) {
  if (recordType !== 'todo') {
    return 'none'
  }

  return ALLOWED_RECURRENCE_TYPES.includes(value) ? value : 'none'
}

function sanitizeAnniversaryMode(value, recordType, title, category) {
  if (recordType !== 'anniversary') {
    return 'elapsed'
  }

  return ALLOWED_ANNIVERSARY_MODES.includes(value) ? value : inferAnniversaryMode(title, category)
}

function inferAnniversaryMode(title, category) {
  const text = `${title || ''}${category || ''}`
  return text.includes('生日') || text.includes('节日') ? 'countdown' : 'elapsed'
}

function sanitizeWeeklyDays(value, fallbackDate) {
  const fallback = new Date(String(fallbackDate).replace(/-/g, '/')).getDay()
  const days = Array.isArray(value)
    ? value.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : []
  const normalizedDays = days.length ? days : [fallback]

  return normalizedDays
    .filter((day, index) => normalizedDays.indexOf(day) === index)
    .sort((first, second) => first - second)
}

function sanitizeTargetCount(value) {
  return sanitizeNonNegativeInteger(value, 0, 99999)
}

function sanitizeAmount(value) {
  if (!isFiniteNumber(value) || value < 0) {
    return 0
  }

  return Math.min(Math.round(value * 100) / 100, 999999)
}

function sanitizeStringList(value, maxCount, maxLength) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item) => typeof item === 'string')
    .map((item) => sanitizeString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxCount)
}

function sanitizeCheckinHistory(value) {
  if (!isPlainObject(value)) {
    return {}
  }

  return Object.keys(value)
    .sort()
    .reverse()
    .slice(0, MAX_CHECKIN_HISTORY_COUNT)
    .reduce((result, periodKey) => {
      const entry = sanitizeCheckinEntry(periodKey, value[periodKey])
      if (entry) {
        result[entry.periodKey] = entry
      }
      return result
    }, {})
}

function sanitizeCheckinEntry(periodKey, value) {
  if (
    !/^day:\d{4}-\d{2}-\d{2}$/.test(periodKey) &&
    !/^week:\d{4}-\d{2}-\d{2}$/.test(periodKey) &&
    !/^month:\d{4}-\d{2}$/.test(periodKey)
  ) {
    return null
  }

  if (!isPlainObject(value)) {
    return null
  }

  return {
    periodKey,
    completedAt: sanitizeTimestamp(value.completedAt),
    actualCount: sanitizeTargetCount(value.actualCount),
    note: sanitizeString(value.note, 100),
  }
}

function getMoodMeta(mood) {
  const map = {
    happy: { label: '开心', emoji: '😊', color: 'rose' },
    calm: { label: '还不错', emoji: '🙂', color: 'mint' },
    tired: { label: '平静', emoji: '😌', color: 'blue' },
    stressed: { label: '有点低落', emoji: '😕', color: 'amber' },
    sad: { label: '难过', emoji: '😔', color: 'violet' },
  }

  return map[mood] || map.happy
}

function sanitizeNonNegativeInteger(value, fallback, max) {
  if (!isFiniteNumber(value)) {
    return fallback
  }

  return Math.min(Math.max(0, Math.floor(value)), max)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function compactObject(value) {
  return Object.keys(value).reduce((result, key) => {
    if (value[key] !== undefined) {
      result[key] = value[key]
    }
    return result
  }, {})
}

function createFallbackId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000).toString(36)}`
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDefaultCategory(type) {
  if (type === 'anniversary') {
    return '重要纪念日'
  }

  if (type === 'expiry') {
    return '用品到期'
  }

  if (type === 'note') {
    return '临时便签'
  }

  return '生活待办'
}
