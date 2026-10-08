import { callCloudFunction } from './cloud-service'
import { flushUserDataCloudSync } from './cloud-sync-service'

export type WechatReminderJobStatus =
  | 'none'
  | 'pending'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed'
  | 'expired'

export type ReminderRegistrationMode = 'current' | 'next'

export interface WechatReminderConfig {
  enabled: boolean
  templateId: string
  message: string
}

export interface WechatReminderStatus {
  status: WechatReminderJobStatus
  statusText: string
  sendAt: number
  sendAtText: string
  hasActiveAuthorization: boolean
  canActivate: boolean
  errorCode: string
  /** 服务端归一化后的失败分类，页面无需解析微信原始错误文案。 */
  errorCategory: string
  /** 面向排查人员的简短处理建议，不包含用户隐私数据。 */
  errorHint: string
}

export interface ReminderOperationResult {
  success: boolean
  pending?: boolean
  code?: string
  message?: string
  debug?: string
  status?: WechatReminderStatus
}

interface ReminderCloudResult extends ReminderOperationResult {
  config?: WechatReminderConfig
}

interface PendingRegistration {
  recordId: string
  mode: ReminderRegistrationMode
  acceptedAt: number
}

const REMINDER_FUNCTION_NAME = 'sixiangReminder'
const REMINDER_QUEUE_STORAGE_KEY = 'sixiang_reminder_registration_queue_v1'
const REMINDER_CONFIG_STORAGE_KEY = 'sixiang_reminder_config_v1'
const REMINDER_LOG_TAG = '[sixiangReminder]'
const EMPTY_CONFIG: WechatReminderConfig = {
  enabled: false,
  templateId: '',
  message: '微信提醒暂未配置',
}

let cachedConfig: WechatReminderConfig | null = null
let retryPromise: Promise<void> | null = null

/**
 * 获取提醒模板配置。
 *
 * 调用时机：记录表单、详情页和带周期打卡入口的页面显示时。
 * 注意：模板 ID 不是密钥，但仍由云函数统一下发，避免客户端与云端配置漂移。
 */
export async function loadWechatReminderConfig(force = false): Promise<WechatReminderConfig> {
  if (!force && cachedConfig) {
    return cachedConfig
  }

  if (!force) {
    const stored = normalizeReminderConfig(wx.getStorageSync(REMINDER_CONFIG_STORAGE_KEY))
    if (stored.enabled && stored.templateId) {
      cachedConfig = stored
      return stored
    }
  }

  try {
    const result = await callReminderFunction('getConfig')
    const config = normalizeReminderConfig(result.config)
    cachedConfig = config
    wx.setStorageSync(REMINDER_CONFIG_STORAGE_KEY, config)
    return config
  } catch (error) {
    console.warn(`${REMINDER_LOG_TAG} 读取模板配置失败`, error)
    return cachedConfig || EMPTY_CONFIG
  }
}

/**
 * 同步读取已缓存的模板配置。
 *
 * 调用时机：用户点击“开启提醒”时，确保 wx.requestSubscribeMessage 直接发生在点击事件中。
 * 注意：页面应在 onLoad/onShow 提前调用 loadWechatReminderConfig。
 */
export function getCachedWechatReminderConfig(): WechatReminderConfig {
  return cachedConfig || normalizeReminderConfig(wx.getStorageSync(REMINDER_CONFIG_STORAGE_KEY))
}

/**
 * 申请一次性订阅消息授权。
 *
 * 参数：templateId 为公众平台审核通过的一次性订阅模板 ID。
 * 返回：accepted/rejected/unavailable/cancelled，页面不得把拒绝视为记录保存失败。
 */
export function requestWechatReminderAuthorization(
  templateId: string,
): Promise<'accepted' | 'rejected' | 'unavailable' | 'cancelled'> {
  if (!templateId || typeof wx.requestSubscribeMessage !== 'function') {
    return Promise.resolve('unavailable')
  }

  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => {
        const decision = (result as Record<string, unknown>)[templateId]
        resolve(decision === 'accept' ? 'accepted' : decision === 'reject' || decision === 'ban' ? 'rejected' : 'cancelled')
      },
      fail: (error) => {
        console.warn(`${REMINDER_LOG_TAG} 用户未完成订阅授权`, error)
        resolve('cancelled')
      },
    })
  })
}

