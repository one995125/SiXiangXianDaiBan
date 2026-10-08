import {
  CATEGORY_HISTORY_STORAGE_KEY,
  FAMILY_STORAGE_KEY,
  GIFT_BOOK_STORAGE_KEY,
  GIFT_EXCHANGE_STORAGE_KEY,
  MOOD_RECORD_STORAGE_KEY,
  RECORD_STORAGE_KEY,
} from '../constants/remember'
import { scheduleUserDataCloudSync } from './cloud-sync-service'
import { rewardCompanionForRecord } from './companion-service'

export type RecordType = 'todo' | 'anniversary' | 'expiry' | 'note'
export type AnniversaryMode = 'elapsed' | 'countdown'
export type RecordVisibility = 'private' | 'family'
export type RecordStatus = 'pending' | 'done'
export type RepeatRule = 'none' | 'yearly'
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type NoteKind = 'long_term' | 'temporary'
export type RecordFilterType = RecordType | 'all' | 'recurring'
export type TodoQuadrantId = 'do-now' | 'schedule' | 'quick' | 'avoid'
export type RecordOrderAction = 'up' | 'down' | 'first' | 'last'
export type TodoQuadrantOrderAction = RecordOrderAction

export interface CheckinEntry {
  periodKey: string
  completedAt: number
  actualCount: number
  note: string
}

export interface CheckinEntryView extends CheckinEntry {
  label: string
  actualText: string
}

export interface RecordTypeMeta {
  type: RecordType
  label: string
  shortLabel: string
  category: string
  desc: string
  icon: string
  tone: string
}

export interface TodoQuadrantOption {
  id: TodoQuadrantId
  title: string
  action: string
  desc: string
  emptyText: string
  tone: string
}

export interface RememberRecord {
  id: string
  type: RecordType
  title: string
  category: string
  quadrant: TodoQuadrantId
  quadrantOrder: number
  typeOrder: number
  anniversaryMode: AnniversaryMode
  date: string
  time: string
  isAllDay: boolean
  remindAt: number
  remindBeforeMinutes: number
  repeatRule: RepeatRule
  recurrenceType: RecurrenceType
  weeklyDays: number[]
  targetCount: number
  targetUnit: string
  checkinHistory: Record<string, CheckinEntry>
  noteKind: NoteKind
  scheduleVersion: number
  status: RecordStatus
  note: string
  visibility: RecordVisibility
  familyId: string
  pinnedAt: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface RecordDraft {
  id?: string
  type: RecordType
  title: string
  category: string
  quadrant: TodoQuadrantId
  anniversaryMode: AnniversaryMode
  date: string
  time: string
  isAllDay: boolean
  remindBeforeMinutes: number
  repeatRule: RepeatRule
  recurrenceType: RecurrenceType
  weeklyDays: number[]
  targetCount: number
  targetUnit: string
  noteKind: NoteKind
  status: RecordStatus
  note: string
  visibility: RecordVisibility
  familyId: string
}

export interface RecordView extends RememberRecord {
  typeLabel: string
  typeIcon: string
  tone: string
  dateLabel: string
  shortDateLabel: string
  timeLabel: string
  timeBadgeText: string
  relativeText: string
  anniversaryDisplayText: string
  anniversarySubText: string
  anniversaryTone: string
  anniversaryModeLabel: string
  anniversaryMetricPrefix: string
  anniversaryMetricValue: string
  anniversaryMetricUnit: string
  anniversaryMetricSizeClass: string
  quadrantTitle: string
  quadrantAction: string
  quadrantDesc: string
  quadrantTone: string
  statusText: string
  taskStatusText: string
  deadlineText: string
  visibilityText: string
  remindText: string
  repeatText: string
  recurrenceText: string
  targetText: string
  checkinPeriodKey: string
  checkinStatusText: string
  progressActual: number
  progressTarget: number
  progressPercent: number
  progressText: string
  designIcon: string
  designIconAsset: string
  bubbleTone: string
  isRecurring: boolean
  isCheckinDue: boolean
  isCheckinDone: boolean
  recentCheckins: CheckinEntryView[]
  hasNote: boolean
  isDone: boolean
  canPin: boolean
  isPinned: boolean
  pinActionText: string
  doneActionText: string
}

export interface TodayQuadrantView extends TodoQuadrantOption {
  count: number
  remainingCount: number
  records: RecordView[]
}

export interface TodayDashboard {
  todayDate: string
  todayLabel: string
  dateTitle: string
  weekdayLabel: string
  overviewCards: Array<{ label: string; value: string; tone: string }>
  quadrants: TodayQuadrantView[]
  recentReminders: RecordView[]
  anniversaryCards: RecordView[]
  anniversaryMainCards: RecordView[]
  anniversaryStackCards: RecordView[]
  anniversaryTotalCount: number
  todayTaskItems: RecordView[]
  checkinItems: RecordView[]
  todayCheckinItems: RecordView[]
  todayReminders: RecordView[]
  laterReminders: RecordView[]
  todayCount: number
  recentCount: number
  todayTaskCount: number
  todayTaskDoneCount: number
  todayProgressPercent: number
  todayProgressText: string
  checkinCount: number
  checkinDoneCount: number
  checkinPendingCount: number
  checkinRemainingCount: number
  hasQuadrantRecords: boolean
  hasTodayTaskItems: boolean
  hasCheckinItems: boolean
  hasTodayReminders: boolean
  hasRecentReminders: boolean
}

export interface CheckinCenterSummaryCard {
  label: string
  value: string
  tone: string
}

export interface CheckinCenterView {
  todayDate: string
  todayLabel: string
  summaryCards: CheckinCenterSummaryCard[]
  dueItems: RecordView[]
  dailyItems: RecordView[]
  weeklyItems: RecordView[]
  monthlyItems: RecordView[]
  yearlyItems: RecordView[]
  dailyActions: RecordView[]
  allItems: RecordView[]
  weekDays: Array<{ label: string; day: string; checked: boolean; isToday: boolean }>
  streakDays: number
  doneCount: number
  pendingCount: number
  totalCount: number
  hasDueItems: boolean
  hasAllItems: boolean
}

export interface RememberStorageSummary {
  todayDate: string
  todayLabel: string
  allCount: number
  pendingCount: number
  completedCount: number
  todayCount: number
  recurringCount: number
  hasData: boolean
}

export interface CalendarDayView {
  date: string
  day: string
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  markerTones: string[]
}

export interface CalendarMonthView {
  monthDate: string
  monthLabel: string
  days: CalendarDayView[]
  selectedDate: string
  selectedDateTitle: string
  selectedWeekdayLabel: string
  selectedSummaryText: string
  selectedRecords: RecordView[]
  monthNodes: RecordView[]
}

export interface RecordQuery {
  type?: RecordFilterType
  keyword?: string
  includeDone?: boolean
}

export interface CategoryHistory {
  todo: string[]
  anniversary: string[]
  expiry: string[]
  note: string[]
}

export interface FamilyState {
  familyId: string
  displayName: string
  createdAt: number
  updatedAt: number
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^\d{2}:\d{2}$/
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const MAX_RECORD_COUNT = 2000
const MAX_CHECKIN_HISTORY_COUNT = 370
const MAX_FAMILY_NAME_LENGTH = 24
// 取自四象限的珊瑚、青绿、蓝、紫，并补充相近的年轻化柔和色；同一列表优先不重复。
const RECORD_PALETTE_TONES = ['coral', 'lagoon', 'blue', 'violet', 'amber', 'mint', 'rose', 'sky', 'peach']
// 家庭空间还没有完整成员、邀请和跨账号权限模型，正式完成前不在前端展示入口。
export const FAMILY_SPACE_FEATURE_ENABLED = false
export const DEFAULT_TODO_QUADRANT_ID: TodoQuadrantId = 'schedule'
export const TODO_QUADRANT_OPTIONS: TodoQuadrantOption[] = [
  {
    id: 'do-now',
    title: '重要且紧急',
    action: '立即处理',
    desc: '今天必须完成',
    emptyText: '暂无',
    tone: 'urgent',
  },
  {
    id: 'schedule',
    title: '重要不紧急',
    action: '安排时间',
    desc: '给重要的事留时间',
    emptyText: '暂无',
    tone: 'plan',
  },
  {
    id: 'quick',
    title: '紧急不重要',
    action: '快速处理',
    desc: '能快做就别拖',
    emptyText: '暂无',
    tone: 'quick',
  },
  {
    id: 'avoid',
    title: '不重要不紧急',
    action: '尽量不做',
    desc: '可以删除或延后',
    emptyText: '暂无',
    tone: 'later',
  },
]

export const RECORD_TYPE_METAS: RecordTypeMeta[] = [
  {
    type: 'todo',
    label: '待办',
    shortLabel: '待办',
    category: '生活待办',
    desc: '取快递、复诊、缴费等需要处理的小事',
    icon: '✓',
    tone: 'todo',
  },
  {
    type: 'anniversary',
    label: '纪念日',
    shortLabel: '纪念日',
    category: '重要纪念日',
    desc: '生日、纪念日等每年要记得的日子',
    icon: '♡',
    tone: 'anniversary',
  },
  {
    type: 'expiry',
    label: '到期',
    shortLabel: '到期',
    category: '用品到期',
    desc: '药品、证件、食品、滤芯等截止时间',
    icon: '!',
    tone: 'expiry',
  },
  {
    type: 'note',
    label: '便签',
    shortLabel: '便签',
    category: '临时便签',
    desc: '尺寸、地址、备注等需要找回的信息',
    icon: '+',
    tone: 'note',
  },
]

export const CATEGORY_PRESETS: Record<RecordType, string[]> = {
  todo: ['生活待办', '运动打卡', '健康习惯', '学习计划', '家务事项', '缴费办理', '医疗提醒'],
  anniversary: ['重要纪念日', '生日', '结婚纪念日', '节日提醒'],
  expiry: ['食品到期', '药品到期', '证件到期', '用品更换', '车辆年检'],
  note: ['临时便签', '知识便签', '地址电话', '装修尺寸', '快递信息', '购物清单'],
}

export const REMIND_OPTIONS = [
  { label: '不提醒', value: 0 },
  { label: '提前30分钟', value: 30 },
  { label: '提前1小时', value: 60 },
  { label: '提前1天', value: 1440 },
  { label: '提前3天', value: 4320 },
  { label: '提前7天', value: 10080 },
]

export const RECURRENCE_OPTIONS: Array<{ label: string; value: RecurrenceType }> = [
  { label: '不重复', value: 'none' },
  { label: '每天', value: 'daily' },
  { label: '每周', value: 'weekly' },
  { label: '每月', value: 'monthly' },
  { label: '每年', value: 'yearly' },
]

export const ANNIVERSARY_MODE_OPTIONS: Array<{ label: string; value: AnniversaryMode; desc: string }> = [
  { label: '纪念起点', value: 'elapsed', desc: '从这天开始，显示已经多少天' },
  { label: '年度提醒', value: 'countdown', desc: '每年这天提醒，显示还有多少天' },
]

export const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, value) => ({ label, value }))

