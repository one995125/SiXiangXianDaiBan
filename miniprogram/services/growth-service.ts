import {
  GIFT_BOOK_STORAGE_KEY,
  GIFT_EXCHANGE_STORAGE_KEY,
  MOOD_RECORD_STORAGE_KEY,
  RECORD_STORAGE_KEY,
} from '../constants/remember'
import { callCloudFunction } from './cloud-service'

export type GrowthMilestoneId =
  | 'first_plan_created'
  | 'first_item_completed'
  | 'first_memory_added'

export interface GrowthState {
  version: 1
  cohort: 'legacy' | 'new'
  firstSeenAt: number
  checkinDates: string[]
  milestoneIds: GrowthMilestoneId[]
  giftUnlockedAt: number
  unlockReason: 'legacy' | 'growth' | ''
  acquisitionSource: 'direct' | 'growth_share'
}

export interface GrowthBootstrapContext {
  hasLegacyEvidence: boolean
  acquisitionSource: 'direct' | 'growth_share'
}

export interface GrowthView {
  state: GrowthState
  progress: number
  progressPercent: number
  checkinCount: number
  milestoneCount: number
  isGiftUnlocked: boolean
  isTodayChecked: boolean
  progressPoints: Array<{ index: number; completed: boolean }>
  milestones: Array<{ id: GrowthMilestoneId; title: string; desc: string; completed: boolean; target: string }>
}

interface GrowthCloudResult {
  success: boolean
  code?: string
  message?: string
  debug?: string
  growthState?: GrowthState
}

export const GROWTH_STORAGE_KEY = 'sixiang_growth_state_v1'
export const GROWTH_UNLOCK_PROMPT_KEY = 'sixiang_growth_unlock_prompt_v1'
const SYNC_FUNCTION_NAME = 'sixiangSyncUserData'
const MILESTONE_IDS: GrowthMilestoneId[] = [
  'first_plan_created',
  'first_item_completed',
  'first_memory_added',
]

/**
 * 在本次启动日志写入、示例数据生成之前捕获迁移证据。
 * 仅上传“是否存在旧痕迹”，不上传日志内容或业务明细。
 */
export function captureGrowthBootstrapContext(query?: Record<string, unknown>): GrowthBootstrapContext {
  return {
    hasLegacyEvidence: hasHistoricalLaunchLog() || hasLocalBusinessData(),
    acquisitionSource: String(query?.from || '') === 'growth_share' ? 'growth_share' : 'direct',
  }
}

/** 云同步成功后写入服务端返回的最终成长状态，并通知当前页面刷新。 */
export function saveGrowthState(state: GrowthState | null | undefined): void {
  if (!state) {
    return
  }

  const normalized = normalizeGrowthState(state)
  const previous = wx.getStorageSync(GROWTH_STORAGE_KEY) as GrowthState | undefined
  wx.setStorageSync(GROWTH_STORAGE_KEY, normalized)

  if (JSON.stringify(previous || null) !== JSON.stringify(normalized)) {
    notifyGrowthStateChanged()
  }
}

/**
 * 云端暂不可用时的安全回退：旧用户证据优先放行，全新安装默认锁定。
 * 网络恢复后的 pull 会以 openid 对应的云端状态覆盖本缓存。
 */
export function ensureOfflineGrowthFallback(context: GrowthBootstrapContext): GrowthState {
  const cached = loadGrowthState()
  if (cached) {
    return cached
  }

  const now = Date.now()
  const fallback: GrowthState = context.hasLegacyEvidence
    ? {
        version: 1,
        cohort: 'legacy',
        firstSeenAt: now,
        checkinDates: [],
        milestoneIds: [],
        giftUnlockedAt: now,
        unlockReason: 'legacy',
        acquisitionSource: context.acquisitionSource,
      }
    : {
        version: 1,
        cohort: 'new',
        firstSeenAt: now,
        checkinDates: [],
        milestoneIds: [],
        giftUnlockedAt: 0,
        unlockReason: '',
        acquisitionSource: context.acquisitionSource,
      }

  saveGrowthState(fallback)
  return fallback
}

export function loadGrowthState(): GrowthState | null {
  const raw = wx.getStorageSync(GROWTH_STORAGE_KEY) as unknown
  return raw && typeof raw === 'object' ? normalizeGrowthState(raw as GrowthState) : null
}