/**
 * 查询一条记录当前最新的微信提醒状态。
 */
export async function loadWechatReminderStatus(recordId: string): Promise<WechatReminderStatus> {
  if (!recordId) {
    return createEmptyStatus()
  }

  try {
    const result = await callReminderFunction('getStatus', { recordId })
    return normalizeReminderStatus(result.status)
  } catch (error) {
    console.warn(`${REMINDER_LOG_TAG} 读取提醒状态失败`, error)
    return {
      ...createEmptyStatus(),
      statusText: '提醒状态读取失败，请稍后重试',
      errorCode: 'STATUS_UNAVAILABLE',
    }
  }
}

/**
 * 在用户已同意订阅后登记提醒。
 *
 * 先强制上传业务快照，让云函数可以按 openid 校验记录；失败时写入本地补登记队列。
 */
export async function confirmWechatReminder(
  recordId: string,
  mode: ReminderRegistrationMode = 'current',
): Promise<ReminderOperationResult> {
  try {
    await flushUserDataCloudSync()
    const result = await callReminderFunction('register', {
      recordId,
      mode,
      authorizationGranted: true,
    })
    ensureCloudSuccess(result)
    removePendingRegistration(recordId)
    return result
  } catch (error) {
    enqueuePendingRegistration(recordId, mode)
    console.warn(`${REMINDER_LOG_TAG} 提醒已授权但登记待重试`, error)
    return {
      success: false,
      pending: true,
      code: 'REGISTRATION_PENDING',
      message: '微信提醒待联网确认',
    }
  }
}

/**
 * 编辑已有待发送任务后重排时间；没有可复用授权时返回 AUTHORIZATION_REQUIRED。
 */
export async function rescheduleWechatReminder(recordId: string): Promise<ReminderOperationResult> {
  try {
    await flushUserDataCloudSync()
    const result = await callReminderFunction('reschedule', { recordId })
    ensureCloudSuccess(result)
    return result
  } catch (error) {
    return toOperationFailure(error, '提醒更新时间失败')
  }
}

/**
 * 取消一条记录的待发送提醒。取消失败不阻断本地完成或删除，发送端仍会做最终校验。
 */
export async function cancelWechatReminder(recordId: string): Promise<ReminderOperationResult> {
  removePendingRegistration(recordId)
  if (!recordId) {
    return { success: true }
  }

  try {
    const result = await callReminderFunction('cancel', { recordId })
    ensureCloudSuccess(result)
    return result
  } catch (error) {
    console.warn(`${REMINDER_LOG_TAG} 取消提醒失败，等待发送端最终校验`, error)
    return toOperationFailure(error, '取消提醒失败')
  }
}

/** 清空当前 openid 的全部提醒任务，并清空本地补登记队列。 */
export async function cancelAllWechatReminders(): Promise<ReminderOperationResult> {
  wx.removeStorageSync(REMINDER_QUEUE_STORAGE_KEY)
  try {
    const result = await callReminderFunction('cancelAll')
    ensureCloudSuccess(result)
    return result
  } catch (error) {
    console.warn(`${REMINDER_LOG_TAG} 批量取消提醒失败`, error)
    return toOperationFailure(error, '批量取消提醒失败')
  }
}

/**
 * 启动或网络恢复后重试“已授权但尚未写入云端”的提醒。
 * 同一时刻只运行一个重试流程，避免多个页面 onShow 重复登记。
 */
export function retryPendingWechatReminderRegistrations(): Promise<void> {
  if (retryPromise) {
    return retryPromise
  }

  retryPromise = retryPendingRegistrationsInternal().finally(() => {
    retryPromise = null
  })
  return retryPromise
}

async function retryPendingRegistrationsInternal(): Promise<void> {
  const pending = loadPendingRegistrations()
  if (!pending.length) {
    return
  }

  try {
    await flushUserDataCloudSync()
  } catch (error) {
    console.warn(`${REMINDER_LOG_TAG} 补登记前云同步仍不可用`, error)
    return
  }

  for (const item of pending) {
    try {
      const result = await callReminderFunction('register', {
        recordId: item.recordId,
        mode: item.mode,
        authorizationGranted: true,
        authorizationGrantedAt: item.acceptedAt,
      })
      ensureCloudSuccess(result)
      removePendingRegistration(item.recordId)
    } catch (error) {
      console.warn(`${REMINDER_LOG_TAG} 补登记失败`, { recordId: item.recordId }, error)
    }
  }
}