/**
 * 创建表单初始值。
 *
 * 调用时机：新增记录页初始化、切换类型后需要补齐默认分类时。
 * 注意：本函数只返回内存对象，不写 storage，也不会触发云同步。
 */
export function createDefaultRecordDraft(type: RecordType = 'todo', baseDate = new Date()): RecordDraft {
  const meta = getRecordTypeMeta(type)
  const today = formatRecordDate(baseDate)

  return {
    type,
    title: '',
    category: meta.category,
    quadrant: DEFAULT_TODO_QUADRANT_ID,
    anniversaryMode: type === 'anniversary' ? inferAnniversaryMode('', meta.category) : 'elapsed',
    date: today,
    time: '',
    isAllDay: true,
    // 微信订阅消息必须由用户主动点击授权；新记录默认不提醒，避免保存时无意弹出授权框。
    remindBeforeMinutes: 0,
    repeatRule: type === 'anniversary' ? 'yearly' : 'none',
    recurrenceType: 'none',
    weeklyDays: [baseDate.getDay()],
    targetCount: 0,
    targetUnit: '',
    noteKind: 'temporary',
    status: 'pending',
    note: '',
    visibility: 'private',
    familyId: '',
  }
}

export function getRecordTypeMeta(type: RecordType): RecordTypeMeta {
  return RECORD_TYPE_METAS.find((item) => item.type === type) || RECORD_TYPE_METAS[0]
}

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && RECORD_TYPE_METAS.some((item) => item.type === value)
}

export function isAnniversaryMode(value: unknown): value is AnniversaryMode {
  return value === 'elapsed' || value === 'countdown'
}

export function inferAnniversaryMode(title = '', category = ''): AnniversaryMode {
  const text = `${title}${category}`
  return text.includes('生日') || text.includes('节日') ? 'countdown' : 'elapsed'
}

export function isRecordVisibility(value: unknown): value is RecordVisibility {
  return value === 'private' || value === 'family'
}

/**
 * 读取当前本地家庭空间状态。
 *
 * 调用时机：记录表单、我的页、云同步回填后需要判断是否允许选择“家庭可见”时。
 * 注意事项：这里只读取本地 storage，不做跨账号成员校验；跨 openid 的真实共享需要后续家庭页和后端权限模型承接。
 */
export function loadFamilyState(): FamilyState | null {
  return normalizeFamilyState(wx.getStorageSync(FAMILY_STORAGE_KEY))
}

/**
 * 创建一个最小本地家庭空间，供记录可见范围绑定 familyId。
 *
 * 参数 displayName：家庭空间展示名，仅用于本机 UI 展示，默认“我的家庭”。
 * 调用时机：“我的”页点击开启家庭空间时。
 * 注意事项：本函数会写入 FAMILY_STORAGE_KEY，并标记现有用户数据快照需要云同步；不会创建新的云函数或集合。
 */
export function createLocalFamilyState(displayName = '我的家庭'): FamilyState {
  const existing = loadFamilyState()

  if (existing) {
    return existing
  }

  const now = Date.now()
  const familyState: FamilyState = {
    familyId: createFamilyId(now),
    displayName: normalizeFamilyDisplayName(displayName),
    createdAt: now,
    updatedAt: now,
  }

  wx.setStorageSync(FAMILY_STORAGE_KEY, familyState)
  scheduleUserDataCloudSync()
  return familyState
}

export function isRecordStatus(value: unknown): value is RecordStatus {
  return value === 'pending' || value === 'done'
}

function canRecordTypePin(type: RecordType, noteKind: NoteKind = 'long_term'): boolean {
  return type === 'anniversary' || (type === 'note' && noteKind === 'long_term')
}

export function isRepeatRule(value: unknown): value is RepeatRule {
  return value === 'none' || value === 'yearly'
}

export function isRecurrenceType(value: unknown): value is RecurrenceType {
  return value === 'none' || value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly'
}

export function isNoteKind(value: unknown): value is NoteKind {
  return value === 'long_term' || value === 'temporary'
}

export function isTodoQuadrantId(value: unknown): value is TodoQuadrantId {
  return typeof value === 'string' && TODO_QUADRANT_OPTIONS.some((item) => item.id === value)
}

export function getTodoQuadrantOption(value: unknown): TodoQuadrantOption {
  return TODO_QUADRANT_OPTIONS.find((item) => item.id === value) || TODO_QUADRANT_OPTIONS[1]
}

export function getCategoryOptions(type: RecordType): string[] {
  const history = loadCategoryHistory()
  return uniqueStrings((history[type] || []).concat(CATEGORY_PRESETS[type] || []))
}

export function loadCategoryHistory(): CategoryHistory {
  const rawHistory = wx.getStorageSync(CATEGORY_HISTORY_STORAGE_KEY) as unknown
  const emptyHistory: CategoryHistory = {
    todo: [],
    anniversary: [],
    expiry: [],
    note: [],
  }

  if (!rawHistory || typeof rawHistory !== 'object') {
    return emptyHistory
  }

  const history = rawHistory as Partial<CategoryHistory>
  return {
    todo: normalizeCategoryList(history.todo),
    anniversary: normalizeCategoryList(history.anniversary),
    expiry: normalizeCategoryList(history.expiry),
    note: normalizeCategoryList(history.note),
  }
}

export function saveCategoryToHistory(type: RecordType, category: string): void {
  const normalizedCategory = category.trim().slice(0, 20)

  if (!normalizedCategory || CATEGORY_PRESETS[type].includes(normalizedCategory)) {
    return
  }

  const history = loadCategoryHistory()
  wx.setStorageSync(CATEGORY_HISTORY_STORAGE_KEY, {
    ...history,
    [type]: uniqueStrings([normalizedCategory].concat(history[type] || [])).slice(0, 20),
  })
}

/**
 * 读取当前用户的全部记录。
 *
 * 调用时机：页面 onShow、云同步回填后刷新页面。
 * 注意：默认过滤软删除记录；如需排查删除数据，可传入 includeDeleted=true。
 */
export function loadRememberRecords(includeDeleted = false): RememberRecord[] {
  const rawRecords = wx.getStorageSync(RECORD_STORAGE_KEY) as unknown
  const normalized = normalizeRememberRecords(rawRecords)
  const requiresSchemaUpgrade = Array.isArray(rawRecords) && rawRecords.some((rawRecord) => {
    if (!rawRecord || typeof rawRecord !== 'object') {
      return true
    }
    const record = rawRecord as Partial<RememberRecord>
    return !isNoteKind(record.noteKind) || record.scheduleVersion !== 2
  })

  // 旧便签类型和旧周期键只迁移一次，并立即落回本地，随后由统一同步队列推送 schema 4 快照。
  if (requiresSchemaUpgrade) {
    wx.setStorageSync(RECORD_STORAGE_KEY, normalized)
    scheduleUserDataCloudSync()
  }
  const visibleRecords = includeDeleted ? normalized : normalized.filter((record) => !record.deletedAt)

  return sortRecordsByDate(visibleRecords)
}

export function loadRememberRecordById(id: string, includeDeleted = false): RememberRecord | null {
  return loadRememberRecords(includeDeleted).find((record) => record.id === id) || null
}

export function saveRememberRecords(records: RememberRecord[]): void {
  wx.setStorageSync(RECORD_STORAGE_KEY, normalizeRememberRecords(records).slice(0, MAX_RECORD_COUNT))
  scheduleUserDataCloudSync()
}

/**
 * 新增或更新记录。
 *
 * 参数 draft：来自表单页的用户输入；函数内部会统一修剪标题、补齐提醒时间和更新时间。
 * 注意：周期待办不会生成多条记录，只在 checkinHistory 中保存每日/每周完成情况。
 */
export function upsertRememberRecord(draft: RecordDraft): RememberRecord {
  const allRecords = loadRememberRecords(true)
  const now = Date.now()
  const existing = draft.id ? allRecords.find((record) => record.id === draft.id) : undefined
  const record = buildRecordFromDraft(draft, existing, now)
  const nextRecords = existing
    ? allRecords.map((item) => (item.id === existing.id ? record : item))
    : allRecords.concat(record)

  saveCategoryToHistory(record.type, record.category)
  saveRememberRecords(nextRecords)
  return record
}

/**
 * 调整今日页同一象限内的待办顺序。
 *
 * 参数 id：长按事项的记录 ID；action：上移、下移、移到最前或最后。
 * 调用时机：今日页长按四象限事项并选择排序动作后。
 * 注意：只调整当前日期实际展示的待办（含未完成周期目标），不影响未来事项或其他象限。
 */
export function reorderRememberRecordInQuadrant(
  id: string,
  action: TodoQuadrantOrderAction,
  baseDate = new Date(),
): boolean {
  const allRecords = loadRememberRecords(true)
  const target = allRecords.find((record) => record.id === id && !record.deletedAt)

  if (!target || !getTodayQuadrantRecords(allRecords, baseDate).some((record) => record.id === id)) {
    return false
  }

  const quadrantRecords = sortTodayQuadrantRecords(
    getTodayQuadrantRecords(allRecords, baseDate).filter((record) => record.quadrant === target.quadrant),
  )
  const currentIndex = quadrantRecords.findIndex((record) => record.id === id)
  let nextIndex = currentIndex

  if (action === 'up') {
    nextIndex = Math.max(0, currentIndex - 1)
  } else if (action === 'down') {
    nextIndex = Math.min(quadrantRecords.length - 1, currentIndex + 1)
  } else if (action === 'first') {
    nextIndex = 0
  } else if (action === 'last') {
    nextIndex = quadrantRecords.length - 1
  }

  if (currentIndex < 0 || nextIndex === currentIndex) {
    return false
  }

  const reorderedRecords = quadrantRecords.slice()
  const movedRecords = reorderedRecords.splice(currentIndex, 1)
  reorderedRecords.splice(nextIndex, 0, movedRecords[0])

  const orderById = reorderedRecords.reduce<Record<string, number>>((result, record, index) => {
    result[record.id] = index + 1
    return result
  }, {})
  const now = Date.now()

  saveRememberRecords(allRecords.map((record) => {
    const quadrantOrder = orderById[record.id]
    if (!quadrantOrder || record.quadrantOrder === quadrantOrder) {
      return record
    }

    return {
      ...record,
      quadrantOrder,
      updatedAt: now,
    }
  }))
  return true
}

/**
 * 调整“记录”页同一记录类型内的展示顺序。
 *
 * 参数 id：长按记录 ID；action：排序动作。
 * 调用时机：“待办”或“纪念日”单类型列表长按调整后。
 * 注意：已完成记录不参与排序；结果写入原 records 数据并随现有云同步上传。
 */
