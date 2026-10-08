import {
  CATEGORY_HISTORY_STORAGE_KEY,
  COMPANION_STORAGE_KEY,
  FAMILY_STORAGE_KEY,
  GIFT_BOOK_STORAGE_KEY,
  GIFT_EXCHANGE_STORAGE_KEY,
  LEGACY_PET_STORAGE_KEY,
  MOOD_RECORD_STORAGE_KEY,
  ONBOARDING_MOCK_STORAGE_KEY,
  RECORD_STORAGE_KEY,
} from '../constants/remember'
import { CLOUD_ENV_ID, callCloudFunction } from './cloud-service'
import {
  GrowthBootstrapContext,
  GrowthState,
  saveGrowthState,
} from './growth-service'

interface CloudUserDataPayload {
  schemaVersion: 7
  records?: unknown[]
  categoryHistory?: unknown
  giftBook?: unknown
  giftExchanges?: unknown
  moodRecords?: unknown[]
  familyState?: unknown
  companionState?: unknown
  onboardingState?: unknown
  growthUnlockPromptAt?: number
  legacyData?: LegacyUserDataPayload
  updatedAt?: number
}

interface LegacyUserDataPayload {
  todayTasks?: unknown[]
  scoreState?: unknown
  petState?: unknown
  exerciseRewardState?: unknown
  weRunState?: unknown
}

interface SyncUserDataResult {
  success: boolean
  code?: string
  message?: string
  debug?: string
  openid?: string
  data?: CloudUserDataPayload | null
  updatedAt?: number
  /** 云端文档的乐观锁版本；每次业务写入成功后递增。 */
  revision?: number
  growthState?: GrowthState
}

interface SyncFailureDetail {
  code: string
  message: string
  debugHint: string
}

interface LocalSyncMeta {
  /** 本机最后完成闭环迁移的快照版本；用于识别升级后需重新合并的老设备。 */
  schemaVersion: number
  ownerOpenid: string
  migratedAt: number
  lastSyncedAt: number
  /** 最近成功拉取或上传的云端版本，用于防止多设备整包互相覆盖。 */
  lastRevision: number
  dirtyAt: number
  lastFailedAt: number
  lastErrorMessage: string
  lastErrorCode: string
  lastDebugHint: string
  /** 连续失败次数仅用于本机诊断，成功同步后自动归零。 */
  consecutiveFailures?: number
}

export interface UserDataCloudSyncStatus {
  lastSyncedAt: number
  dirtyAt: number
  hasPendingChanges: boolean
  lastFailedAt: number
  lastErrorMessage: string
  lastErrorCode: string
  lastDebugHint: string
  consecutiveFailures: number
  snapshotBytes: number
  syncing: boolean
}

const SYNC_FUNCTION_NAME = 'sixiangSyncUserData'
const SYNC_COLLECTION_NAME = 'sixiang_user_data'
const SYNC_META_STORAGE_KEY = 'sixiang_cloud_sync_meta_v1'
const LEGACY_TODO_STORAGE_KEY = 'sixiang_today_tasks_v1'
const LEGACY_SCORE_STORAGE_KEY = 'sixiang_score_state_v1'
const LEGACY_EXERCISE_STORAGE_KEY = 'sixiang_exercise_rewards_v1'
const LEGACY_WERUN_STORAGE_KEY = 'sixiang_werun_state_v1'
const GROWTH_UNLOCK_PROMPT_STORAGE_KEY = 'sixiang_growth_unlock_prompt_v1'
const SYNC_DEBOUNCE_MS = 800
const SYNC_LOG_TAG = '[sixiangSyncUserData]'

let syncTimer: ReturnType<typeof setTimeout> | null = null
let syncInFlight: Promise<SyncUserDataResult | null> | null = null
let startupSyncReady = false
// 只有成功读取过当前 openid 的云端基线后才允许上传，避免新设备拉取失败时用空数据覆盖云端。
let cloudBaselineReady = false
let cloudBaselineRevision = 0
const MAX_CONFLICT_RETRY_COUNT = 2

/**
 * 读取记得本地业务快照。
 *
 * 调用时机：启动首轮同步、本地记录变更后的防抖上传。
 * 注意：除临时登录凭证、同步元数据和本机待授权队列外，所有持久化用户资料都会进入快照。
 */
export function loadLocalUserDataSnapshot(): CloudUserDataPayload {
  return {
    schemaVersion: 7,
    records: readArrayStorage(RECORD_STORAGE_KEY),
    categoryHistory: readObjectStorage(CATEGORY_HISTORY_STORAGE_KEY),
    giftBook: readObjectStorage(GIFT_BOOK_STORAGE_KEY),
    giftExchanges: readObjectStorage(GIFT_EXCHANGE_STORAGE_KEY),
    moodRecords: readArrayStorage(MOOD_RECORD_STORAGE_KEY),
    familyState: readObjectStorage(FAMILY_STORAGE_KEY),
    companionState: readObjectStorage(COMPANION_STORAGE_KEY),
    onboardingState: readObjectStorage(ONBOARDING_MOCK_STORAGE_KEY),
    growthUnlockPromptAt: readNumberStorage(GROWTH_UNLOCK_PROMPT_STORAGE_KEY),
    legacyData: {
      todayTasks: readArrayStorage(LEGACY_TODO_STORAGE_KEY),
      scoreState: readObjectStorage(LEGACY_SCORE_STORAGE_KEY),
      petState: readObjectStorage(LEGACY_PET_STORAGE_KEY),
      exerciseRewardState: readObjectStorage(LEGACY_EXERCISE_STORAGE_KEY),
      // 微信运动的加密载荷只供一次性解密，不能作为跨设备资料上传。
      weRunState: sanitizeLocalWeRunStateForCloud(readObjectStorage(LEGACY_WERUN_STORAGE_KEY)),
    },
  }
}

/**
 * 页面和本地服务可用此状态避免首轮云回填前做自动写回。
 * 用户主动保存记录仍会写本地，并通过 dirtyAt 在稍后重试上传。
 */
export function isUserDataCloudSyncReady(): boolean {
  return startupSyncReady
}

/**
 * 读取云同步状态卡需要的本地元数据。
 *
 * 调用时机：“我的”页加载、页面显示、后台同步状态变化后。
 * 注意：这里只读取本地 storage，不发起网络请求，避免页面刷新时额外消耗云函数调用次数。
 */
