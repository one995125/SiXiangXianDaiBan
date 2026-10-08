import { COMPANION_STORAGE_KEY, LEGACY_PET_STORAGE_KEY } from '../constants/remember'
import { scheduleUserDataCloudSync } from './cloud-sync-service'
import { loadGrowthView } from './growth-service'

export interface CompanionRewardEntry {
  key: string
  amount: number
  rewardedAt: number
}

export interface CompanionState {
  version: 2
  petId: 'xiaonuan'
  name: '小暖'
  adoptedAt: number
  exp: number
  checkinDates: string[]
  rewardHistory: CompanionRewardEntry[]
  introShownAt: number
  updatedAt: number
}

export interface CompanionCheckinDay {
  date: string
  label: string
  day: string
  checked: boolean
  isToday: boolean
}

export interface CompanionView {
  isAvailable: boolean
  state: CompanionState | null
  level: 1 | 2 | 3
  stageName: string
  stageDesc: string
  imageUrl: string
  homeImageUrl: string
  exp: number
  currentStageExp: number
  nextStageExp: number
  progressPercent: number
  remainingExp: number
  companionDays: number
  todayDate: string
  isTodayChecked: boolean
  weekDays: CompanionCheckinDay[]
  streakDays: number
}

export interface CompanionRewardResult {
  rewarded: boolean
  amount: number
  leveledUp: boolean
  previousLevel: 1 | 2 | 3
  view: CompanionView
  feedback: string
}

interface RewardableRecord {
  id: string
  type: string
  noteKind?: string
  recurrenceType?: string
}

const MAX_REWARD_HISTORY = 2000
const PET_IMAGES = {
  1: '/assets/images/companion/xiaonuan-cloud-lv1.png',
  2: '/assets/images/companion/xiaonuan-cloud-lv2.png',
  3: '/assets/images/companion/xiaonuan-cloud-lv3.png',
} as const
const HOME_IMAGES = {
  1: '/pages/pet/assets/home-lv1.jpg',
  2: '/pages/pet/assets/home-lv2.jpg',
  3: '/pages/pet/assets/home-lv3.jpg',
} as const

/** 创建未领养视图，供页面 data 初始化，避免模板访问空字段。 */
export function createEmptyCompanionView(): CompanionView {
  return buildCompanionView(null)
}

/**
 * 读取并归一化小暖状态。
 * 调用时机：计划页、小家页面以及云同步快照读取。
 * 注意：这里只读取状态，不会绕过七日成长门槛自动领养。
 */
export function loadCompanionState(): CompanionState | null {
  const raw = safeReadStorage(COMPANION_STORAGE_KEY)
  return normalizeCompanionState(raw)
}

/**
 * 在礼簿已解锁后领养小暖，并兼容迁移旧宠物经验值。
 * 老用户的成长状态为永久解锁，因此首次进入计划页会直接完成领养。
 */
export function ensureCompanionAdopted(): CompanionState | null {
  if (!loadGrowthView().isGiftUnlocked) return null

  const existing = loadCompanionState()
  if (existing) return existing

  const now = Date.now()
  const legacy = safeReadStorage(LEGACY_PET_STORAGE_KEY) as Record<string, unknown> | null
  const exp = legacy && typeof legacy.exp === 'number' && Number.isFinite(legacy.exp)
    ? Math.max(0, Math.floor(legacy.exp))
    : 0
  const state: CompanionState = {
    version: 2,
    petId: 'xiaonuan',
    name: '小暖',
    adoptedAt: now,
    exp,
    checkinDates: [],
    rewardHistory: [],
    introShownAt: 0,
    updatedAt: now,
  }
  saveCompanionState(state)
  return state
}

export function loadCompanionView(): CompanionView {
  return buildCompanionView(loadCompanionState())
}

/**
 * 为首次完成的事项发生项发放10点成长值。
 * 周期计划必须传入 YYYY-MM-DD 发生日；普通事项按记录ID永久幂等。
 */