export function loadGrowthView(baseDate = new Date()): GrowthView {
  const state = loadGrowthState() || createLockedGrowthState()
  const progress = Math.min(7, state.checkinDates.length + state.milestoneIds.length)
  const today = formatLocalDate(baseDate)

  return {
    state,
    progress,
    progressPercent: Math.round((progress / 7) * 100),
    checkinCount: state.checkinDates.length,
    milestoneCount: state.milestoneIds.length,
    isGiftUnlocked: Boolean(state.giftUnlockedAt || state.cohort === 'legacy'),
    isTodayChecked: state.checkinDates.includes(today),
    progressPoints: Array.from({ length: 7 }, (_, index) => ({ index: index + 1, completed: index < progress })),
    milestones: [
      { id: 'first_plan_created', title: '创建第一个周期计划', desc: '设置每天、每周、每月或每年计划', completed: state.milestoneIds.includes('first_plan_created'), target: 'plan' },
      { id: 'first_item_completed', title: '完成第一件事项', desc: '完成待办或一次周期打卡', completed: state.milestoneIds.includes('first_item_completed'), target: 'today' },
      { id: 'first_memory_added', title: '留下第一份记忆', desc: '新增纪念日或心情记录', completed: state.milestoneIds.includes('first_memory_added'), target: 'memory' },
    ],
  }
}

export function isGiftFeatureUnlocked(): boolean {
  return loadGrowthView().isGiftUnlocked
}

/**
 * 请求服务端按北京时间签到。客户端不传日期，避免修改设备时间伪造签到日。
 */
export async function checkInGrowthToday(): Promise<GrowthState> {
  const result = await callCloudFunction<GrowthCloudResult>(SYNC_FUNCTION_NAME, { action: 'growthCheckin' })
  if (!result || !result.success || !result.growthState) {
    throw new Error(result?.message || '成长签到失败，请稍后重试')
  }

  saveGrowthState(result.growthState)
  return result.growthState
}

export function hasShownGrowthUnlockPrompt(): boolean {
  return Boolean(wx.getStorageSync(GROWTH_UNLOCK_PROMPT_KEY))
}

export function markGrowthUnlockPromptShown(): void {
  wx.setStorageSync(GROWTH_UNLOCK_PROMPT_KEY, Date.now())
}

function normalizeGrowthState(raw: GrowthState): GrowthState {
  const checkinDates = Array.isArray(raw.checkinDates)
    ? raw.checkinDates.filter((date, index, list) => /^\d{4}-\d{2}-\d{2}$/.test(date) && list.indexOf(date) === index).sort()
    : []
  const milestoneIds = Array.isArray(raw.milestoneIds)
    ? raw.milestoneIds.filter((id, index, list): id is GrowthMilestoneId => MILESTONE_IDS.includes(id) && list.indexOf(id) === index)
    : []
  const cohort = raw.cohort === 'legacy' ? 'legacy' : 'new'
  const giftUnlockedAt = cohort === 'legacy'
    ? (Number(raw.giftUnlockedAt) || Number(raw.firstSeenAt) || Date.now())
    : Math.max(0, Number(raw.giftUnlockedAt) || 0)

  return {
    version: 1,
    cohort,
    firstSeenAt: Number(raw.firstSeenAt) || Date.now(),
    checkinDates,
    milestoneIds,
    giftUnlockedAt,
    unlockReason: cohort === 'legacy' ? 'legacy' : giftUnlockedAt ? 'growth' : '',
    acquisitionSource: raw.acquisitionSource === 'growth_share' ? 'growth_share' : 'direct',
  }
}

function createLockedGrowthState(): GrowthState {
  return {
    version: 1,
    cohort: 'new',
    firstSeenAt: Date.now(),
    checkinDates: [],
    milestoneIds: [],
    giftUnlockedAt: 0,
    unlockReason: '',
    acquisitionSource: 'direct',
  }
}

function hasHistoricalLaunchLog(): boolean {
  const logs = wx.getStorageSync('logs')
  return Array.isArray(logs) && logs.length > 0
}

function hasLocalBusinessData(): boolean {
  const recordLikeKeys = [RECORD_STORAGE_KEY, MOOD_RECORD_STORAGE_KEY]
  const objectLikeKeys = [GIFT_BOOK_STORAGE_KEY, GIFT_EXCHANGE_STORAGE_KEY]

  return recordLikeKeys.some((key) => {
    const value = wx.getStorageSync(key)
    return Array.isArray(value) && value.length > 0
  }) || objectLikeKeys.some((key) => hasMeaningfulObject(wx.getStorageSync(key)))
}

function hasMeaningfulObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0)
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function notifyGrowthStateChanged(): void {
  try {
    getCurrentPages().forEach((page) => {
      if (typeof (page as any).onGrowthStateChanged === 'function') {
        ;(page as any).onGrowthStateChanged()
      }
    })
  } catch (error) {
    console.warn('[sixiangGrowth] 通知页面刷新失败', error)
  }
}