function callReminderFunction(action: string, data: Record<string, unknown> = {}): Promise<ReminderCloudResult> {
  return callCloudFunction<ReminderCloudResult>(REMINDER_FUNCTION_NAME, { action, ...data })
}

function ensureCloudSuccess(result: ReminderCloudResult): void {
  if (result && result.success) {
    return
  }

  const error = new Error(result && result.message ? result.message : '微信提醒服务暂不可用') as Error & {
    code?: string
    debug?: string
  }
  error.code = result && result.code ? result.code : 'REMINDER_FAILED'
  error.debug = result && result.debug ? result.debug : ''
  throw error
}

function normalizeReminderConfig(value: unknown): WechatReminderConfig {
  if (!value || typeof value !== 'object') {
    return EMPTY_CONFIG
  }

  const config = value as Partial<WechatReminderConfig>
  const templateId = typeof config.templateId === 'string' ? config.templateId.trim() : ''
  return {
    enabled: Boolean(config.enabled && templateId),
    templateId,
    message: typeof config.message === 'string' && config.message ? config.message : templateId ? '微信提醒可用' : '微信提醒暂未配置',
  }
}

function normalizeReminderStatus(value: unknown): WechatReminderStatus {
  if (!value || typeof value !== 'object') {
    return createEmptyStatus()
  }

  const status = value as Partial<WechatReminderStatus>
  const allowed: WechatReminderJobStatus[] = ['none', 'pending', 'sending', 'sent', 'cancelled', 'failed', 'expired']
  const normalizedStatus = allowed.includes(status.status as WechatReminderJobStatus)
    ? status.status as WechatReminderJobStatus
    : 'none'
  return {
    status: normalizedStatus,
    statusText: typeof status.statusText === 'string' && status.statusText ? status.statusText : '微信提醒未开启',
    sendAt: typeof status.sendAt === 'number' ? status.sendAt : 0,
    sendAtText: typeof status.sendAtText === 'string' ? status.sendAtText : '',
    hasActiveAuthorization: Boolean(status.hasActiveAuthorization),
    canActivate: status.canActivate !== false,
    errorCode: typeof status.errorCode === 'string' ? status.errorCode : '',
    errorCategory: typeof status.errorCategory === 'string' ? status.errorCategory : '',
    errorHint: typeof status.errorHint === 'string' ? status.errorHint : '',
  }
}

function createEmptyStatus(): WechatReminderStatus {
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

function loadPendingRegistrations(): PendingRegistration[] {
  const stored = wx.getStorageSync(REMINDER_QUEUE_STORAGE_KEY) as unknown
  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter((item): item is PendingRegistration => Boolean(
    item &&
    typeof item.recordId === 'string' &&
    item.recordId &&
    (item.mode === 'current' || item.mode === 'next') &&
    typeof item.acceptedAt === 'number',
  ))
}

function enqueuePendingRegistration(recordId: string, mode: ReminderRegistrationMode): void {
  if (!recordId) {
    return
  }

  const next: PendingRegistration = {
    recordId,
    mode,
    acceptedAt: Date.now(),
  }
  const queue = loadPendingRegistrations().filter((item) => item.recordId !== recordId)
  wx.setStorageSync(REMINDER_QUEUE_STORAGE_KEY, queue.concat(next).slice(-100))
}

function removePendingRegistration(recordId: string): void {
  const next = loadPendingRegistrations().filter((item) => item.recordId !== recordId)
  if (next.length) {
    wx.setStorageSync(REMINDER_QUEUE_STORAGE_KEY, next)
    return
  }
  wx.removeStorageSync(REMINDER_QUEUE_STORAGE_KEY)
}

function toOperationFailure(error: unknown, fallback: string): ReminderOperationResult {
  const typed = error as { code?: string; message?: string; debug?: string }
  return {
    success: false,
    code: typed && typed.code ? typed.code : 'REMINDER_FAILED',
    message: typed && typed.message ? typed.message : fallback,
    debug: typed && typed.debug ? typed.debug : '',
  }
}