export function rewardCompanionForRecord(record: RewardableRecord, occurrenceDate = ''): CompanionRewardResult {
  const state = ensureCompanionAdopted()
  if (!state || !isRewardableRecord(record)) return createNoRewardResult(state)

  const isRecurring = record.recurrenceType && record.recurrenceType !== 'none'
  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate) ? occurrenceDate : getBeijingDate()
  const rewardKey = isRecurring
    ? `record:${record.id}:day:${normalizedDate}`
    : `record:${record.id}`
  return applyReward(state, rewardKey, 10)
}

/** 每个北京时间自然日签到一次，发放5点成长值。 */
export function checkInCompanionToday(): CompanionRewardResult {
  const state = ensureCompanionAdopted()
  if (!state) return createNoRewardResult(null)

  const date = getBeijingDate()
  const result = applyReward(state, `daily:${date}`, 5)
  if (result.rewarded) {
    const nextState: CompanionState = {
      ...(result.view.state as CompanionState),
      checkinDates: Array.from(new Set([...state.checkinDates, date])).slice(-2000),
      updatedAt: Date.now(),
    }
    saveCompanionState(nextState)
    return { ...result, view: buildCompanionView(nextState) }
  }
  return result
}

/** 标记一次性介绍已展示，不影响经验获取。 */
export function markCompanionIntroShown(): CompanionState | null {
  const state = loadCompanionState()
  if (!state || state.introShownAt) return state
  const nextState = { ...state, introShownAt: Date.now(), updatedAt: Date.now() }
  saveCompanionState(nextState)
  return nextState
}

/** 仅在用户明确选择“同时清空小暖成长”时调用。 */
export function clearCompanionState(): void {
  wx.removeStorageSync(COMPANION_STORAGE_KEY)
  scheduleUserDataCloudSync()
}

function applyReward(state: CompanionState, key: string, amount: number): CompanionRewardResult {
  if (state.rewardHistory.some((entry) => entry.key === key)) return createNoRewardResult(state)

  const previousLevel = getLevel(state.exp)
  const now = Date.now()
  const nextState: CompanionState = {
    ...state,
    exp: state.exp + amount,
    rewardHistory: [...state.rewardHistory, { key, amount, rewardedAt: now }].slice(-MAX_REWARD_HISTORY),
    updatedAt: now,
  }
  saveCompanionState(nextState)
  const view = buildCompanionView(nextState)
  return {
    rewarded: true,
    amount,
    previousLevel,
    leveledUp: view.level > previousLevel,
    view,
    feedback: view.level === 3 ? '小暖把今天的认真收藏好啦' : view.level === 2 ? '小暖又精神了一点' : '小暖吃到一颗计划能量',
  }
}

function createNoRewardResult(state: CompanionState | null): CompanionRewardResult {
  const view = buildCompanionView(state)
  return { rewarded: false, amount: 0, leveledUp: false, previousLevel: view.level, view, feedback: '' }
}

function buildCompanionView(state: CompanionState | null): CompanionView {
  const exp = state ? state.exp : 0
  const level = getLevel(exp)
  const stageStart = level === 1 ? 0 : level === 2 ? 60 : 160
  const stageEnd = level === 1 ? 60 : level === 2 ? 160 : 160
  const stageRange = Math.max(1, stageEnd - stageStart)
  const progressPercent = level === 3 ? 100 : Math.min(100, Math.round(((exp - stageStart) / stageRange) * 100))
  const todayDate = getBeijingDate()
  const checkinDates = state ? state.checkinDates : []
  return {
    isAvailable: Boolean(state),
    state,
    level,
    stageName: level === 1 ? '小小陪伴' : level === 2 ? '活力成长' : '温暖相伴',
    stageDesc: level === 1 ? '刚来到你身边，喜欢收集小小完成。' : level === 2 ? '房间亮起来了，小暖也更有精神。' : '每一次坚持，都变成了温暖的陪伴。',
    imageUrl: PET_IMAGES[level],
    homeImageUrl: HOME_IMAGES[level],
    exp,
    currentStageExp: Math.max(0, exp - stageStart),
    nextStageExp: stageEnd,
    progressPercent,
    remainingExp: level === 3 ? 0 : Math.max(0, stageEnd - exp),
    companionDays: state ? Math.max(1, Math.floor((Date.now() - state.adoptedAt) / 86400000) + 1) : 0,
    todayDate,
    isTodayChecked: checkinDates.includes(todayDate),
    weekDays: buildCompanionCheckinWeek(checkinDates, todayDate),
    streakDays: computeCompanionCheckinStreak(checkinDates, todayDate),
  }
}