export function reorderRememberRecordInType(id: string, action: RecordOrderAction): boolean {
  const allRecords = loadRememberRecords(true)
  const target = allRecords.find((record) => record.id === id && !record.deletedAt && record.status !== 'done')

  if (!target || (target.type !== 'todo' && target.type !== 'anniversary')) {
    return false
  }

  const typeRecords = sortRecordsByTypeOrder(
    allRecords.filter((record) => !record.deletedAt && record.status !== 'done' && record.type === target.type),
  )
  const currentIndex = typeRecords.findIndex((record) => record.id === id)
  let nextIndex = currentIndex

  if (action === 'up') {
    nextIndex = Math.max(0, currentIndex - 1)
  } else if (action === 'down') {
    nextIndex = Math.min(typeRecords.length - 1, currentIndex + 1)
  } else if (action === 'first') {
    nextIndex = 0
  } else if (action === 'last') {
    nextIndex = typeRecords.length - 1
  }

  if (currentIndex < 0 || nextIndex === currentIndex) {
    return false
  }

  const reorderedRecords = typeRecords.slice()
  const movedRecords = reorderedRecords.splice(currentIndex, 1)
  reorderedRecords.splice(nextIndex, 0, movedRecords[0])

  const orderById = reorderedRecords.reduce<Record<string, number>>((result, record, index) => {
    result[record.id] = index + 1
    return result
  }, {})
  const now = Date.now()

  saveRememberRecords(allRecords.map((record) => {
    const typeOrder = orderById[record.id]
    if (!typeOrder || record.typeOrder === typeOrder) {
      return record
    }

    return {
      ...record,
      typeOrder,
      updatedAt: now,
    }
  }))
  return true
}

export function markRememberRecordDone(id: string, done = true): RememberRecord | null {
  const allRecords = loadRememberRecords(true)
  const target = allRecords.find((record) => record.id === id && !record.deletedAt)

  if (!target) {
    return null
  }

  if (canRecordTypePin(target.type, target.noteKind)) {
    return null
  }

  if (target.recurrenceType !== 'none') {
    return done ? checkInRememberRecord(id) : null
  }

  const now = Date.now()
  const nextRecord: RememberRecord = {
    ...target,
    status: done ? 'done' : 'pending',
    updatedAt: now,
  }

  saveRememberRecords(allRecords.map((record) => (record.id === id ? nextRecord : record)))
  if (done && target.status !== 'done') {
    rewardCompanionForRecord(nextRecord)
  }
  return nextRecord
}

/**
 * 切换纪念日/便签的置顶状态。
 *
 * 调用时机：详情页底部主按钮点击后。
 * 注意：置顶只写 pinnedAt 时间戳；排序时 pinnedAt 越新越靠前，旧记录默认为 0。
 */
export function toggleRememberRecordPinned(id: string, pinned?: boolean): RememberRecord | null {
  const allRecords = loadRememberRecords(true)
  const target = allRecords.find((record) => record.id === id && !record.deletedAt)

  if (!target || !canRecordTypePin(target.type, target.noteKind)) {
    return null
  }

  const now = Date.now()
  const shouldPin = typeof pinned === 'boolean' ? pinned : !target.pinnedAt
  const nextRecord: RememberRecord = {
    ...target,
    pinnedAt: shouldPin ? now : 0,
    updatedAt: now,
  }

  saveRememberRecords(allRecords.map((record) => (record.id === id ? nextRecord : record)))
  return nextRecord
}

/**
 * 完成一次周期打卡。
 *
 * 调用时机：首页/计划页/详情页的打卡按钮点击后。
 * 注意：新版日/周/月/年计划都按具体发生日写 day:YYYY-MM-DD；同一天只完成一次，
 * 不会因周一打卡而提前结束整周计划。
 */
export function checkInRememberRecord(id: string, _actualCount?: number, note = '', baseDate = new Date()): RememberRecord | null {
  const allRecords = loadRememberRecords(true)
  const target = allRecords.find((record) => record.id === id && !record.deletedAt)

  if (!target || !isRecurringDueOnDate(target, baseDate)) {
    return null
  }

  const periodKey = getCheckinPeriodKey(target, baseDate)
  const nextRecord: RememberRecord = {
    ...target,
    checkinHistory: trimCheckinHistory({
      ...target.checkinHistory,
      [periodKey]: {
        periodKey,
        completedAt: Date.now(),
        actualCount: 1,
        note: note.trim().slice(0, 100),
      },
    }),
    updatedAt: Date.now(),
  }

  saveRememberRecords(allRecords.map((record) => (record.id === id ? nextRecord : record)))
  rewardCompanionForRecord(nextRecord, formatRecordDate(baseDate))
  return nextRecord
}

export function softDeleteRememberRecord(id: string): boolean {
  const allRecords = loadRememberRecords(true)
  const target = allRecords.find((record) => record.id === id && !record.deletedAt)

  if (!target) {
    return false
  }

  const now = Date.now()
  saveRememberRecords(
    allRecords.map((record) =>
      record.id === id
        ? {
            ...record,
            deletedAt: now,
            updatedAt: now,
          }
        : record,
    ),
  )
  return true
}

export function toRecordView(record: RememberRecord, todayDate = formatRecordDate(), occurrenceDate?: string): RecordView {
  const meta = getRecordTypeMeta(record.type)
  const isRecurring = record.recurrenceType !== 'none'
  const occurrenceDateText = occurrenceDate || (isRecurring ? todayDate : record.date)
  const occurrence = parseRecordDate(occurrenceDateText) || parseRecordDate(todayDate) || new Date()
  const checkinPeriodKey = isRecurring ? getCheckinPeriodKey(record, occurrence) : ''
  const isCheckinDue = isRecurring && isRecurringDueOnDate(record, occurrence)
  const occurrenceEntry = isRecurring && checkinPeriodKey ? record.checkinHistory[checkinPeriodKey] : undefined
  const periodProgress = isRecurring ? getRecurrencePeriodProgress(record, occurrence) : null
  const progressTarget = periodProgress ? periodProgress.target : 1
  const progressActual = periodProgress ? periodProgress.actual : record.status === 'done' ? 1 : 0
  const isCheckinDone = isRecurring ? Boolean(occurrenceEntry && occurrenceEntry.actualCount >= 1) : record.status === 'done'
  const progressPercent = progressTarget > 0 ? Math.round((progressActual / progressTarget) * 100) : 0
  const anniversaryMeta = getAnniversaryViewMeta(record, todayDate)
  const visualMeta = getRecordVisualMeta(record, meta.tone)
  const recordTone = isRecurring ? 'checkin' : record.type === 'anniversary' ? anniversaryMeta.tone : meta.tone
  const quadrantOption = getTodoQuadrantOption(record.quadrant)
  const isPinned = record.pinnedAt > 0

  return {
    ...record,
    typeLabel: isRecurring ? '周期' : meta.shortLabel,
    typeIcon: meta.icon,
    tone: recordTone,
    dateLabel: formatDateLabel(occurrenceDateText),
    shortDateLabel: formatShortDate(occurrenceDateText),
    timeLabel: record.isAllDay || !record.time ? '全天' : record.time,
    timeBadgeText: record.isAllDay || !record.time ? '' : record.time,
    relativeText: record.type === 'anniversary' ? anniversaryMeta.displayText : getRelativeText(occurrenceDateText, todayDate),
    anniversaryDisplayText: anniversaryMeta.displayText,
    anniversarySubText: anniversaryMeta.subText,
    anniversaryTone: anniversaryMeta.tone,
    anniversaryModeLabel: anniversaryMeta.modeLabel,
    anniversaryMetricPrefix: anniversaryMeta.metricPrefix,
    anniversaryMetricValue: anniversaryMeta.metricValue,
    anniversaryMetricUnit: anniversaryMeta.metricUnit,
    anniversaryMetricSizeClass: getAnniversaryMetricSizeClass(anniversaryMeta.metricValue),
    quadrantTitle: quadrantOption.title,
    quadrantAction: quadrantOption.action,
    quadrantDesc: quadrantOption.desc,
    quadrantTone: quadrantOption.tone,
    statusText: getRecordStatusText(record),
    taskStatusText: getRecordTaskStatusText(record),
    deadlineText: getTodoDeadlineText(record, todayDate),
    visibilityText: record.visibility === 'family' && record.familyId ? '家庭可见' : '仅自己',
    remindText: getRemindText(record.remindBeforeMinutes),
    repeatText: record.repeatRule === 'yearly' ? '每年重复' : '不重复',
    recurrenceText: getRecurrenceText(record),
    targetText: getTargetText(record),
    checkinPeriodKey,
    checkinStatusText: !isCheckinDue ? '未到打卡日' : isCheckinDone ? '已完成' : '待办',
    progressActual,
    progressTarget,
    progressPercent,
    progressText: isRecurring ? `${progressActual}/${progressTarget}${record.recurrenceType === 'weekly' ? ' 天' : ' 次'}` : record.status === 'done' ? '已完成' : '待办',
    designIcon: visualMeta.icon,
    designIconAsset: visualMeta.iconAsset,
    bubbleTone: record.type === 'anniversary' ? anniversaryMeta.tone : visualMeta.tone,
    isRecurring,
    isCheckinDue,
    isCheckinDone,
    recentCheckins: buildRecentCheckinViews(record),
    hasNote: Boolean(record.note),
    isDone: record.status === 'done',
    canPin: canRecordTypePin(record.type, record.noteKind),
    isPinned,
    pinActionText: isPinned ? '取消置顶' : '置顶',
    doneActionText: record.type === 'expiry'
      ? record.status === 'done' ? '已处理' : '标记已处理'
      : record.type === 'note' && record.noteKind === 'temporary'
        ? record.status === 'done' ? '已完成' : '完成便签'
      : record.status === 'done' ? '已完成' : '标记为完成',
  }
}

/**
 * 为同一组记录分配稳定且尽量不重复的柔和彩色调。
 *
 * 参数 records：已经完成业务排序的视图列表。
 * 注意：颜色只影响展示字段，不写回用户记录；同一列表前 9 条使用不同颜色，刷新时保持稳定。
 */
function applyVariedRecordTones(records: RecordView[]): RecordView[] {
  const usedTones = new Set<string>()
  let previousTone = ''

  return records.map((record) => {
    if (usedTones.size >= RECORD_PALETTE_TONES.length) {
      usedTones.clear()
      if (previousTone) {
        usedTones.add(previousTone)
      }
    }

    const startIndex = getStableRecordToneIndex(record)
    let selectedTone = RECORD_PALETTE_TONES[startIndex]

    for (let offset = 0; offset < RECORD_PALETTE_TONES.length; offset += 1) {
      const candidate = RECORD_PALETTE_TONES[(startIndex + offset) % RECORD_PALETTE_TONES.length]
      if (!usedTones.has(candidate)) {
        selectedTone = candidate
        break
      }
    }

    usedTones.add(selectedTone)
    previousTone = selectedTone

    return {
      ...record,
      anniversaryTone: selectedTone,
      bubbleTone: selectedTone,
    }
  })
}