export function loadUserDataCloudSyncStatus(): UserDataCloudSyncStatus {
  const meta = loadLocalSyncMeta()
  const snapshotBytes = getSnapshotBytes(loadLocalUserDataSnapshot())

  return {
    lastSyncedAt: meta.lastSyncedAt,
    dirtyAt: meta.dirtyAt,
    hasPendingChanges: Boolean(meta.dirtyAt),
    lastFailedAt: meta.lastFailedAt,
    lastErrorMessage: meta.lastErrorMessage,
    lastErrorCode: meta.lastErrorCode,
    lastDebugHint: meta.lastDebugHint,
    consecutiveFailures: meta.consecutiveFailures || 0,
    snapshotBytes,
    syncing: Boolean(syncInFlight),
  }
}

/**
 * 小程序启动后的首轮云同步。
 *
 * 策略：
 * - 同一 openid：有本地未上传改动时本地优先，否则拉取云端快照。
 * - openid 变化：直接切换到当前账号云端快照，避免上一账号数据串号。
 * - 首次接入：本地存在任何用户资料时都迁移，并与当前账号云端快照合并。
 */
export async function syncUserDataOnLaunch(bootstrapContext?: GrowthBootstrapContext): Promise<SyncUserDataResult> {
  startupSyncReady = false
  cloudBaselineReady = false
  cloudBaselineRevision = 0
  clearScheduledSync()

  try {
    const pullResult = ensureCloudSuccess(await pullUserDataFromCloud(bootstrapContext))
    saveGrowthState(pullResult.growthState)
    const openid = pullResult.openid || ''

    if (!openid) {
      throw createSyncError('NO_OPENID', '云同步未返回用户 openid')
    }

    // pull 成功且拿到 openid，说明后续上传已经有可靠的账号和云端基线。
    cloudBaselineReady = true
    if (!hasCloudRevision(pullResult)) {
      cloudBaselineReady = false
      throw createSyncError(
        'SYNC_PROTOCOL_NOT_READY',
        '云端同步协议尚未升级，为保护已有数据已暂停上传',
        `请先部署第7版 ${SYNC_FUNCTION_NAME}，确认 pull 返回 revision 后再发布客户端。`,
      )
    }
    cloudBaselineRevision = getCloudRevision(pullResult)

    const cloudData = pullResult.data || null
    const localData = loadLocalUserDataSnapshot()
    const meta = loadLocalSyncMeta()
    const ownerChanged = Boolean(meta.ownerOpenid && meta.ownerOpenid !== openid)
    const isFirstMigration = !meta.ownerOpenid || !meta.migratedAt || meta.schemaVersion < 7

    if (ownerChanged) {
      hydrateLocalUserData(cloudData, true)
      saveLocalSyncMeta({
        schemaVersion: 7,
        ownerOpenid: openid,
        migratedAt: Date.now(),
        lastSyncedAt: getCloudUpdatedAt(pullResult),
        lastRevision: cloudBaselineRevision,
        dirtyAt: 0,
        lastFailedAt: 0,
        lastErrorMessage: '',
        lastErrorCode: '',
        lastDebugHint: '',
      })
      return pullResult
    }

    if (isFirstMigration) {
      if (hasMeaningfulLocalData(localData)) {
        markLocalDataDirty(openid)
        const nextData = cloudData
          ? mergeUserDataSnapshots(cloudData, loadLocalUserDataSnapshot())
          : loadLocalUserDataSnapshot()
        hydrateLocalUserData(nextData, true)
        return pushSnapshotAndCommit(nextData)
      }

      if (cloudData) {
        hydrateLocalUserData(cloudData, true)
      }

      saveLocalSyncMeta({
        schemaVersion: 7,
        ownerOpenid: openid,
        migratedAt: Date.now(),
        lastSyncedAt: getCloudUpdatedAt(pullResult),
        lastRevision: cloudBaselineRevision,
        dirtyAt: 0,
        lastFailedAt: 0,
        lastErrorMessage: '',
        lastErrorCode: '',
        lastDebugHint: '',
      })
      return pullResult
    }

    if (meta.dirtyAt) {
      // 当前设备离线期间若云端已被另一台设备更新，先合并再上传，避免整包覆盖较新的云端数据。
      if (cloudData && (
        cloudBaselineRevision > meta.lastRevision ||
        getCloudUpdatedAt(pullResult) > meta.lastSyncedAt
      )) {
        const mergedData = mergeUserDataSnapshots(cloudData, localData)
        hydrateLocalUserData(mergedData, true)
        markLocalDataDirty(openid)
        return pushSnapshotAndCommit(mergedData)
      }
      return pushSnapshotAndCommit(localData)
    }

    if (cloudData) {
      if (loadLocalSyncMeta().dirtyAt) {
        return pushSnapshotAndCommit(loadLocalUserDataSnapshot())
      }

      hydrateLocalUserData(cloudData, true)
      saveLocalSyncMeta({
        ...meta,
        schemaVersion: 7,
        ownerOpenid: openid,
        migratedAt: meta.migratedAt || Date.now(),
        lastSyncedAt: getCloudUpdatedAt(pullResult),
        lastRevision: cloudBaselineRevision,
        dirtyAt: 0,
        lastFailedAt: 0,
        lastErrorMessage: '',
        lastErrorCode: '',
        lastDebugHint: '',
      })
      return pullResult
    }

    if (hasMeaningfulLocalData(localData)) {
      markLocalDataDirty(openid)
      return pushSnapshotAndCommit(localData)
    }

    saveLocalSyncMeta({
      ...meta,
      schemaVersion: 7,
      ownerOpenid: openid,
      migratedAt: meta.migratedAt || Date.now(),
      lastSyncedAt: 0,
      lastRevision: cloudBaselineRevision,
      dirtyAt: 0,
      lastFailedAt: 0,
      lastErrorMessage: '',
      lastErrorCode: '',
      lastDebugHint: '',
    })
    return pullResult
  } catch (error) {
    saveSyncFailure(error)
    throw error
  } finally {
    startupSyncReady = true
    notifyCurrentPagesUserDataReady()

    const meta = loadLocalSyncMeta()
    if (cloudBaselineReady && meta.dirtyAt && !shouldPauseAutoRetry(meta.lastErrorCode)) {
      schedulePendingSync()
    }
  }
}

/**
 * 本地业务数据变更后的防抖上传。
 *
 * 调用方不需要等待上传完成；失败时只保留 dirtyAt，不阻塞用户记录生活事项。
 */