/**
 * 按北京时间生成本周一至周日的签到视图。
 * 仅根据小暖签到日期计算，不再混用周期计划的完成状态。
 */
function buildCompanionCheckinWeek(checkinDates: string[], todayDate: string): CompanionCheckinDay[] {
  const checkedDates = new Set(checkinDates)
  const weekday = getDateWeekday(todayDate)
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday
  const labels = ['一', '二', '三', '四', '五', '六', '日']

  return labels.map((label, index) => {
    const date = shiftDateKey(todayDate, mondayOffset + index)
    return {
      date,
      label,
      day: String(Number(date.slice(8, 10))),
      checked: checkedDates.has(date),
      isToday: date === todayDate,
    }
  })
}

/**
 * 计算连续签到天数。
 * 今天尚未签到但昨天已签到时保留当前连续天数，避免用户当天签到前被提前清零。
 */
function computeCompanionCheckinStreak(checkinDates: string[], todayDate: string): number {
  const checkedDates = new Set(checkinDates)
  let cursor = checkedDates.has(todayDate) ? todayDate : shiftDateKey(todayDate, -1)
  let streak = 0

  while (streak < MAX_REWARD_HISTORY && checkedDates.has(cursor)) {
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}

function getDateWeekday(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function shiftDateKey(dateKey: string, offsetDays: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

function normalizeCompanionState(raw: unknown): CompanionState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Partial<CompanionState>
  if (value.version !== 2 || value.petId !== 'xiaonuan') return null
  const rewardHistory = Array.isArray(value.rewardHistory)
    ? value.rewardHistory.filter(isRewardEntry).slice(-MAX_REWARD_HISTORY)
    : []
  return {
    version: 2,
    petId: 'xiaonuan',
    name: '小暖',
    adoptedAt: toTimestamp(value.adoptedAt, Date.now()),
    exp: Math.max(0, Math.floor(typeof value.exp === 'number' ? value.exp : 0)),
    checkinDates: Array.isArray(value.checkinDates)
      ? Array.from(new Set(value.checkinDates.filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)))).slice(-2000)
      : [],
    rewardHistory,
    introShownAt: toTimestamp(value.introShownAt, 0),
    updatedAt: toTimestamp(value.updatedAt, Date.now()),
  }
}

function saveCompanionState(state: CompanionState): void {
  wx.setStorageSync(COMPANION_STORAGE_KEY, state)
  scheduleUserDataCloudSync()
}

function isRewardableRecord(record: RewardableRecord): boolean {
  return record.type === 'todo' || (record.type === 'note' && record.noteKind === 'temporary')
}

function isRewardEntry(value: unknown): value is CompanionRewardEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as CompanionRewardEntry
  return typeof entry.key === 'string' && entry.key.length > 0 && entry.key.length <= 180 && typeof entry.amount === 'number' && typeof entry.rewardedAt === 'number'
}

function getLevel(exp: number): 1 | 2 | 3 {
  return exp >= 160 ? 3 : exp >= 60 ? 2 : 1
}

function getBeijingDate(timestamp = Date.now()): string {
  const beijing = new Date(timestamp + 8 * 60 * 60 * 1000)
  const year = beijing.getUTCFullYear()
  const month = String(beijing.getUTCMonth() + 1).padStart(2, '0')
  const day = String(beijing.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function safeReadStorage(key: string): unknown {
  try {
    return wx.getStorageSync(key)
  } catch (error) {
    console.warn(`[companion] 读取 ${key} 失败`, error)
    return null
  }
}