/** 使用记录 ID 生成稳定色板起点，避免每次刷新随机换色。 */
function getStableRecordToneIndex(record: RecordView): number {
  const key = `${record.id}:${record.type}:${record.category}`
  let hash = 0

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }

  return hash % RECORD_PALETTE_TONES.length
}

function getRecordStatusText(record: RememberRecord): string {
  if (record.type === 'expiry') {
    return record.status === 'done' ? '已处理' : '待处理'
  }

  if (record.type === 'note') {
    return record.noteKind === 'temporary'
      ? record.status === 'done' ? '已完成' : '临时便签'
      : '长期便签'
  }

  return record.status === 'done' ? '已完成' : '待完成'
}

function getRecordTaskStatusText(record: RememberRecord): string {
  if (record.type === 'expiry') {
    return record.status === 'done' ? '已处理' : '待处理'
  }

  if (record.type === 'note') {
    return record.noteKind === 'temporary'
      ? record.status === 'done' ? '已完成' : '待完成'
      : '长期便签'
  }

  return record.status === 'done' ? '已完成' : '待办'
}

function getTodoDeadlineText(record: RememberRecord, todayDate: string): string {
  if (record.type !== 'todo' || record.recurrenceType !== 'none') {
    return ''
  }

  const date = parseRecordDate(record.date)
  const today = parseRecordDate(todayDate)

  if (!date || !today) {
    return ''
  }

  const dayDiff = Math.round((date.getTime() - today.getTime()) / ONE_DAY_MS)

  if (dayDiff < 0) {
    return `逾期${Math.abs(dayDiff)}天`
  }

  if (dayDiff === 0) {
    return '今天截止'
  }

  if (dayDiff === 1) {
    return '明天截止'
  }

  return `${dayDiff}天后截止`
}

function getAnniversaryMetricSizeClass(metricValue: string): string {
  // 首页纪念日卡片按数字长度自动降字号，避免三位及以上天数被省略。
  const metricLength = String(metricValue || '').length

  if (metricLength >= 6) {
    return 'is-micro'
  }

  if (metricLength >= 5) {
    return 'is-tiny'
  }

  if (metricLength >= 4) {
    return 'is-compact'
  }

  if (metricLength >= 3) {
    return 'is-fit-3'
  }

  return ''
}

export function loadTodayDashboard(baseDate = new Date()): TodayDashboard {
  const todayDate = formatRecordDate(baseDate)
  const allRecords = loadRememberRecords()
  const activeRecords = allRecords.filter((record) => record.status !== 'done')
  const normalRecords = activeRecords.filter((record) => record.recurrenceType === 'none')
  const checkinRecords = activeRecords.filter((record) => isRecurringDueOnDate(record, baseDate))
  const todayRecords = normalRecords.filter((record) => record.date === todayDate)
  // “本周内完成”的普通待办会把截止日期保存为本周日。
  // 因此不能只在截止日当天才展示，而应从本周开始持续进入首页，直到用户完成。
  const todayTaskRecords = normalRecords.filter((record) => isOrdinaryTodoActionableInWeek(record, baseDate))
  // 四象限同时接收普通待办和今天应处理但尚未完成的周期待办。
  // 周期待办仍保留在今日计划中，四象限只负责体现用户选择的优先级归属。
  const todayQuadrantRecords = getTodayQuadrantRecords(activeRecords, baseDate)
  const anniversaryRecords = sortAnniversaryRecords(normalRecords.filter((record) =>
    record.type === 'anniversary',
  ), todayDate)
  const anniversaryCards = applyVariedRecordTones(anniversaryRecords.map((record) => toRecordView(record, todayDate)))
  const expirySoonRecords = sortRecordsByDate(normalRecords.filter((record) =>
    record.type === 'expiry' && record.date >= todayDate,
  ))
  const expirySoonCount = expirySoonRecords.length
  const checkinViews = checkinRecords.map((record) => toRecordView(record, todayDate, todayDate))
  const sortedCheckinViews = applyVariedRecordTones(sortCheckinViews(checkinViews))
  const todayTaskItems = applyVariedRecordTones(sortTodayTaskViews(
    sortRecordsByDate(todayTaskRecords).map((record) => toRecordView(record, todayDate)),
  ))
  const todayTaskDoneCount = todayTaskItems.filter((record) => record.isRecurring ? record.isCheckinDone : record.isDone).length
  // 今日首页按设计稿展示“已完成 / 总数”；无任务时保留 0 / 1 的占位比例，避免空进度条文案跳变。
  const todayProgressTarget = todayTaskItems.length > 0 ? todayTaskItems.length : 1
  const todayProgressPercent = todayTaskItems.length > 0
    ? Math.round((todayTaskDoneCount / todayTaskItems.length) * 100)
    : 0
  const checkinDoneCount = sortedCheckinViews.filter((record) => record.isCheckinDone).length
  const checkinPendingCount = sortedCheckinViews.length - checkinDoneCount
  // 日历已迁移到总览页，今日页有足够纵向空间完整展示当天全部计划，不再裁剪前两条。
  const todayCheckinItems = sortedCheckinViews
  const quadrants = buildTodayQuadrants(todayQuadrantRecords, todayDate)

  return {
    todayDate,
    todayLabel: formatDateLabel(todayDate),
    dateTitle: formatDateTitle(todayDate),
    weekdayLabel: formatWeekdayLabel(todayDate),
    overviewCards: [
      { label: '待处理', value: String(normalRecords.length), tone: 'todo' },
      { label: '待打卡', value: String(checkinPendingCount), tone: 'checkin' },
      { label: '临近到期', value: String(expirySoonCount), tone: 'expiry' },
    ],
    quadrants,
    // 首页纪念日默认展示前三条，完整数据仍保留在 anniversaryCards 中。
    // 第四条起继续通过“查看更多”进入完整列表，不改变详情、排序或邀请能力。
    recentReminders: anniversaryCards.slice(0, 3),
    anniversaryCards,
    anniversaryMainCards: anniversaryCards.slice(0, 3),
    anniversaryStackCards: anniversaryCards.slice(3, 6),
    anniversaryTotalCount: anniversaryRecords.length,
    todayTaskItems,
    checkinItems: sortedCheckinViews,
    todayCheckinItems,
    todayReminders: applyVariedRecordTones(sortRecordsByDate(todayRecords).map((record) => toRecordView(record, todayDate))),
    laterReminders: applyVariedRecordTones(expirySoonRecords.slice(0, 3).map((record) => toRecordView(record, todayDate))),
    todayCount: todayTaskItems.length,
    recentCount: anniversaryRecords.length,
    todayTaskCount: todayTaskItems.length,
    todayTaskDoneCount,
    todayProgressPercent,
    todayProgressText: `${todayTaskDoneCount} / ${todayProgressTarget}`,
    checkinCount: sortedCheckinViews.length,
    checkinDoneCount,
    checkinPendingCount,
    checkinRemainingCount: Math.max(0, sortedCheckinViews.length - todayCheckinItems.length),
    hasQuadrantRecords: todayQuadrantRecords.length > 0,
    hasTodayTaskItems: todayTaskItems.length > 0,
    hasCheckinItems: checkinViews.length > 0,
    hasTodayReminders: todayRecords.length > 0,
    hasRecentReminders: anniversaryRecords.length > 0,
  }
}

export function loadCheckinCenter(baseDate = new Date()): CheckinCenterView {
  const todayDate = formatRecordDate(baseDate)
  const activeRecords = loadRememberRecords().filter((record) => record.status !== 'done')
  const checkinRecords = activeRecords.filter((record) => record.recurrenceType !== 'none')
  const dueRecords = checkinRecords.filter((record) => isRecurringDueOnDate(record, baseDate))
  // 与首页四象限共用同一口径，避免本周待办只在某一个页面出现。
  const ordinaryDueRecords = activeRecords.filter((record) => isOrdinaryTodoActionableInWeek(record, baseDate))
  const temporaryNotes = activeRecords.filter((record) => record.type === 'note' && record.noteKind === 'temporary')
  const dailyActionRecords = ordinaryDueRecords.concat(dueRecords, temporaryNotes)
  const dailyActions = applyVariedRecordTones(sortTodayTaskViews(
    dailyActionRecords.map((record) => toRecordView(record, todayDate, record.recurrenceType !== 'none' ? todayDate : undefined)),
  ))
  const dueItems = dailyActions
  const allItems = applyVariedRecordTones(sortCheckinViews(
    checkinRecords.concat(ordinaryDueRecords, temporaryNotes)
      .map((record) => toRecordView(record, todayDate, isRecurringDueOnDate(record, baseDate) ? todayDate : undefined)),
  ))
  const doneCount = dueItems.filter((record) => record.isRecurring ? record.isCheckinDone : record.isDone).length
  const pendingCount = dueItems.length - doneCount

  return {
    todayDate,
    todayLabel: formatDateLabel(todayDate),
    summaryCards: [
      { label: '今日打卡', value: String(dueItems.length), tone: 'checkin' },
      { label: '已完成', value: String(doneCount), tone: 'todo' },
      { label: '待完成', value: String(pendingCount), tone: 'expiry' },
    ],
    dueItems,
    dailyItems: dailyActions,
    weeklyItems: applyVariedRecordTones(sortCheckinViews(checkinRecords.filter((record) => record.recurrenceType === 'weekly').map((record) => toRecordView(record, todayDate, todayDate)))),
    monthlyItems: applyVariedRecordTones(sortCheckinViews(checkinRecords.filter((record) => record.recurrenceType === 'monthly').map((record) => toRecordView(record, todayDate, todayDate)))),
    yearlyItems: applyVariedRecordTones(sortCheckinViews(checkinRecords.filter((record) => record.recurrenceType === 'yearly').map((record) => toRecordView(record, todayDate, todayDate)))),
    dailyActions,
    allItems,
    weekDays: buildCheckinWeekDays(baseDate),
    streakDays: computeDailyCheckinStreak(checkinRecords, baseDate),
    doneCount,
    pendingCount,
    totalCount: checkinRecords.length,
    hasDueItems: dueItems.length > 0,
    hasAllItems: allItems.length > 0,
  }
}

/**
 * 读取“记得”的本地业务摘要。
 *
 * 调用时机：我的页显示、云同步回填、清空数据后刷新。
 * 注意：只统计新版记录库，不再读取旧共享缓存、旧四象限任务、积分或宠物缓存。
 */
export function loadRememberStorageSummary(baseDate = new Date()): RememberStorageSummary {
  const todayDate = formatRecordDate(baseDate)
  const records = loadRememberRecords()
  const activeRecords = records.filter((record) => record.status !== 'done')

  return {
    todayDate,
    todayLabel: formatDateLabel(todayDate),
    allCount: records.length,
    pendingCount: activeRecords.length,
    completedCount: records.filter((record) => record.status === 'done').length,
    todayCount: activeRecords.filter((record) => isRecordVisibleOnDate(record, baseDate)).length,
    recurringCount: records.filter((record) => record.recurrenceType !== 'none').length,
    hasData: records.length > 0,
  }
}