export function scheduleUserDataCloudSync(): void {
  markLocalDataDirty()

  if (!startupSyncReady || !cloudBaselineReady) {
    return
  }

  schedulePendingSync()
}

export function flushUserDataCloudSync(): Promise<SyncUserDataResult | null> {
  const meta = loadLocalSyncMeta()
  let syncSucceeded = false

  if (!meta.dirtyAt) {
    return Promise.resolve(null)
  }

  if (!cloudBaselineReady) {
    return Promise.reject(createSyncError(
      'BASELINE_NOT_READY',
      '尚未成功读取当前账号的云端数据，已暂停上传以保护原有数据',
    ))
  }

  if (syncInFlight) {
    return syncInFlight
  }

  syncInFlight = pushSnapshotAndCommit(loadLocalUserDataSnapshot())
    .then((result) => {
      syncSucceeded = true
      return result
    })
    .catch((error) => {
      saveSyncFailure(error)
      const failure = buildSyncFailureDetail(error)
      console.warn(`${SYNC_LOG_TAG} 记得云同步失败，已保留本地缓存和待上传改动；可在“我的”页点击重试`, {
        code: failure.code,
        message: failure.message,
        debugHint: failure.debugHint,
      }, error)
      throw error
    })
    .finally(() => {
      syncInFlight = null

      const meta = loadLocalSyncMeta()
      if (!syncSucceeded && meta.dirtyAt && !shouldPauseAutoRetry(meta.lastErrorCode)) {
        schedulePendingSync()
      }

      notifyCurrentPagesCloudSyncStatusChanged()
    })

  notifyCurrentPagesCloudSyncStatusChanged()

  return syncInFlight
}

/**
 * 用户手动重试云同步。
 *
 * 调用时机：“我的”页云同步状态卡按钮点击后。
 * 注意：有待上传改动时只推送本地快照；没有待上传改动时重新做一次 pull 检查，
 * 方便在部署云函数、修正集合权限或登录 openid 问题后立即验证。
 */
export function retryUserDataCloudSync(): Promise<SyncUserDataResult | null> {
  const meta = loadLocalSyncMeta()

  console.info(`${SYNC_LOG_TAG} 用户手动触发云同步重试`, {
    env: CLOUD_ENV_ID,
    functionName: SYNC_FUNCTION_NAME,
    hasPendingChanges: Boolean(meta.dirtyAt),
    lastErrorCode: meta.lastErrorCode || '',
  })

  if (!cloudBaselineReady) {
    return syncUserDataOnLaunch()
  }

  if (meta.dirtyAt) {
    return flushUserDataCloudSync()
  }

  if (syncInFlight) {
    return syncInFlight
  }

  return syncUserDataOnLaunch()
}

function pullUserDataFromCloud(bootstrapContext?: GrowthBootstrapContext): Promise<SyncUserDataResult> {
  return callSyncCloudFunction('pull', undefined, bootstrapContext)
}

function pushUserDataToCloud(data: CloudUserDataPayload): Promise<SyncUserDataResult> {
  // 已完成 pull 后以内存中的云端基线为准；revision=0 是合法的新文档基线，不能回退到旧设备元数据。
  return callSyncCloudFunction('push', data, undefined, cloudBaselineRevision)
}

function callSyncCloudFunction(
  action: 'pull' | 'push',
  data?: CloudUserDataPayload,
  bootstrapContext?: GrowthBootstrapContext,
  baseRevision?: number,
): Promise<SyncUserDataResult> {
  const payload: Record<string, unknown> = { action }

  if (data) {
    payload.data = data
  }

  if (bootstrapContext) {
    payload.bootstrap = bootstrapContext
  }

  if (action === 'push') {
    payload.baseRevision = typeof baseRevision === 'number' ? baseRevision : 0
  }

  console.info(`${SYNC_LOG_TAG} 调用云函数`, {
    env: CLOUD_ENV_ID,
    functionName: SYNC_FUNCTION_NAME,
    action,
  })

  return callCloudFunction<SyncUserDataResult>(SYNC_FUNCTION_NAME, payload)
    .then((result) => {
      console.info(`${SYNC_LOG_TAG} 云函数返回`, {
        action,
        success: Boolean(result && result.success),
        code: result && result.code ? result.code : '',
      })
      return result
    })
    .catch((error) => {
      const failure = buildSyncFailureDetail(error)
      console.warn(`${SYNC_LOG_TAG} 云函数调用失败`, {
        env: CLOUD_ENV_ID,
        functionName: SYNC_FUNCTION_NAME,
        action,
        code: failure.code,
        message: failure.message,
        debugHint: failure.debugHint,
      }, error)
      throw createSyncError(failure.code, failure.message, failure.debugHint)
    })
}

async function pushSnapshotAndCommit(
  data: CloudUserDataPayload,
  conflictRetryCount = 0,
): Promise<SyncUserDataResult> {
  const capturedDirtyAt = loadLocalSyncMeta().dirtyAt
  const rawResult = await pushUserDataToCloud(data)

  if (rawResult && rawResult.code === 'SYNC_CONFLICT') {
    if (conflictRetryCount >= MAX_CONFLICT_RETRY_COUNT) {
      throw createSyncError(
        'SYNC_CONFLICT',
        '其他设备持续更新了云端数据，本次未覆盖，请稍后重试',
        '重新进入小程序后会再次拉取并合并；如持续出现，请暂停在其他设备上的编辑。',
      )
    }

    return rebaseAfterSyncConflict(conflictRetryCount + 1)
  }

  const result = ensureCloudSuccess(rawResult)
  saveGrowthState(result.growthState)
  const latestMeta = loadLocalSyncMeta()
  const openid = result.openid || latestMeta.ownerOpenid
  cloudBaselineRevision = getCloudRevision(result)

  saveLocalSyncMeta({
    schemaVersion: 7,
    ownerOpenid: openid,
    migratedAt: latestMeta.migratedAt || Date.now(),
    lastSyncedAt: result.updatedAt || Date.now(),
    lastRevision: cloudBaselineRevision,
    dirtyAt: latestMeta.dirtyAt === capturedDirtyAt ? 0 : latestMeta.dirtyAt,
    lastFailedAt: 0,
    lastErrorMessage: '',
    lastErrorCode: '',
    lastDebugHint: '',
  })

  return result
}

/**
 * 乐观锁冲突后的自动回基线流程。
 * 重新拉取最新云端快照，再与冲突发生后仍保留在本机的全部改动合并；最多重试两次，避免活锁。
 */
async function rebaseAfterSyncConflict(conflictRetryCount: number): Promise<SyncUserDataResult> {
  const pullResult = ensureCloudSuccess(await pullUserDataFromCloud())
  saveGrowthState(pullResult.growthState)
  const meta = loadLocalSyncMeta()
  const openid = pullResult.openid || meta.ownerOpenid

  if (!openid || (meta.ownerOpenid && meta.ownerOpenid !== openid)) {
    throw createSyncError('SYNC_ACCOUNT_CHANGED', '同步期间微信账号发生变化，已停止上传以避免串号')
  }

  cloudBaselineReady = true
  cloudBaselineRevision = getCloudRevision(pullResult)
  const latestLocalData = loadLocalUserDataSnapshot()
  const mergedData = pullResult.data
    ? mergeUserDataSnapshots(pullResult.data, latestLocalData)
    : latestLocalData

  hydrateLocalUserData(mergedData, true)
  saveLocalSyncMeta({
    ...meta,
    schemaVersion: 7,
    ownerOpenid: openid,
    lastSyncedAt: getCloudUpdatedAt(pullResult),
    lastRevision: cloudBaselineRevision,
    dirtyAt: meta.dirtyAt || Date.now(),
    lastFailedAt: 0,
    lastErrorMessage: '',
    lastErrorCode: '',
    lastDebugHint: '',
  })

  return pushSnapshotAndCommit(mergedData, conflictRetryCount)
}

function hydrateLocalUserData(data: CloudUserDataPayload | null, replaceMissing: boolean): void {
  writeArrayStorage(RECORD_STORAGE_KEY, data && data.records, replaceMissing)
  writeObjectStorage(CATEGORY_HISTORY_STORAGE_KEY, data && data.categoryHistory, replaceMissing)
  writeObjectStorage(GIFT_BOOK_STORAGE_KEY, data && data.giftBook, replaceMissing)
  writeObjectStorage(GIFT_EXCHANGE_STORAGE_KEY, data && data.giftExchanges, replaceMissing)
  writeArrayStorage(MOOD_RECORD_STORAGE_KEY, data && data.moodRecords, replaceMissing)
  writeObjectStorage(FAMILY_STORAGE_KEY, data && data.familyState, replaceMissing)
  writeObjectStorage(COMPANION_STORAGE_KEY, data && data.companionState, replaceMissing)
  writeObjectStorage(ONBOARDING_MOCK_STORAGE_KEY, data && data.onboardingState, replaceMissing)
  writeNumberStorage(GROWTH_UNLOCK_PROMPT_STORAGE_KEY, data && data.growthUnlockPromptAt, replaceMissing)
  hydrateLegacyUserData(data ? data.legacyData : undefined, replaceMissing)
}

function schedulePendingSync(): void {
  clearScheduledSync()
  syncTimer = setTimeout(() => {
    flushUserDataCloudSync().catch(() => {
      // 失败已在 flushUserDataCloudSync 中记录；这里避免未捕获 Promise 打断页面交互。
    })
  }, SYNC_DEBOUNCE_MS)
}

function clearScheduledSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
}

function markLocalDataDirty(ownerOpenid?: string): void {
  const meta = loadLocalSyncMeta()
  saveLocalSyncMeta({
    ...meta,
    schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : 0,
    ownerOpenid: ownerOpenid || meta.ownerOpenid,
    dirtyAt: Date.now(),
  })
}

/**
 * 合并同一 openid 在云端和当前设备上的业务快照。
 *
 * 调用时机：首次迁移时两端都有数据，或当前设备离线修改期间云端又被其他设备更新。
 * 注意事项：记录使用 id + updatedAt 合并；礼簿/往来账本按条目合并，并应用双方删除凭证，
 * 避免并发新增丢失或把用户已经删除的礼金记录重新恢复出来。
 */
export function mergeUserDataSnapshots(
  cloudData: CloudUserDataPayload,
  localData: CloudUserDataPayload,
): CloudUserDataPayload {
  return {
    schemaVersion: 7,
    records: mergeEntityArrays(cloudData.records, localData.records),
    categoryHistory: mergeCategoryHistory(cloudData.categoryHistory, localData.categoryHistory),
    giftBook: mergeGiftBook(cloudData.giftBook, localData.giftBook),
    giftExchanges: mergeGiftExchangeBook(cloudData.giftExchanges, localData.giftExchanges),
    moodRecords: mergeEntityArrays(cloudData.moodRecords, localData.moodRecords),
    familyState: pickNewerObject(cloudData.familyState, localData.familyState),
    companionState: pickNewerObject(cloudData.companionState, localData.companionState),
    onboardingState: pickNewerObject(cloudData.onboardingState, localData.onboardingState),
    growthUnlockPromptAt: Math.max(
      typeof cloudData.growthUnlockPromptAt === 'number' ? cloudData.growthUnlockPromptAt : 0,
      typeof localData.growthUnlockPromptAt === 'number' ? localData.growthUnlockPromptAt : 0,
    ),
    legacyData: mergeLegacyUserData(cloudData.legacyData, localData.legacyData),
  }
}

function mergeEntityArrays(cloudValue: unknown, localValue: unknown): unknown[] {
  const resultById: Record<string, Record<string, unknown>> = {}
  const order: string[] = []

  const append = (value: unknown) => {
    if (!Array.isArray(value)) return
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return
      const entity = item as Record<string, unknown>
      const id = typeof entity.id === 'string' && entity.id ? entity.id : `missing-id-${index}`
      const previous = resultById[id]
      if (!previous) order.push(id)
      if (!previous || getEntityTimestamp(entity) >= getEntityTimestamp(previous)) {
        resultById[id] = entity
      }
    })
  }

  append(cloudValue)
  append(localValue)
  return order.map((id) => resultById[id]).filter(Boolean)
}

function getEntityTimestamp(entity: Record<string, unknown>): number {
  const candidates = [
    entity.updatedAt,
    entity.deletedAt,
    entity.completedAt,
    entity.syncedAt,
    entity.initializedAt,
    entity.startedAt,
    entity.createdAt,
  ]
  for (let index = 0; index < candidates.length; index += 1) {
    if (typeof candidates[index] === 'number') return candidates[index] as number
  }
  return 0
}