export function queryRememberRecords(query: RecordQuery = {}): RecordView[] {
  const keyword = (query.keyword || '').trim().toLowerCase()
  const selectedType = query.type || 'all'
  const todayDate = formatRecordDate()

  const records = loadRememberRecords()
    .filter((record) => query.includeDone || record.status !== 'done')
    .filter((record) => {
      if (selectedType === 'all') {
        return true
      }

      if (selectedType === 'recurring') {
        return record.recurrenceType !== 'none'
      }

      return record.type === selectedType
    })
    .filter((record) => {
      if (!keyword) {
        return true
      }

      return [record.title, record.category, record.note, getRecurrenceText(record)].some((value) => value.toLowerCase().includes(keyword))
    })
  const sortedRecords = selectedType === 'todo' || selectedType === 'anniversary'
    ? sortRecordsByTypeOrder(records)
    : records.sort((first, second) => comparePinnedRecords(first, second) || second.updatedAt - first.updatedAt)

  return applyVariedRecordTones(sortedRecords.map((record) => toRecordView(record, todayDate)))
}

export function loadCompletedRecords(): RecordView[] {
  const todayDate = formatRecordDate()
  return applyVariedRecordTones(loadRememberRecords()
    .filter((record) => record.status === 'done')
    .sort((first, second) => comparePinnedRecords(first, second) || second.updatedAt - first.updatedAt)
    .map((record) => toRecordView(record, todayDate)))
}

/**
 * 清空当前用户在本机保存的新版业务数据。
 *
 * 调用时机：我的页“清空本地与云端数据”二次确认后。
 * 注意：函数会清除记录库、旧共享缓存和本地分类历史，并标记云同步 dirtyAt；
 * 下一次同步会把空业务快照推到 sixiang_user_data，达到清空云端业务数据的效果。
 */
export function clearAllRememberUserData(): void {
  wx.removeStorageSync(RECORD_STORAGE_KEY)
  wx.removeStorageSync(FAMILY_STORAGE_KEY)
  wx.removeStorageSync(CATEGORY_HISTORY_STORAGE_KEY)
  wx.removeStorageSync(GIFT_BOOK_STORAGE_KEY)
  wx.removeStorageSync(GIFT_EXCHANGE_STORAGE_KEY)
  wx.removeStorageSync(MOOD_RECORD_STORAGE_KEY)
  scheduleUserDataCloudSync()
}

export function buildCalendarMonthView(monthDate: string, selectedDate: string): CalendarMonthView {
  const safeMonthDate = isRecordDate(monthDate) ? monthDate : formatRecordDate()
  const safeSelectedDate = isRecordDate(selectedDate) ? selectedDate : formatRecordDate()
  const anchor = parseRecordDate(safeMonthDate) || new Date()
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const firstGridDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - monthStart.getDay())
  const records = loadRememberRecords()
  const todayDate = formatRecordDate()
  const days: CalendarDayView[] = []

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(firstGridDate.getFullYear(), firstGridDate.getMonth(), firstGridDate.getDate() + index)
    const dateText = formatRecordDate(date)
    const dayRecords = records.filter((record) => isRecordVisibleOnDate(record, date))
    const markerTones = uniqueStrings(dayRecords.map((record) => getCalendarMarkerTone(record))).slice(0, 3)

    days.push({
      date: dateText,
      day: String(date.getDate()),
      inMonth: date.getMonth() === monthStart.getMonth(),
      isToday: dateText === todayDate,
      isSelected: dateText === safeSelectedDate,
      markerTones,
    })
  }

  const selectedDateObject = parseRecordDate(safeSelectedDate) || new Date()
  const selectedRecords = sortRecordsByDate(records.filter((record) => isRecordVisibleOnDate(record, selectedDateObject)))
  const monthNodes = sortRecordsByDate(
    records.filter((record) => {
      if (record.recurrenceType !== 'none') {
        return false
      }

      const recordDate = parseRecordDate(record.date)
      return recordDate && recordDate.getFullYear() === monthStart.getFullYear() && recordDate.getMonth() === monthStart.getMonth()
    }),
  ).slice(0, 4)

  return {
    monthDate: formatRecordDate(monthStart),
    monthLabel: `${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月`,
    days,
    selectedDate: safeSelectedDate,
    selectedDateTitle: formatDateTitle(safeSelectedDate),
    selectedWeekdayLabel: formatWeekdayLabel(safeSelectedDate),
    selectedSummaryText: `当天共有 ${selectedRecords.length} 条记录`,
    selectedRecords: applyVariedRecordTones(selectedRecords.map((record) => toRecordView(record, todayDate, safeSelectedDate))),
    monthNodes: applyVariedRecordTones(monthNodes.map((record) => toRecordView(record, todayDate))),
  }
}

export function shiftMonth(monthDate: string, offset: number): string {
  const baseDate = parseRecordDate(monthDate) || new Date()
  return formatRecordDate(new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1))
}

export function formatRecordDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isRecordDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value)
}