function pickNewerObject(cloudValue: unknown, localValue: unknown): unknown | null {
  const cloudObject = isObjectStorageValue(cloudValue) ? cloudValue as Record<string, unknown> : null
  const localObject = isObjectStorageValue(localValue) ? localValue as Record<string, unknown> : null
  if (!cloudObject) return localObject
  if (!localObject) return cloudObject
  return getEntityTimestamp(localObject) >= getEntityTimestamp(cloudObject) ? localObject : cloudObject
}

/** 礼金条目按 id + updatedAt 合并，并应用双方删除凭证，避免并发新增丢失或已删除条目复活。 */
function mergeGiftBook(cloudValue: unknown, localValue: unknown): Record<string, unknown> | null {
  return mergeNestedBook(cloudValue, localValue, 'gifts', 'deletedGiftIds')
}

/** 往来条目同样按记录粒度合并；迁移凭证取并集，防止礼簿镜像重复生成。 */
function mergeGiftExchangeBook(cloudValue: unknown, localValue: unknown): Record<string, unknown> | null {
  const merged = mergeNestedBook(cloudValue, localValue, 'records', 'deletedRecordIds')
  if (!merged) return null
  const cloudObject = isObjectStorageValue(cloudValue) ? cloudValue as Record<string, unknown> : {}
  const localObject = isObjectStorageValue(localValue) ? localValue as Record<string, unknown> : {}
  merged.migratedGiftIds = mergeStringArrays(cloudObject.migratedGiftIds, localObject.migratedGiftIds, 1000)
  return merged
}

function mergeNestedBook(
  cloudValue: unknown,
  localValue: unknown,
  entryKey: 'gifts' | 'records',
  deletedKey: 'deletedGiftIds' | 'deletedRecordIds',
): Record<string, unknown> | null {
  const cloudObject = isObjectStorageValue(cloudValue) ? cloudValue as Record<string, unknown> : null
  const localObject = isObjectStorageValue(localValue) ? localValue as Record<string, unknown> : null
  if (!cloudObject && !localObject) return null

  const deletedIds = mergeStringArrays(
    cloudObject && cloudObject[deletedKey],
    localObject && localObject[deletedKey],
    2000,
  )
  const deletedSet = new Set(deletedIds)
  const resultById: Record<string, Record<string, unknown>> = {}
  const order: string[] = []

  const appendContacts = (value: unknown) => {
    if (!Array.isArray(value)) return
    value.forEach((item, index) => {
      if (!isObjectStorageValue(item)) return
      const contact = item as Record<string, unknown>
      const id = typeof contact.id === 'string' && contact.id ? contact.id : `missing-contact-${index}`
      const previous = resultById[id]
      if (!previous) order.push(id)
      const preferred = !previous || getEntityTimestamp(contact) >= getEntityTimestamp(previous)
        ? contact
        : previous
      const entries = mergeEntityArrays(previous && previous[entryKey], contact[entryKey])
        .filter((entry) => {
          if (!isObjectStorageValue(entry)) return false
          const id = (entry as Record<string, unknown>).id
          return typeof id !== 'string' || !deletedSet.has(id)
        })
      resultById[id] = {
        ...preferred,
        [entryKey]: entries,
        updatedAt: Math.max(getEntityTimestamp(previous || {}), getEntityTimestamp(contact)),
      }
    })
  }

  appendContacts(cloudObject && cloudObject.contacts)
  appendContacts(localObject && localObject.contacts)
  const preferredBook = pickNewerObject(cloudObject, localObject) as Record<string, unknown> | null

  return {
    ...(preferredBook || {}),
    contacts: order.map((id) => resultById[id]).filter(Boolean),
    [deletedKey]: deletedIds,
    updatedAt: Math.max(getEntityTimestamp(cloudObject || {}), getEntityTimestamp(localObject || {})),
  }
}

function mergeStringArrays(first: unknown, second: unknown, maxCount: number): string[] {
  const values = (Array.isArray(first) ? first : [])
    .concat(Array.isArray(second) ? second : [])
    .filter((item): item is string => typeof item === 'string' && Boolean(item))
  return Array.from(new Set(values)).slice(-maxCount)
}

function mergeCategoryHistory(cloudValue: unknown, localValue: unknown): Record<string, string[]> | null {
  const cloudObject = isObjectStorageValue(cloudValue) ? cloudValue as Record<string, unknown> : null
  const localObject = isObjectStorageValue(localValue) ? localValue as Record<string, unknown> : null
  if (!cloudObject && !localObject) return null

  return ['todo', 'anniversary', 'expiry', 'note'].reduce<Record<string, string[]>>((result, key) => {
    const cloudList = cloudObject && Array.isArray(cloudObject[key]) ? cloudObject[key] as unknown[] : []
    const localList = localObject && Array.isArray(localObject[key]) ? localObject[key] as unknown[] : []
    result[key] = Array.from(new Set(cloudList.concat(localList)
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim().slice(0, 20)))).slice(0, 20)
    return result
  }, {})
}

/**
 * 合并已经下线但仍可能留在老用户设备中的业务数据。
 * 任务数组按最新整包选择，避免把已删除任务因“并集”再次恢复；其余状态按更新时间选择。
 */
function mergeLegacyUserData(
  cloudValue: LegacyUserDataPayload | undefined,
  localValue: LegacyUserDataPayload | undefined,
): LegacyUserDataPayload {
  const cloudData = cloudValue || {}
  const localData = localValue || {}

  return {
    todayTasks: pickNewerArraySnapshot(cloudData.todayTasks, localData.todayTasks),
    scoreState: pickNewerObject(cloudData.scoreState, localData.scoreState),
    petState: pickNewerObject(cloudData.petState, localData.petState),
    exerciseRewardState: pickNewerObject(cloudData.exerciseRewardState, localData.exerciseRewardState),
    weRunState: pickNewerObject(cloudData.weRunState, localData.weRunState),
  }
}

function pickNewerArraySnapshot(cloudValue: unknown, localValue: unknown): unknown[] {
  const cloudList = Array.isArray(cloudValue) ? cloudValue : []
  const localList = Array.isArray(localValue) ? localValue : []
  if (!cloudList.length) return localList
  if (!localList.length) return cloudList

  return getArraySnapshotTimestamp(localList) >= getArraySnapshotTimestamp(cloudList)
    ? localList
    : cloudList
}