export function formatDateLabel(dateText: string): string {
  const date = parseRecordDate(dateText)
  if (!date) {
    return '今天'
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAY_LABELS[date.getDay()]}`
}

export function formatDateTitle(dateText: string): string {
  const date = parseRecordDate(dateText)
  if (!date) {
    return '今天'
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatWeekdayLabel(dateText: string): string {
  const date = parseRecordDate(dateText)
  if (!date) {
    return '今天'
  }

  return WEEKDAY_LABELS[date.getDay()]
}

export function formatShortDate(dateText: string): string {
  const date = parseRecordDate(dateText)
  if (!date) {
    return '今天'
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function getRemindText(minutes: number): string {
  const option = REMIND_OPTIONS.find((item) => item.value === minutes)
  return option ? option.label : '不提醒'
}

export function getTodayDate(): string {
  return formatRecordDate()
}

function buildRecordFromDraft(draft: RecordDraft, existing: RememberRecord | undefined, now: number): RememberRecord {
  const type = isRecordType(draft.type) ? draft.type : 'todo'
  const meta = getRecordTypeMeta(type)
  const title = draft.title.trim()

  if (!title) {
    throw new Error('标题不能为空')
  }

  if (!isRecordDate(draft.date)) {
    throw new Error('日期不合法')
  }

  const visibilityMeta = normalizeRecordVisibility(draft.visibility, draft.familyId)
  const time = draft.isAllDay ? '' : normalizeTime(draft.time)
  const remindBeforeMinutes = normalizeRemindBeforeMinutes(draft.remindBeforeMinutes)
  const recurrenceType = type === 'todo' && isRecurrenceType(draft.recurrenceType) ? draft.recurrenceType : 'none'
  const weeklyDays = recurrenceType === 'weekly' ? normalizeWeeklyDays(draft.weeklyDays, draft.date) : []
  // 新版计划按每个发生日完成一次，不再用整周/整月累计次数结束整个周期。
  const targetCount = recurrenceType === 'none' ? 0 : 1
  const targetUnit = recurrenceType === 'none' ? '' : '次'
  const repeatRule = type === 'anniversary' ? 'yearly' : isRepeatRule(draft.repeatRule) ? draft.repeatRule : 'none'
  const category = draft.category.trim() || meta.category
  const noteKind = type === 'note' && isNoteKind(draft.noteKind) ? draft.noteKind : 'long_term'
  const quadrant = type === 'todo'
    ? normalizeTodoQuadrantId(draft.quadrant)
    : type === 'note' && noteKind === 'temporary'
      ? 'avoid'
      : DEFAULT_TODO_QUADRANT_ID
  const anniversaryMode = type === 'anniversary'
    ? normalizeAnniversaryMode(draft.anniversaryMode, title, category)
    : 'elapsed'

  return {
    id: existing ? existing.id : createRecordId(now),
    type,
    title,
    category,
    quadrant,
    quadrantOrder: existing && existing.type === type && existing.quadrant === quadrant ? existing.quadrantOrder : now,
    // 未手动排序前保持 0，列表继续沿用原来的“最近更新”顺序；首次调整后才写入显式序号。
    typeOrder: existing && existing.type === type ? existing.typeOrder : 0,
    anniversaryMode,
    date: draft.date,
    time,
    isAllDay: draft.isAllDay || !time,
    remindAt: computeRemindAt(type, draft.date, time, draft.isAllDay || !time, remindBeforeMinutes),
    remindBeforeMinutes,
    repeatRule,
    recurrenceType,
    weeklyDays,
    targetCount,
    targetUnit,
    checkinHistory: shouldKeepExistingCheckinHistory(existing, recurrenceType) ? existing.checkinHistory : {},
    noteKind,
    scheduleVersion: 2,
    status: recurrenceType === 'none' && isRecordStatus(draft.status) ? draft.status : 'pending',
    note: draft.note.trim(),
    visibility: visibilityMeta.visibility,
    familyId: visibilityMeta.familyId,
    pinnedAt: existing && canRecordTypePin(type, noteKind) ? existing.pinnedAt : 0,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    deletedAt: existing ? existing.deletedAt : null,
  }
}

// 编辑目标时只有周期类型未改变才保留历史进度，避免“每日改每月”后旧 periodKey 混入新目标。
function shouldKeepExistingCheckinHistory(existing: RememberRecord | undefined, nextRecurrenceType: RecurrenceType): existing is RememberRecord {
  return Boolean(existing && nextRecurrenceType !== 'none' && existing.recurrenceType === nextRecurrenceType)
}

function normalizeRememberRecords(rawRecords: unknown): RememberRecord[] {
  if (!Array.isArray(rawRecords)) {
    return []
  }

  return rawRecords
    .map((record, index) => normalizeRememberRecord(record, Date.now() + index))
    .filter((record): record is RememberRecord => Boolean(record))
    .slice(0, MAX_RECORD_COUNT)
}

function normalizeRememberRecord(rawRecord: unknown, fallbackTime: number): RememberRecord | null {
  if (!rawRecord || typeof rawRecord !== 'object') {
    return null
  }

  const record = rawRecord as Partial<RememberRecord>
  const type = isRecordType(record.type) ? record.type : 'todo'
  const meta = getRecordTypeMeta(type)
  const title = typeof record.title === 'string' ? record.title.trim() : ''

  if (!title) {
    return null
  }

  const category = typeof record.category === 'string' && record.category.trim() ? record.category.trim() : meta.category
  const date = isRecordDate(record.date) ? record.date : formatRecordDate()
  const isAllDay = Boolean(record.isAllDay || !normalizeTime(record.time))
  const time = isAllDay ? '' : normalizeTime(record.time)
  const visibilityMeta = normalizeRecordVisibility(record.visibility, record.familyId)
  const remindBeforeMinutes = normalizeRemindBeforeMinutes(record.remindBeforeMinutes)
  const recurrenceType = type === 'todo' && isRecurrenceType(record.recurrenceType) ? record.recurrenceType : 'none'
  const noteKind = type === 'note'
    ? isNoteKind(record.noteKind)
      ? record.noteKind
      : category === '临时便签'
        ? 'temporary'
        : 'long_term'
    : 'long_term'
  const quadrant = type === 'todo'
    ? normalizeTodoQuadrantId(record.quadrant)
    : type === 'note' && noteKind === 'temporary'
      ? 'avoid'
      : DEFAULT_TODO_QUADRANT_ID
  const weeklyDays = recurrenceType === 'weekly' ? normalizeWeeklyDays(record.weeklyDays, date) : []
  const normalizedHistory = recurrenceType === 'none' ? {} : normalizeCheckinHistory(record.checkinHistory)
  const checkinHistory = recurrenceType === 'none'
    ? {}
    : record.scheduleVersion === 2
      ? normalizedHistory
      : migrateLegacyCheckinHistory(normalizedHistory, recurrenceType, weeklyDays, date)
  const anniversaryMode = type === 'anniversary'
    ? normalizeAnniversaryMode(record.anniversaryMode, title, category)
    : 'elapsed'

  return {
    id: typeof record.id === 'string' && record.id ? record.id : createRecordId(fallbackTime),
    type,
    title,
    category,
    quadrant,
    quadrantOrder: typeof record.quadrantOrder === 'number' && record.quadrantOrder > 0 ? record.quadrantOrder : 0,
    typeOrder: typeof record.typeOrder === 'number' && record.typeOrder > 0 ? record.typeOrder : 0,
    anniversaryMode,
    date,
    time,
    isAllDay,
    remindAt: typeof record.remindAt === 'number' ? record.remindAt : computeRemindAt(type, date, time, isAllDay, remindBeforeMinutes),
    remindBeforeMinutes,
    repeatRule: type === 'anniversary' ? 'yearly' : isRepeatRule(record.repeatRule) ? record.repeatRule : 'none',
    recurrenceType,
    weeklyDays,
    targetCount: recurrenceType === 'none' ? 0 : 1,
    targetUnit: recurrenceType === 'none' ? '' : '次',
    checkinHistory,
    noteKind,
    scheduleVersion: 2,
    status: recurrenceType === 'none' && isRecordStatus(record.status) ? record.status : 'pending',
    note: typeof record.note === 'string' ? record.note.trim() : '',
    visibility: visibilityMeta.visibility,
    familyId: visibilityMeta.familyId,
    pinnedAt: canRecordTypePin(type, noteKind) && typeof record.pinnedAt === 'number' && record.pinnedAt > 0 ? record.pinnedAt : 0,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : fallbackTime,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : fallbackTime,
    deletedAt: typeof record.deletedAt === 'number' ? record.deletedAt : null,
  }
}

/**
 * 把旧版按周/月累计的进度转换为一次具体日期打卡。
 *
 * 旧结构只保存最后完成时间，无法可靠还原多天明细，因此每个旧周期最多迁移一次，
 * 不虚构额外打卡；scheduleVersion=2 后不会再次进入本迁移。
 */
function migrateLegacyCheckinHistory(
  history: Record<string, CheckinEntry>,
  recurrenceType: RecurrenceType,
  weeklyDays: number[],
  startDateText: string,
): Record<string, CheckinEntry> {
  if (recurrenceType === 'daily') {
    return history
  }

  const startDate = parseRecordDate(startDateText)
  return Object.keys(history).reduce<Record<string, CheckinEntry>>((result, key) => {
    const entry = history[key]
    if (key.startsWith('day:')) {
      result[key] = entry
      return result
    }

    const completedDate = new Date(entry.completedAt)
    const completedDateText = formatRecordDate(completedDate)
    const validDate = Number.isFinite(completedDate.getTime())
      && (!startDate || startOfDay(completedDate) >= startOfDay(startDate))
      && (recurrenceType !== 'weekly' || weeklyDays.includes(completedDate.getDay()))

    if (!validDate) {
      return result
    }

    const dayKey = `day:${completedDateText}`
    result[dayKey] = {
      ...entry,
      periodKey: dayKey,
      actualCount: 1,
    }
    return result
  }, {})
}

function buildTodayQuadrants(records: RememberRecord[], todayDate: string): TodayQuadrantView[] {
  const groupedRecords: Record<TodoQuadrantId, RememberRecord[]> = {
    'do-now': [],
    schedule: [],
    quick: [],
    avoid: [],
  }

  sortTodayQuadrantRecords(records).forEach((record) => {
    groupedRecords[getTodayQuadrantId(record)].push(record)
  })

  return TODO_QUADRANT_OPTIONS.map((config) => {
    const quadrantRecords = groupedRecords[config.id]
    // 象限保持固定高度，由页面内部 scroll-view 承载全部事项；超过 3 条时保留省略提示作为可滚动线索。

    return {
      ...config,
      count: quadrantRecords.length,
      remainingCount: Math.max(0, quadrantRecords.length - 3),
      records: applyVariedRecordTones(quadrantRecords.map((record) => toRecordView(record, todayDate))),
    }
  })
}

function getTodayQuadrantId(record: RememberRecord): TodoQuadrantId {
  if (record.type === 'note' && record.noteKind === 'temporary') {
    return 'avoid'
  }

  return normalizeTodoQuadrantId(record.quadrant)
}

/**
 * 四象限优先使用用户调整后的显式顺序；旧记录没有顺序字段时继续沿用原日期顺序。
 */
function sortTodayQuadrantRecords(records: RememberRecord[]): RememberRecord[] {
  return records.slice().sort((first, second) => {
    const firstOrder = first.quadrantOrder || 0
    const secondOrder = second.quadrantOrder || 0

    if (firstOrder !== secondOrder) {
      if (!firstOrder) {
        return -1
      }

      if (!secondOrder) {
        return 1
      }

      return firstOrder - secondOrder
    }

    return compareRecordsByDate(first, second)
  })
}

/**
 * 单类型记录列表优先使用用户顺序；旧数据仍按最近更新时间展示。
 */
function sortRecordsByTypeOrder(records: RememberRecord[]): RememberRecord[] {
  return records.slice().sort((first, second) => {
    const firstOrder = first.typeOrder || 0
    const secondOrder = second.typeOrder || 0

    if (firstOrder !== secondOrder) {
      if (!firstOrder) {
        return 1
      }

      if (!secondOrder) {
        return -1
      }

      return firstOrder - secondOrder
    }

    return comparePinnedRecords(first, second) || second.updatedAt - first.updatedAt
  })
}

function sortRecordsByDate(records: RememberRecord[]): RememberRecord[] {
  return records.slice().sort(compareRecordsByDate)
}

function compareRecordsByDate(first: RememberRecord, second: RememberRecord): number {
  const pinnedDelta = comparePinnedRecords(first, second)
  if (pinnedDelta !== 0) {
    return pinnedDelta
  }

  if (first.recurrenceType !== second.recurrenceType) {
    return first.recurrenceType === 'none' ? 1 : -1
  }

  if (first.date !== second.date) {
    return first.date > second.date ? 1 : -1
  }

  if (first.isAllDay !== second.isAllDay) {
    return first.isAllDay ? 1 : -1
  }

  if (first.time !== second.time) {
    return first.time > second.time ? 1 : -1
  }

  return first.createdAt - second.createdAt
}

function comparePinnedRecords(first: RememberRecord, second: RememberRecord): number {
  const firstPinnedAt = first.pinnedAt || 0
  const secondPinnedAt = second.pinnedAt || 0

  if (firstPinnedAt !== secondPinnedAt) {
    if (!firstPinnedAt) {
      return 1
    }

    if (!secondPinnedAt) {
      return -1
    }

    return secondPinnedAt - firstPinnedAt
  }

  return 0
}

function sortCheckinViews(records: RecordView[]): RecordView[] {
  return records.slice().sort((first, second) => {
    if (first.isCheckinDone !== second.isCheckinDone) {
      return first.isCheckinDone ? 1 : -1
    }

    return first.createdAt - second.createdAt
  })
}

function sortTodayTaskViews(records: RecordView[]): RecordView[] {
  return records.slice().sort((first, second) => {
    const firstDone = first.isRecurring ? first.isCheckinDone : first.isDone
    const secondDone = second.isRecurring ? second.isCheckinDone : second.isDone

    if (firstDone !== secondDone) {
      return firstDone ? 1 : -1
    }

    if (first.isRecurring !== second.isRecurring) {
      return first.isRecurring ? 1 : -1
    }

    if (first.date !== second.date) {
      return first.date > second.date ? 1 : -1
    }

    return first.createdAt - second.createdAt
  })
}

function parseRecordDate(dateText: string): Date | null {
  if (!DATE_PATTERN.test(dateText)) {
    return null
  }

  const [yearText, monthText, dayText] = dateText.split('-')
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
}

function getRelativeText(dateText: string, todayDate: string): string {
  const date = parseRecordDate(dateText)
  const today = parseRecordDate(todayDate)

  if (!date || !today) {
    return '今天'
  }

  const dayDiff = Math.round((date.getTime() - today.getTime()) / ONE_DAY_MS)

  if (dayDiff === 0) {
    return '今天'
  }

  if (dayDiff === 1) {
    return '明天'
  }

  if (dayDiff > 1) {
    return `${dayDiff}天`
  }

  return `逾期${Math.abs(dayDiff)}天`
}

function normalizeAnniversaryMode(value: unknown, title = '', category = ''): AnniversaryMode {
  return isAnniversaryMode(value) ? value : inferAnniversaryMode(title, category)
}

function normalizeTodoQuadrantId(value: unknown): TodoQuadrantId {
  return isTodoQuadrantId(value) ? value : DEFAULT_TODO_QUADRANT_ID
}

function getAnniversaryViewMeta(
  record: RememberRecord,
  todayDate: string,
): {
  displayText: string
  subText: string
  tone: string
  modeLabel: string
  mode: AnniversaryMode
  daysUntil: number
  metricPrefix: string
  metricValue: string
  metricUnit: string
} {
  if (record.type !== 'anniversary') {
    return {
      displayText: getRelativeText(record.date, todayDate),
      subText: formatDateLabel(record.date),
      tone: getRecordTypeMeta(record.type).tone,
      modeLabel: '',
      mode: 'elapsed',
      daysUntil: 0,
      metricPrefix: '',
      metricValue: '',
      metricUnit: '',
    }
  }

  const mode = normalizeAnniversaryMode(record.anniversaryMode, record.title, record.category)
  const recordDate = parseRecordDate(record.date)
  const today = parseRecordDate(todayDate)

  if (!recordDate || !today) {
    return {
      displayText: '今天',
      subText: record.date,
      tone: mode === 'countdown' ? 'lagoon' : 'coral',
      modeLabel: mode === 'countdown' ? '年度提醒' : '纪念起点',
      mode,
      daysUntil: 0,
      metricPrefix: '',
      metricValue: '今天',
      metricUnit: '',
    }
  }

  if (mode === 'countdown') {
    const nextOccurrence = getNextAnnualOccurrence(recordDate, today)
    const daysUntil = getDayDiff(nextOccurrence, today)
    const birthday = isBirthdayAnniversary(record)
    const displayText = daysUntil === 0
      ? birthday ? '今天生日' : '就是今天'
      : daysUntil === 1
        ? birthday ? '明天生日' : '明天'
        : `还有 ${daysUntil} 天`
    const metricPrefix = daysUntil > 1 ? '还有' : ''
    const metricValue = daysUntil === 0 ? '今天' : daysUntil === 1 ? '明天' : String(daysUntil)
    const metricUnit = daysUntil > 1 ? '天' : birthday ? '生日' : ''

    return {
      displayText,
      subText: `每年 ${recordDate.getMonth() + 1}月${recordDate.getDate()}日`,
      tone: 'lagoon',
      modeLabel: '年度提醒',
      mode,
      daysUntil,
      metricPrefix,
      metricValue,
      metricUnit,
    }
  }

  const daysFromStart = getDayDiff(today, recordDate)
  const displayText = daysFromStart < 0
    ? daysFromStart === -1 ? '明天开始' : `还有 ${Math.abs(daysFromStart)} 天开始`
    : `已经 ${daysFromStart + 1} 天`

  return {
    displayText,
    subText: `从 ${record.date} 开始`,
    tone: 'coral',
    modeLabel: '纪念起点',
    mode,
    daysUntil: Math.max(0, -daysFromStart),
    metricPrefix: daysFromStart < 0 ? '还有' : '已经',
    metricValue: String(daysFromStart < 0 ? Math.abs(daysFromStart) : daysFromStart + 1),
    metricUnit: daysFromStart < 0 ? '天开始' : '天',
  }
}

function getNextAnnualOccurrence(recordDate: Date, today: Date): Date {
  let occurrence = createAnnualOccurrence(recordDate, today.getFullYear())
  const originalStart = startOfDay(recordDate)
  const todayStart = startOfDay(today)

  if (occurrence < todayStart) {
    occurrence = createAnnualOccurrence(recordDate, today.getFullYear() + 1)
  }

  return occurrence < originalStart ? originalStart : occurrence
}

function createAnnualOccurrence(recordDate: Date, year: number): Date {
  const month = recordDate.getMonth()
  const originalDay = recordDate.getDate()
  const lastDay = new Date(year, month + 1, 0).getDate()
  return startOfDay(new Date(year, month, Math.min(originalDay, lastDay)))
}

function isBirthdayAnniversary(record: RememberRecord): boolean {
  return `${record.title}${record.category}`.includes('生日')
}

function getDayDiff(target: Date, base: Date): number {
  return Math.round((startOfDay(target).getTime() - startOfDay(base).getTime()) / ONE_DAY_MS)
}

function sortAnniversaryRecords(records: RememberRecord[], todayDate: string): RememberRecord[] {
  const today = parseRecordDate(todayDate) || new Date()

  return records.slice().sort((first, second) => {
    const firstOrder = first.typeOrder || 0
    const secondOrder = second.typeOrder || 0
    if (firstOrder !== secondOrder) {
      if (!firstOrder) {
        return 1
      }

      if (!secondOrder) {
        return -1
      }

      return firstOrder - secondOrder
    }

    const pinnedDelta = comparePinnedRecords(first, second)
    if (pinnedDelta !== 0) {
      return pinnedDelta
    }

    const firstMode = normalizeAnniversaryMode(first.anniversaryMode, first.title, first.category)
    const secondMode = normalizeAnniversaryMode(second.anniversaryMode, second.title, second.category)

    if (firstMode !== secondMode) {
      return firstMode === 'elapsed' ? -1 : 1
    }

    if (firstMode === 'countdown') {
      const firstDate = parseRecordDate(first.date)
      const secondDate = parseRecordDate(second.date)
      const firstDays = firstDate ? getDayDiff(getNextAnnualOccurrence(firstDate, today), today) : 9999
      const secondDays = secondDate ? getDayDiff(getNextAnnualOccurrence(secondDate, today), today) : 9999

      if (firstDays !== secondDays) {
        return firstDays - secondDays
      }
    }

    if (first.date !== second.date) {
      return first.date > second.date ? -1 : 1
    }

    return first.createdAt - second.createdAt
  })
}

function isRecordVisibleOnDate(record: RememberRecord, date: Date): boolean {
  if (record.deletedAt || record.status === 'done') {
    return false
  }

  if (record.recurrenceType !== 'none') {
    return isRecurringDueOnDate(record, date)
  }

  if (record.type === 'note' && record.noteKind === 'temporary') {
    return true
  }

  if (record.type === 'anniversary') {
    return isAnniversaryVisibleOnDate(record, date)
  }

  return record.date === formatRecordDate(date)
}

/**
 * 汇总指定日期应出现在首页四象限中的待办。
 *
 * 普通待办从截止日期所在周开始持续显示到完成；周期待办只在应打卡日且本周期尚未达标时显示。
 * 该函数同时供首页聚合和长按排序使用，避免“看得见但排不了序”的筛选口径不一致。
 */
function getTodayQuadrantRecords(records: RememberRecord[], date = new Date()): RememberRecord[] {
  return records.filter((record) => {
    if (record.deletedAt || record.status === 'done') {
      return false
    }

    if (record.type === 'note' && record.noteKind === 'temporary') {
      return true
    }

    if (record.type !== 'todo') {
      return false
    }

    if (record.recurrenceType === 'none') {
      return isOrdinaryTodoActionableInWeek(record, date)
    }

    if (!isRecurringDueOnDate(record, date)) {
      return false
    }

    const entry = record.checkinHistory[getCheckinPeriodKey(record, date)]
    return !entry || entry.actualCount < getCheckinTarget(record)
  })
}

/**
 * 判断普通待办是否应进入当前周的持续行动列表。
 *
 * 参数说明：
 * - record：待判断的记录，仅普通待办会返回 true。
 * - date：当前页面使用的基准日期，便于跨天测试和日历模拟。
 *
 * 规则说明：
 * - 截止日在本周日及以前：本周每天持续显示，逾期后也继续显示。
 * - 截止日在下周及以后：暂不提前展示，等进入对应周后再显示。
 * - 完成与删除状态由调用方统一过滤，避免这里重复承担状态判断。
 */
function isOrdinaryTodoActionableInWeek(record: RememberRecord, date = new Date()): boolean {
  if (record.type !== 'todo' || record.recurrenceType !== 'none') {
    return false
  }

  return record.date <= formatRecordDate(getWeekEnd(date))
}

function isAnniversaryVisibleOnDate(record: RememberRecord, date: Date): boolean {
  const recordDate = parseRecordDate(record.date)

  if (!recordDate || startOfDay(date) < startOfDay(recordDate)) {
    return false
  }

  return recordDate.getMonth() === date.getMonth() && recordDate.getDate() === date.getDate()
}

function getCalendarMarkerTone(record: RememberRecord): string {
  if (record.recurrenceType !== 'none') {
    return 'checkin'
  }

  if (record.type === 'anniversary') {
    return getAnniversaryViewMeta(record, formatRecordDate()).tone
  }

  return getRecordTypeMeta(record.type).tone
}

function isRecurringDueOnDate(record: RememberRecord, date = new Date()): boolean {
  if (record.recurrenceType === 'none' || record.type !== 'todo') {
    return false
  }

  const startDate = parseRecordDate(record.date)
  if (!startDate || date < startOfDay(startDate)) {
    return false
  }

  if (record.recurrenceType === 'daily') {
    return true
  }

  if (record.recurrenceType === 'weekly') {
    return record.weeklyDays.includes(date.getDay())
  }

  if (record.recurrenceType === 'monthly') {
    return isMonthlyDueOnDate(record, date)
  }

  return isYearlyDueOnDate(record, date)
}

function getCheckinPeriodKey(_record: RememberRecord, date = new Date()): string {
  return `day:${formatRecordDate(date)}`
}

function getWeekStart(date: Date): Date {
  const day = date.getDay()
  const offset = day === 0 ? -6 : 1 - day
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)
}

/**
 * 获取当前自然周的周日，周口径与表单“本周内”快捷选项保持一致（周一至周日）。
 */
function getWeekEnd(date: Date): Date {
  const day = date.getDay()
  const offset = day === 0 ? 0 : 7 - day
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isMonthlyDueOnDate(record: RememberRecord, date = new Date()): boolean {
  const startDate = parseRecordDate(record.date)
  if (!startDate) {
    return false
  }

  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const dueDay = Math.min(startDate.getDate(), lastDay)
  return date.getDate() === dueDay
}

function isYearlyDueOnDate(record: RememberRecord, date = new Date()): boolean {
  const startDate = parseRecordDate(record.date)
  if (!startDate) {
    return false
  }

  const lastDay = new Date(date.getFullYear(), startDate.getMonth() + 1, 0).getDate()
  return date.getMonth() === startDate.getMonth() && date.getDate() === Math.min(startDate.getDate(), lastDay)
}

function getCheckinTarget(record: RememberRecord): number {
  return record.recurrenceType === 'none' ? 1 : 1
}

/** 计算当前日/周/月/年周期内应发生和已完成的独立日期数量。 */
function getRecurrencePeriodProgress(record: RememberRecord, date: Date): { actual: number; target: number } {
  const occurrenceDates = getRecurrencePeriodDates(record, date)
  const actual = occurrenceDates.filter((occurrenceDate) => {
    const entry = record.checkinHistory[`day:${formatRecordDate(occurrenceDate)}`]
    return Boolean(entry && entry.actualCount >= 1)
  }).length

  return {
    actual,
    target: Math.max(1, occurrenceDates.length),
  }
}

function getRecurrencePeriodDates(record: RememberRecord, date: Date): Date[] {
  const startDate = parseRecordDate(record.date)
  if (!startDate) {
    return []
  }

  if (record.recurrenceType === 'weekly') {
    const weekStart = getWeekStart(date)
    return Array.from({ length: 7 })
      .map((_, index) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index))
      .filter((occurrenceDate) => occurrenceDate >= startOfDay(startDate) && record.weeklyDays.includes(occurrenceDate.getDay()))
  }

  if (record.recurrenceType === 'monthly') {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    const occurrenceDate = new Date(date.getFullYear(), date.getMonth(), Math.min(startDate.getDate(), lastDay))
    return occurrenceDate >= startOfDay(startDate) ? [occurrenceDate] : []
  }

  if (record.recurrenceType === 'yearly') {
    const lastDay = new Date(date.getFullYear(), startDate.getMonth() + 1, 0).getDate()
    const occurrenceDate = new Date(date.getFullYear(), startDate.getMonth(), Math.min(startDate.getDate(), lastDay))
    return occurrenceDate >= startOfDay(startDate) ? [occurrenceDate] : []
  }

  return date >= startOfDay(startDate) ? [startOfDay(date)] : []
}

function buildCheckinWeekDays(baseDate = new Date()): Array<{ label: string; day: string; checked: boolean; isToday: boolean }> {
  const records = loadRememberRecords()
  const weekStart = getWeekStart(baseDate)

  return Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index)
    const dateText = formatRecordDate(date)
    const dueRecords = records.filter((record) => isRecurringDueOnDate(record, date))
    const checked = dueRecords.length > 0 && dueRecords.every((record) => {
      const periodKey = getCheckinPeriodKey(record, date)
      const entry = record.checkinHistory[periodKey]
      return Boolean(entry && entry.actualCount >= getCheckinTarget(record))
    })

    return {
      label: WEEKDAY_LABELS[date.getDay()].replace('周', ''),
      day: String(date.getDate()),
      checked,
      isToday: formatRecordDate(baseDate) === dateText,
    }
  })
}

function computeDailyCheckinStreak(records: RememberRecord[], baseDate = new Date()): number {
  let streak = 0

  for (let offset = 0; offset < 365; offset += 1) {
    const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - offset)
    const dailyRecords = records.filter((record) => record.recurrenceType === 'daily' && isRecurringDueOnDate(record, date))

    if (!dailyRecords.length) {
      if (offset === 0) {
        continue
      }
      break
    }

    const allDone = dailyRecords.every((record) => {
      const periodKey = getCheckinPeriodKey(record, date)
      const entry = record.checkinHistory[periodKey]
      return Boolean(entry && entry.actualCount >= getCheckinTarget(record))
    })

    if (!allDone) {
      break
    }

    streak += 1
  }

  return streak
}

function getRecordVisualMeta(record: RememberRecord, fallbackTone: string): { icon: string; iconAsset: string; tone: string } {
  const title = `${record.title}${record.category}`.toLowerCase()

  if (record.type === 'anniversary') {
    return normalizeAnniversaryMode(record.anniversaryMode, record.title, record.category) === 'countdown'
      ? { icon: '◌', iconAsset: '/assets/ui-icons/anniversary-cake.png', tone: 'lagoon' }
      : { icon: '♡', iconAsset: '/assets/ui-icons/anniversary-heart.png', tone: 'coral' }
  }

  if (title.includes('喝水') || title.includes('水')) {
    return { icon: '♧', iconAsset: '/assets/ui-icons/goal-daily.png', tone: 'mint' }
  }

  if (title.includes('读') || title.includes('书') || title.includes('学习')) {
    return { icon: '□', iconAsset: '/assets/ui-icons/note-square.png', tone: 'blue' }
  }

  if (title.includes('运动') || title.includes('健身') || title.includes('跑') || title.includes('房')) {
    return { icon: '⌁', iconAsset: '/assets/ui-icons/goal-daily.png', tone: 'green' }
  }

  if (title.includes('生日') || title.includes('纪念')) {
    return { icon: '▣', iconAsset: '/assets/ui-icons/anniversary-heart.png', tone: 'rose' }
  }

  if (title.includes('到期') || title.includes('过期')) {
    return { icon: '△', iconAsset: '/assets/ui-icons/expiry-alert.png', tone: 'amber' }
  }

  if (record.recurrenceType !== 'none') {
    const recurrenceAssets: Record<RecurrenceType, string> = {
      none: '/assets/ui-icons/todo-check.png',
      daily: '/assets/ui-icons/goal-daily.png',
      weekly: '/assets/ui-icons/goal-weekly.png',
      monthly: '/assets/ui-icons/goal-monthly.png',
      yearly: '/assets/ui-icons/anniversary-cake.png',
    }
    return {
      icon: '✧',
      iconAsset: recurrenceAssets[record.recurrenceType],
      tone: record.recurrenceType === 'yearly' ? 'mint' : record.recurrenceType === 'monthly' ? 'amber' : record.recurrenceType === 'weekly' ? 'rose' : 'violet',
    }
  }

  const toneMap: Record<string, { icon: string; iconAsset: string; tone: string }> = {
    todo: { icon: '✧', iconAsset: '/assets/ui-icons/todo-check.png', tone: 'blue' },
    anniversary: { icon: '▣', iconAsset: '/assets/ui-icons/anniversary-heart.png', tone: 'rose' },
    expiry: { icon: '△', iconAsset: '/assets/ui-icons/expiry-alert.png', tone: 'amber' },
    note: { icon: '□', iconAsset: '/assets/ui-icons/note-square.png', tone: 'violet' },
  }

  return toneMap[fallbackTone] || { icon: '✧', iconAsset: '/assets/ui-icons/todo-check.png', tone: 'violet' }
}

function getRecurrenceText(record: RememberRecord): string {
  if (record.recurrenceType === 'daily') {
    return '每天'
  }

  if (record.recurrenceType === 'weekly') {
    const days = record.weeklyDays.map((day) => WEEKDAY_LABELS[day]).join('、')
    return days ? `每周 ${days}` : '每周'
  }

  if (record.recurrenceType === 'monthly') {
    const startDate = parseRecordDate(record.date)
    return startDate ? `每月 ${startDate.getDate()} 日` : '每月'
  }

  if (record.recurrenceType === 'yearly') {
    const startDate = parseRecordDate(record.date)
    return startDate ? `每年 ${startDate.getMonth() + 1}月${startDate.getDate()}日` : '每年'
  }

  return '不重复'
}

function getTargetText(record: RememberRecord): string {
  if (record.recurrenceType === 'none') {
    return ''
  }

  if (record.targetCount > 0 && record.targetUnit) {
    return '每次完成 1 次'
  }

  if (record.targetCount > 0) {
    return '每次完成 1 次'
  }

  return '每次完成 1 次'
}

function buildRecentCheckinViews(record: RememberRecord): CheckinEntryView[] {
  return Object.keys(record.checkinHistory)
    .sort()
    .reverse()
    .slice(0, 5)
    .map((key) => {
      const entry = record.checkinHistory[key]
      return {
        ...entry,
        label: key.replace('day:', ''),
        actualText: '已完成',
      }
    })
}

function normalizeFamilyState(value: unknown): FamilyState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const rawFamilyState = value as Partial<FamilyState>
  const familyId = normalizeFamilyId(rawFamilyState.familyId)

  if (!familyId) {
    return null
  }

  const fallbackTime = Date.now()
  const createdAt = typeof rawFamilyState.createdAt === 'number' && rawFamilyState.createdAt > 0
    ? rawFamilyState.createdAt
    : fallbackTime

  return {
    familyId,
    displayName: normalizeFamilyDisplayName(rawFamilyState.displayName),
    createdAt,
    updatedAt: typeof rawFamilyState.updatedAt === 'number' && rawFamilyState.updatedAt > 0
      ? rawFamilyState.updatedAt
      : createdAt,
  }
}

function normalizeFamilyDisplayName(value: unknown): string {
  const displayName = typeof value === 'string' ? value.trim().slice(0, MAX_FAMILY_NAME_LENGTH) : ''
  return displayName || '我的家庭'
}

function normalizeFamilyId(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 100) : ''
}

function normalizeRecordVisibility(visibility: unknown, familyId: unknown): { visibility: RecordVisibility; familyId: string } {
  const normalizedFamilyId = normalizeFamilyId(familyId)

  if (visibility === 'family' && normalizedFamilyId) {
    return {
      visibility: 'family',
      familyId: normalizedFamilyId,
    }
  }

  return {
    visibility: 'private',
    familyId: '',
  }
}

function normalizeTime(value: unknown): string {
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value : ''
}

function normalizeRemindBeforeMinutes(value: unknown): number {
  if (typeof value !== 'number' || value < 0) {
    return 0
  }

  const option = REMIND_OPTIONS.find((item) => item.value === value)
  return option ? option.value : 0
}

function normalizeTargetCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.min(Math.floor(value), 99999)
}

function normalizeWeeklyDays(value: unknown, fallbackDate: string): number[] {
  const fallback = parseRecordDate(fallbackDate) || new Date()
  const days = Array.isArray(value)
    ? value.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : []

  return uniqueNumbers(days.length ? days : [fallback.getDay()]).sort()
}

function normalizeCategoryList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return uniqueStrings(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 20))
      .filter(Boolean),
  ).slice(0, 20)
}

function normalizeCheckinHistory(value: unknown): Record<string, CheckinEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .map((key) => normalizeCheckinEntry(key, (value as Record<string, unknown>)[key]))
    .filter((entry): entry is CheckinEntry => Boolean(entry))

  return trimCheckinHistory(
    entries.reduce<Record<string, CheckinEntry>>((result, entry) => {
      result[entry.periodKey] = entry
      return result
    }, {}),
  )
}

function normalizeCheckinEntry(key: string, value: unknown): CheckinEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const entry = value as Partial<CheckinEntry>
  const periodKey = typeof entry.periodKey === 'string' && entry.periodKey ? entry.periodKey : key

  if (!periodKey.startsWith('day:') && !periodKey.startsWith('week:') && !periodKey.startsWith('month:')) {
    return null
  }

  return {
    periodKey,
    completedAt: typeof entry.completedAt === 'number' && entry.completedAt > 0 ? entry.completedAt : Date.now(),
    actualCount: normalizeTargetCount(entry.actualCount),
    note: typeof entry.note === 'string' ? entry.note.trim().slice(0, 100) : '',
  }
}

function trimCheckinHistory(history: Record<string, CheckinEntry>): Record<string, CheckinEntry> {
  return Object.keys(history)
    .sort()
    .reverse()
    .slice(0, MAX_CHECKIN_HISTORY_COUNT)
    .reduce<Record<string, CheckinEntry>>((result, key) => {
      result[key] = history[key]
      return result
    }, {})
}

function computeRemindAt(type: RecordType, dateText: string, timeText: string, isAllDay: boolean, beforeMinutes: number): number {
  if (type === 'note' && !timeText) {
    return 0
  }

  const date = parseRecordDate(dateText)
  if (!date) {
    return 0
  }

  const [hourText, minuteText] = (isAllDay || !timeText ? '09:00' : timeText).split(':')
  const remindDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Number(hourText), Number(minuteText))

  return remindDate.getTime() - beforeMinutes * 60 * 1000
}

function createRecordId(timestamp: number): string {
  const randomPart = Math.floor(Math.random() * 100000).toString(36)
  return `record_${timestamp}_${randomPart}`
}

function createFamilyId(timestamp: number): string {
  const randomPart = Math.floor(Math.random() * 100000).toString(36)
  return `family_${timestamp}_${randomPart}`
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function uniqueNumbers(values: number[]): number[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}