function getArraySnapshotTimestamp(value: unknown[]): number {
  return value.reduce<number>((latest, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return latest
    return Math.max(latest, getEntityTimestamp(item as Record<string, unknown>))
  }, 0)
}

function isObjectStorageValue(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasMeaningfulLocalData(data: CloudUserDataPayload): boolean {
  return (
    (Array.isArray(data.records) && data.records.length > 0) ||
    hasMeaningfulObject(data.categoryHistory) ||
    hasMeaningfulObject(data.giftBook) ||
    hasMeaningfulObject(data.giftExchanges) ||
    (Array.isArray(data.moodRecords) && data.moodRecords.length > 0) ||
    hasMeaningfulObject(data.familyState) ||
    hasMeaningfulObject(data.companionState) ||
    hasMeaningfulObject(data.onboardingState) ||
    Boolean(data.growthUnlockPromptAt) ||
    hasMeaningfulLegacyData(data.legacyData)
  )
}

function hasMeaningfulLegacyData(value: LegacyUserDataPayload | undefined): boolean {
  if (!value) return false
  return (
    (Array.isArray(value.todayTasks) && value.todayTasks.length > 0) ||
    hasMeaningfulObject(value.scoreState) ||
    hasMeaningfulObject(value.petState) ||
    hasMeaningfulObject(value.exerciseRewardState) ||
    hasMeaningfulObject(value.weRunState)
  )
}

function hasMeaningfulObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0)
}

function readArrayStorage(key: string): unknown[] {
  try {
    const value = wx.getStorageSync(key)
    return Array.isArray(value) ? value : []
  } catch (error) {
    console.warn(`读取 ${key} 失败`, error)
    return []
  }
}

function readObjectStorage(key: string): unknown | null {
  try {
    const value = wx.getStorageSync(key)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch (error) {
    console.warn(`读取 ${key} 失败`, error)
    return null
  }
}

function readNumberStorage(key: string): number {
  try {
    const value = wx.getStorageSync(key)
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  } catch (error) {
    console.warn(`读取 ${key} 失败`, error)
    return 0
  }
}

/**
 * 微信运动的 encryptedData、iv、cloudID 只用于当次换取步数，不能跨设备持久化。
 * 云端只保留用户看得到的同步结果和目标状态。
 */
function sanitizeLocalWeRunStateForCloud(value: unknown): Record<string, unknown> | null {
  if (!isObjectStorageValue(value)) return null
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const booleanKeys = ['authorized', 'synced', 'reachedTarget']
  const numberKeys = ['syncedAt', 'stepCount', 'targetSteps']
  const stringKeys = ['syncDate', 'stepText', 'statusText', 'lastError']

  booleanKeys.forEach((key) => {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  })
  numberKeys.forEach((key) => {
    if (typeof source[key] === 'number' && Number.isFinite(source[key] as number)) {
      result[key] = source[key]
    }
  })
  stringKeys.forEach((key) => {
    if (typeof source[key] === 'string') result[key] = (source[key] as string).slice(0, 200)
  })

  return Object.keys(result).length ? result : null
}

function writeArrayStorage(key: string, value: unknown, replaceMissing: boolean): void {
  if (Array.isArray(value)) {
    wx.setStorageSync(key, value)
    return
  }

  if (replaceMissing) {
    wx.removeStorageSync(key)
  }
}

function writeObjectStorage(key: string, value: unknown, replaceMissing: boolean): void {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    wx.setStorageSync(key, value)
    return
  }

  if (replaceMissing) {
    wx.removeStorageSync(key)
  }
}

function writeNumberStorage(key: string, value: unknown, replaceMissing: boolean): void {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    wx.setStorageSync(key, value)
    return
  }

  if (replaceMissing) {
    wx.removeStorageSync(key)
  }
}

function hydrateLegacyUserData(data: LegacyUserDataPayload | undefined, replaceMissing: boolean): void {
  writeArrayStorage(LEGACY_TODO_STORAGE_KEY, data && data.todayTasks, replaceMissing)
  writeObjectStorage(LEGACY_SCORE_STORAGE_KEY, data && data.scoreState, replaceMissing)
  writeObjectStorage(LEGACY_PET_STORAGE_KEY, data && data.petState, replaceMissing)
  writeObjectStorage(LEGACY_EXERCISE_STORAGE_KEY, data && data.exerciseRewardState, replaceMissing)

  if (data && isObjectStorageValue(data.weRunState)) {
    // 兼容旧服务读取结构，但不伪造或恢复任何一次性加密凭证。
    wx.setStorageSync(LEGACY_WERUN_STORAGE_KEY, {
      encryptedData: '',
      iv: '',
      cloudID: '',
      ...(data.weRunState as Record<string, unknown>),
    })
  } else if (replaceMissing) {
    wx.removeStorageSync(LEGACY_WERUN_STORAGE_KEY)
  }
}

function loadLocalSyncMeta(): LocalSyncMeta {
  const rawMeta = wx.getStorageSync(SYNC_META_STORAGE_KEY) as unknown

  if (!rawMeta || typeof rawMeta !== 'object') {
    return createEmptySyncMeta()
  }

  const meta = rawMeta as Partial<LocalSyncMeta>
  return {
    schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : 0,
    ownerOpenid: typeof meta.ownerOpenid === 'string' ? meta.ownerOpenid : '',
    migratedAt: typeof meta.migratedAt === 'number' ? meta.migratedAt : 0,
    lastSyncedAt: typeof meta.lastSyncedAt === 'number' ? meta.lastSyncedAt : 0,
    lastRevision: typeof meta.lastRevision === 'number' ? Math.max(0, Math.floor(meta.lastRevision)) : 0,
    dirtyAt: typeof meta.dirtyAt === 'number' ? meta.dirtyAt : 0,
    lastFailedAt: typeof meta.lastFailedAt === 'number' ? meta.lastFailedAt : 0,
    lastErrorMessage: typeof meta.lastErrorMessage === 'string' ? meta.lastErrorMessage : '',
    lastErrorCode: typeof meta.lastErrorCode === 'string' ? meta.lastErrorCode : '',
    lastDebugHint: typeof meta.lastDebugHint === 'string' ? meta.lastDebugHint : '',
    consecutiveFailures: typeof meta.consecutiveFailures === 'number' ? Math.max(0, Math.floor(meta.consecutiveFailures)) : 0,
  }
}

function saveLocalSyncMeta(meta: LocalSyncMeta): void {
  wx.setStorageSync(SYNC_META_STORAGE_KEY, meta)
  notifyCurrentPagesCloudSyncStatusChanged()
}

function createEmptySyncMeta(): LocalSyncMeta {
  return {
    schemaVersion: 7,
    ownerOpenid: '',
    migratedAt: 0,
    lastSyncedAt: 0,
    lastRevision: 0,
    dirtyAt: 0,
    lastFailedAt: 0,
    lastErrorMessage: '',
    lastErrorCode: '',
    lastDebugHint: '',
    consecutiveFailures: 0,
  }
}

function getCloudUpdatedAt(result: SyncUserDataResult): number {
  if (typeof result.updatedAt === 'number') {
    return result.updatedAt
  }

  if (result.data && typeof result.data.updatedAt === 'number') {
    return result.data.updatedAt
  }

  return 0
}

function getCloudRevision(result: SyncUserDataResult): number {
  return typeof result.revision === 'number' && Number.isFinite(result.revision)
    ? Math.max(0, Math.floor(result.revision))
    : 0
}

/** 区分“新版协议返回合法 revision=0”和“旧版协议根本没有 revision 字段”。 */
function hasCloudRevision(result: SyncUserDataResult): boolean {
  return typeof result.revision === 'number' && Number.isInteger(result.revision) && result.revision >= 0
}

function ensureCloudSuccess(result: SyncUserDataResult): SyncUserDataResult {
  if (result && result.success) {
    return result
  }

  throw createSyncError(
    result && result.code ? result.code : 'SYNC_FAILED',
    result && result.message ? result.message : '业务数据云同步失败',
    result && result.debug ? result.debug : '',
  )
}

function createSyncError(code: string, message: string, debugHint = ''): Error {
  const normalizedCode = normalizeSyncErrorCode(code, message)
  const error = new Error(message) as Error & { code?: string; debug?: string }
  error.code = normalizedCode
  error.debug = debugHint || getDefaultDebugHint(normalizedCode, message)
  return error
}

function saveSyncFailure(error: unknown): void {
  const meta = loadLocalSyncMeta()
  const failure = buildSyncFailureDetail(error)
  const consecutiveFailures = (meta.consecutiveFailures || 0) + 1

  saveLocalSyncMeta({
    ...meta,
    lastFailedAt: Date.now(),
    lastErrorMessage: failure.message,
    lastErrorCode: failure.code,
    lastDebugHint: failure.debugHint,
    consecutiveFailures,
  })

  console.warn(`${SYNC_LOG_TAG} 已记录云同步失败状态`, {
    code: failure.code,
    message: failure.message,
    debugHint: failure.debugHint,
    consecutiveFailures,
  })

  if (consecutiveFailures === 3) {
    console.error(`${SYNC_LOG_TAG} 连续同步失败达到预警阈值`, {
      code: failure.code,
      consecutiveFailures,
      debugHint: failure.debugHint,
    })
  }
}

/**
 * 计算待上传快照的 UTF-8 体积，供“我的”页和本地日志提前发现单文档膨胀。
 */
function getSnapshotBytes(snapshot: CloudUserDataPayload): number {
  try {
    return encodeURIComponent(JSON.stringify(snapshot)).replace(/%[0-9A-F]{2}|./g, 'x').length
  } catch (error) {
    console.warn(`${SYNC_LOG_TAG} 无法计算本地快照体积`, error)
    return 0
  }
}

function buildSyncFailureDetail(error: unknown): SyncFailureDetail {
  const rawMessage = getRawSyncErrorMessage(error)
  const rawCode = getRawSyncErrorCode(error)
  const code = normalizeSyncErrorCode(rawCode, rawMessage)

  return {
    code,
    message: getFriendlySyncErrorMessage(code, rawMessage),
    debugHint: getRawSyncDebugHint(error) || getDefaultDebugHint(code, rawMessage),
  }
}

function getRawSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  if (error && typeof error === 'object') {
    const rawError = error as { message?: unknown; errMsg?: unknown; code?: unknown }

    if (typeof rawError.message === 'string' && rawError.message.trim()) {
      return rawError.message.trim()
    }

    if (typeof rawError.errMsg === 'string' && rawError.errMsg.trim()) {
      return rawError.errMsg.trim()
    }

    if (typeof rawError.code === 'string' && rawError.code.trim()) {
      return `云同步失败：${rawError.code.trim()}`
    }
  }

  return ''
}

function getRawSyncErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const rawError = error as { code?: unknown; errCode?: unknown }

    if (typeof rawError.code === 'string' && rawError.code.trim()) {
      return rawError.code.trim()
    }

    if (typeof rawError.errCode === 'number') {
      return String(rawError.errCode)
    }
  }

  return ''
}

function getRawSyncDebugHint(error: unknown): string {
  if (error && typeof error === 'object') {
    const rawError = error as { debug?: unknown }

    if (typeof rawError.debug === 'string' && rawError.debug.trim()) {
      return rawError.debug.trim()
    }
  }

  return ''
}

function normalizeSyncErrorCode(rawCode: string, rawMessage: string): string {
  const code = rawCode.trim()
  const searchText = `${code} ${rawMessage}`.toLowerCase()

  if (code === 'NO_OPENID' || searchText.includes('openid')) {
    return 'NO_OPENID'
  }

  if (
    code === '-504002' ||
    code === '-501000' ||
    searchText.includes('function not found') ||
    searchText.includes('function_not_found') ||
    searchText.includes('functionnotfound') ||
    searchText.includes('functionname parameter could not be found') ||
    (searchText.includes(SYNC_FUNCTION_NAME.toLowerCase()) && (searchText.includes('not found') || searchText.includes('not exist')))
  ) {
    return 'CLOUD_FUNCTION_NOT_DEPLOYED'
  }

  if (code === 'SYNC_CONFLICT' || searchText.includes('sync_conflict')) {
    return 'SYNC_CONFLICT'
  }

  if (code === 'CLIENT_UPGRADE_REQUIRED') {
    return 'CLIENT_UPGRADE_REQUIRED'
  }

  if (code === 'SYNC_PROTOCOL_NOT_READY') {
    return 'SYNC_PROTOCOL_NOT_READY'
  }

  if (code === 'COLLECTION_PERMISSION_DENIED' || searchText.includes('permission denied') || searchText.includes('权限')) {
    return 'COLLECTION_PERMISSION_DENIED'
  }

  if (
    code === 'COLLECTION_NOT_READY' ||
    (searchText.includes('collection') && (searchText.includes('not found') || searchText.includes('not exist') || searchText.includes('不存在')))
  ) {
    return 'COLLECTION_NOT_READY'
  }

  if (searchText.includes('wx.cloud') || searchText.includes('cloud.callfunction')) {
    return 'CLOUD_CALL_FAILED'
  }

  return code || 'SYNC_FAILED'
}

function shouldPauseAutoRetry(code: string): boolean {
  return (
    code === 'CLOUD_FUNCTION_NOT_DEPLOYED' ||
    code === 'COLLECTION_PERMISSION_DENIED' ||
    code === 'COLLECTION_NOT_READY' ||
    code === 'CLOUD_UNAVAILABLE' ||
    code === 'SYNC_CONFLICT' ||
    code === 'CLIENT_UPGRADE_REQUIRED' ||
    code === 'SYNC_PROTOCOL_NOT_READY'
  )
}

function getFriendlySyncErrorMessage(code: string, rawMessage: string): string {
  if (code === 'BASELINE_NOT_READY') {
    return rawMessage || '尚未读取云端原数据，已暂停上传以防止覆盖'
  }

  if (code === 'NO_OPENID') {
    return rawMessage || '未拿到 openid，云端无法确认当前用户身份'
  }

  if (code === 'CLOUD_FUNCTION_NOT_DEPLOYED') {
    return `云函数 ${SYNC_FUNCTION_NAME} 未部署或当前环境不可用`
  }

  if (code === 'COLLECTION_PERMISSION_DENIED') {
    return `云端集合 ${SYNC_COLLECTION_NAME} 权限不允许当前云函数读写`
  }

  if (code === 'COLLECTION_NOT_READY') {
    return `云端集合 ${SYNC_COLLECTION_NAME} 未创建或不可访问`
  }

  if (code === 'CLOUD_UNAVAILABLE') {
    return '当前环境不支持 wx.cloud，云同步不可用'
  }

  if (code === 'SYNC_CONFLICT') {
    return rawMessage || '其他设备持续更新了云端数据，本次未覆盖'
  }

  if (code === 'CLIENT_UPGRADE_REQUIRED') {
    return rawMessage || '当前版本需要更新后才能继续安全同步'
  }

  if (code === 'SYNC_PROTOCOL_NOT_READY') {
    return rawMessage || '云端同步协议尚未升级，已暂停上传'
  }

  if (code === 'PULL_FAILED') {
    return rawMessage || '读取云端业务数据失败'
  }

  if (code === 'PUSH_FAILED') {
    return rawMessage || '写入云端业务数据失败'
  }

  return rawMessage || '云同步失败，请检查网络、云函数部署或稍后重试'
}

function getDefaultDebugHint(code: string, rawMessage: string): string {
  if (code === 'BASELINE_NOT_READY') {
    return `先确认网络和 ${SYNC_FUNCTION_NAME} 可用，再在“我的”页重新检查；成功拉取当前 openid 数据后才会恢复上传。`
  }

  if (code === 'NO_OPENID') {
    return `确认 app.ts 已先执行微信登录，且 ${SYNC_FUNCTION_NAME} 由小程序端调用；在云函数日志中检查 cloud.getWXContext().OPENID。`
  }

  if (code === 'CLOUD_FUNCTION_NOT_DEPLOYED') {
    return `在微信开发者工具「云开发」中部署 ${SYNC_FUNCTION_NAME}，确认环境 ${CLOUD_ENV_ID} 与 project.config.json 一致；Console 搜索 ${SYNC_LOG_TAG}。`
  }

  if (code === 'COLLECTION_PERMISSION_DENIED') {
    return `确认集合 ${SYNC_COLLECTION_NAME} 已创建，安全规则允许云函数读写；在云函数日志中搜索 ${SYNC_LOG_TAG} 查看数据库错误。`
  }

  if (code === 'COLLECTION_NOT_READY') {
    return `在云开发数据库创建集合 ${SYNC_COLLECTION_NAME}，并确认云函数运行环境为 ${CLOUD_ENV_ID}；修正后回到“我的”页点重试。`
  }

  if (code === 'CLOUD_UNAVAILABLE') {
    return '确认微信开发者工具基础库版本为 2.21.0+，并已开通云开发；真机调试需使用支持云开发的小程序环境。'
  }

  if (code === 'SYNC_CONFLICT') {
    return '重新进入小程序后会再次拉取并合并；如持续出现，请暂停在其他设备上的编辑。'
  }

  if (code === 'CLIENT_UPGRADE_REQUIRED') {
    return '更新到最新版本后重新进入小程序；旧版本不会再盲目覆盖新版云端数据。'
  }

  if (code === 'SYNC_PROTOCOL_NOT_READY') {
    return `先部署第7版 ${SYNC_FUNCTION_NAME}，确认 pull 返回 revision 后再发布客户端。`
  }

  if (code === 'PULL_FAILED' || code === 'PUSH_FAILED') {
    return `检查 ${SYNC_COLLECTION_NAME} 集合、云函数环境和权限配置；微信开发者工具 Console 搜索 ${SYNC_LOG_TAG}，云函数日志搜索 ${SYNC_FUNCTION_NAME}。`
  }

  if (rawMessage) {
    return `微信开发者工具 Console 搜索 ${SYNC_LOG_TAG}，再到云函数日志搜索 ${SYNC_FUNCTION_NAME} 对照原始错误。`
  }

  return `检查网络、云函数 ${SYNC_FUNCTION_NAME} 部署状态和集合 ${SYNC_COLLECTION_NAME}；修复后在“我的”页手动重试。`
}

function notifyCurrentPagesUserDataReady(): void {
  setTimeout(() => {
    getCurrentPages().forEach((page) => {
      const target = page as unknown as { onCloudUserDataReady?: () => void }
      if (typeof target.onCloudUserDataReady === 'function') {
        target.onCloudUserDataReady()
      }
    })
  }, 0)
}

function notifyCurrentPagesCloudSyncStatusChanged(): void {
  setTimeout(() => {
    getCurrentPages().forEach((page) => {
      const target = page as unknown as { onCloudSyncStatusChanged?: () => void }
      if (typeof target.onCloudSyncStatusChanged === 'function') {
        target.onCloudSyncStatusChanged()
      }
    })
  }, 0)
}
