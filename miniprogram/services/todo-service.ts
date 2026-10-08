import { isUserDataCloudSyncReady, scheduleUserDataCloudSync } from './cloud-sync-service'

/**
 * 四象限待办的本地数据服务。
 *
 * 所有任务先使用 wx.setStorageSync 保存在本机，再由 cloud-sync-service 异步上传。
 * 云端身份只由云函数读取 OPENID，本服务不接收或拼接 openid。
 *
 * V0.2 开始支持 taskDate：
 * - 首页默认读取今天任务，也支持按指定日期查看。
 * - 历史未完成任务在首次打开当天首页时自动滚入今天。
 * - 历史已完成任务保留原 taskDate，不参与今日进度。
 */
export type QuadrantId = 'do-now' | 'schedule' | 'quick' | 'avoid'

export interface QuadrantMeta {
  id: QuadrantId
  name: string
  action: string
  description: string
  emptyText: string
  tone: string
}

export interface TodoTask {
  id: string
  title: string
  note: string
  quadrant: QuadrantId
  completed: boolean
  createdAt: number
  updatedAt: number
  completedAt?: number
  taskDate: string
  dueText: string
  scoreRewardedAt?: number
  scorePenalizedAt?: number
  petRewardedAt?: number
}

export interface TodoDraft {
  title: string
  note: string
  quadrant: QuadrantId
  taskDate?: string
}

export interface QuadrantStats {
  id: QuadrantId
  name: string
  tone: string
  totalCount: number
  completedCount: number
  pendingCount: number
  completionRate: number
}

export interface TodayTodoStats {
  todayDate: string
  todayLabel: string
  totalCount: number
  completedCount: number
  pendingCount: number
  completionRate: number
  hasData: boolean
  quadrants: QuadrantStats[]
}

export interface TodoStorageSummary {
  todayDate: string
  todayLabel: string
  todayCount: number
  todayCompletedCount: number
  todayPendingCount: number
  futurePendingCount: number
  allCount: number
  allCompletedCount: number
  allPendingCount: number
  hasData: boolean
}

export interface TaskDateOption {
  label: string
  desc: string
  value: string
}

export interface TaskDatePickerRange {
  start: string
  end: string
}

const STORAGE_KEY = 'sixiang_today_tasks_v1'
const TASK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const DEFAULT_QUADRANT_ID: QuadrantId = 'schedule'

export const QUADRANTS: QuadrantMeta[] = [
  {
    id: 'do-now',
    name: '重要且紧急',
    action: '立即做',
    description: '先处理会影响今天结果的事',
    emptyText: '今天没有必须马上处理的事',
    tone: 'urgent',
  },
  {
    id: 'schedule',
    name: '重要不紧急',
    action: '安排做',
    description: '真正重要的事，给它留时间',
    emptyText: '给重要的事留一点时间',
    tone: 'plan',
  },
  {
    id: 'quick',
    name: '紧急不重要',
    action: '快速处理',
    description: '能快做就快做，别拖太久',
    emptyText: '暂时没有打断你的琐事',
    tone: 'quick',
  },
  {
    id: 'avoid',
    name: '不重要不紧急',
    action: '尽量不做',
    description: '可以删除、延后，或先放一放',
    emptyText: '这里越空越好',
    tone: 'later',
  },
]

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function isQuadrantId(value: unknown): value is QuadrantId {
  return typeof value === 'string' && QUADRANTS.some((item) => item.id === value)
}

export function formatTodayLabel(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}月${day}日 ${WEEKDAY_LABELS[date.getDay()]}`
}

export function formatTaskDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createTaskDateOptions(baseDate = new Date()): TaskDateOption[] {
  const today = createDateByOffset(baseDate, 0)
  const tomorrow = createDateByOffset(baseDate, 1)
  const afterTomorrow = createDateByOffset(baseDate, 2)

  return [
    {
      label: '今天',
      desc: formatMonthDay(today),
      value: formatTaskDate(today),
    },
    {
      label: '明天',
      desc: formatMonthDay(tomorrow),
      value: formatTaskDate(tomorrow),
    },
    {
      label: '后天',
      desc: formatMonthDay(afterTomorrow),
      value: formatTaskDate(afterTomorrow),
    },
  ]
}

export function createTaskDatePickerRange(baseDate = new Date(), futureDays = 60): TaskDatePickerRange {
  return {
    start: formatTaskDate(baseDate),
    end: formatTaskDate(createDateByOffset(baseDate, futureDays)),
  }
}

export function createTaskViewDatePickerRange(baseDate = new Date(), pastDays = 30, futureDays = 60): TaskDatePickerRange {
  return {
    start: formatTaskDate(createDateByOffset(baseDate, -pastDays)),
    end: formatTaskDate(createDateByOffset(baseDate, futureDays)),
  }
}

export function isTaskDate(value: unknown): value is string {
  return typeof value === 'string' && TASK_DATE_PATTERN.test(value)
}

export function getTaskDateText(taskDate: string, todayDate = formatTaskDate()): string {
  if (taskDate === todayDate) {
    return '今天'
  }

  const tomorrowDate = formatTaskDate(createDateByOffset(parseTaskDate(todayDate) || new Date(), 1))
  if (taskDate === tomorrowDate) {
    return '明天'
  }

  const afterTomorrowDate = formatTaskDate(createDateByOffset(parseTaskDate(todayDate) || new Date(), 2))
  if (taskDate === afterTomorrowDate) {
    return '后天'
  }

  const date = parseTaskDate(taskDate)
  return date ? `${formatMonthDay(date)} ${WEEKDAY_LABELS[date.getDay()]}` : '今天'
}

export function getTaskDateLabel(taskDate: string): string {
  const date = parseTaskDate(taskDate)

  return date ? formatTodayLabel(date) : formatTodayLabel()
}

export function createTodoTask(draft: TodoDraft, taskDate = resolveDraftTaskDate(draft.taskDate)): TodoTask {
  const now = Date.now()

  return {
    id: createTaskId(now),
    title: draft.title.trim(),
    note: draft.note.trim(),
    quadrant: draft.quadrant,
    completed: false,
    createdAt: now,
    updatedAt: now,
    taskDate,
    dueText: getTaskDateText(taskDate),
  }
}

export function loadTodoTasks(): TodoTask[] {
  return loadTodoTasksByDate(formatTaskDate())
}

export function loadTodoTasksByDate(taskDate = formatTaskDate()): TodoTask[] {
  const selectedDate = isTaskDate(taskDate) ? taskDate : formatTaskDate()

  return getTasksByDate(loadAllTodoTasks(), selectedDate)
}

export function loadFutureTodoTasks(): TodoTask[] {
  const todayDate = formatTaskDate()

  return loadAllTodoTasks()
    .filter((task) => !task.completed && task.taskDate > todayDate)
    .sort((first, second) => {
      if (first.taskDate === second.taskDate) {
        return first.createdAt - second.createdAt
      }

      return first.taskDate > second.taskDate ? 1 : -1
    })
}

export function loadAllTodoTasks(): TodoTask[] {
  const todayDate = formatTaskDate()
  const storedTasks = wx.getStorageSync(STORAGE_KEY) as unknown
  const allTasks = rollPendingTasksToToday(normalizeTodoTasks(storedTasks, todayDate), todayDate)

  // 首轮云拉取前只返回兼容后的内存结果，避免自动日期滚动覆盖云端较新的任务。
  if (isUserDataCloudSyncReady() && !isSameTaskStorage(storedTasks, allTasks)) {
    saveAllTodoTasks(allTasks)
  }

  return allTasks
}

/**
 * 积分结算专用读取入口。
 * 这里不会把历史未完成任务滚入今天，避免结算服务在扣违约分前丢失原 taskDate。
 */
export function loadAllTodoTasksForScoreSettlement(): TodoTask[] {
  const todayDate = formatTaskDate()
  return normalizeTodoTasks(wx.getStorageSync(STORAGE_KEY), todayDate)
}

/**
 * 积分结算后回写任务标记。
 * score-service 会写入 scorePenalizedAt，随后正常任务读取流程再负责日期滚入。
 */
export function saveAllTodoTasksAfterScoreSettlement(tasks: TodoTask[]): void {
  saveAllTodoTasks(tasks)
}

export function loadTodayTodoStats(): TodayTodoStats {
  const todayDate = formatTaskDate()
  const todayTasks = getTodayTasks(loadAllTodoTasks(), todayDate)
  const totalCount = todayTasks.length
  const completedCount = todayTasks.filter((task) => task.completed).length
  const pendingCount = totalCount - completedCount

  return {
    todayDate,
    todayLabel: formatTodayLabel(),
    totalCount,
    completedCount,
    pendingCount,
    completionRate: getPercent(completedCount, totalCount),
    hasData: totalCount > 0,
    quadrants: buildQuadrantStats(todayTasks),
  }
}

export function loadTodoStorageSummary(): TodoStorageSummary {
  const todayDate = formatTaskDate()
  const allTasks = loadAllTodoTasks()
  const todayTasks = getTodayTasks(allTasks, todayDate)
  const todayCompletedCount = todayTasks.filter((task) => task.completed).length
  const allCompletedCount = allTasks.filter((task) => task.completed).length
  const futurePendingCount = allTasks.filter((task) => !task.completed && task.taskDate > todayDate).length

  return {
    todayDate,
    todayLabel: formatTodayLabel(),
    todayCount: todayTasks.length,
    todayCompletedCount,
    todayPendingCount: todayTasks.length - todayCompletedCount,
    futurePendingCount,
    allCount: allTasks.length,
    allCompletedCount,
    allPendingCount: allTasks.length - allCompletedCount,
    hasData: allTasks.length > 0,
  }
}

export function saveTodoTasks(tasks: TodoTask[], taskDate = formatTaskDate()): void {
  const todayDate = formatTaskDate()
  const selectedDate = isTaskDate(taskDate) ? taskDate : todayDate
  const storedTasks = rollPendingTasksToToday(normalizeTodoTasks(wx.getStorageSync(STORAGE_KEY), todayDate), todayDate)
  const incomingTasks = normalizeTodoTasks(tasks, todayDate)
  const incomingTaskIds = incomingTasks.map((task) => task.id)
  const nextTasks = storedTasks
    .filter((task) => task.taskDate !== selectedDate && !incomingTaskIds.includes(task.id))
    .concat(incomingTasks)

  saveAllTodoTasks(nextTasks)
}

/**
 * 清空今天的任务数据。
 * 注意：本方法只删除 taskDate 为今天的任务，历史已完成记录会保留在本地 storage 中。
 */
export function clearTodayTodoTasks(): void {
  const todayDate = formatTaskDate()
  const nextTasks = loadAllTodoTasks().filter((task) => task.taskDate !== todayDate)

  saveAllTodoTasks(nextTasks)
}

/**
 * 清空全部本地任务。
 * 调用前必须在页面层二次确认，避免用户误删本机 storage 数据。
 */
export function clearAllTodoTasks(): void {
  wx.removeStorageSync(STORAGE_KEY)
  scheduleUserDataCloudSync()
}

function createTaskId(timestamp: number): string {
  const randomPart = Math.floor(Math.random() * 100000).toString(36)
  return `task_${timestamp}_${randomPart}`
}

function createDateByOffset(baseDate: Date, offsetDays: number): Date {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offsetDays)
}

function parseTaskDate(taskDate: string): Date | null {
  if (!TASK_DATE_PATTERN.test(taskDate)) {
    return null
  }

  const [year, month, day] = taskDate.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatMonthDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}月${day}日`
}

function resolveDraftTaskDate(taskDate: string | undefined): string {
  return isTaskDate(taskDate) ? taskDate : formatTaskDate()
}

function buildQuadrantStats(tasks: TodoTask[]): QuadrantStats[] {
  return QUADRANTS.map((quadrant) => {
    const quadrantTasks = tasks.filter((task) => task.quadrant === quadrant.id)
    const totalCount = quadrantTasks.length
    const completedCount = quadrantTasks.filter((task) => task.completed).length

    return {
      id: quadrant.id,
      name: quadrant.name,
      tone: quadrant.tone,
      totalCount,
      completedCount,
      pendingCount: totalCount - completedCount,
      completionRate: getPercent(completedCount, totalCount),
    }
  })
}

function getPercent(value: number, total: number): number {
  if (!total) {
    return 0
  }

  return Math.round((value / total) * 100)
}

function saveAllTodoTasks(tasks: TodoTask[]): void {
  const todayDate = formatTaskDate()
  wx.setStorageSync(STORAGE_KEY, normalizeTodoTasks(tasks, todayDate))
  scheduleUserDataCloudSync()
}

function isSameTaskStorage(storedTasks: unknown, normalizedTasks: TodoTask[]): boolean {
  if (!Array.isArray(storedTasks)) {
    return normalizedTasks.length === 0
  }

  try {
    return JSON.stringify(storedTasks) === JSON.stringify(normalizedTasks)
  } catch (error) {
    console.warn('比较任务 storage 失败，将回写规范化数据', error)
    return false
  }
}

function normalizeTodoTasks(rawTasks: unknown, todayDate: string): TodoTask[] {
  if (!Array.isArray(rawTasks)) {
    return []
  }

  const now = Date.now()
  const tasks = rawTasks
    .map((item) => normalizeTodoTask(item, now, todayDate))
    .filter((item): item is TodoTask => Boolean(item))

  return tasks.sort((first, second) => first.createdAt - second.createdAt)
}

function normalizeTodoTask(rawTask: unknown, fallbackTime: number, todayDate: string): TodoTask | null {
  if (!rawTask || typeof rawTask !== 'object') {
    return null
  }

  const task = rawTask as Partial<TodoTask>
  const title = typeof task.title === 'string' ? task.title.trim() : ''

  if (!title) {
    return null
  }

  const quadrant = isQuadrantId(task.quadrant) ? task.quadrant : DEFAULT_QUADRANT_ID
  const createdAt = typeof task.createdAt === 'number' ? task.createdAt : fallbackTime
  const updatedAt = typeof task.updatedAt === 'number' ? task.updatedAt : createdAt
  const completed = Boolean(task.completed)
  const completedAt = typeof task.completedAt === 'number' ? task.completedAt : undefined
  const scoreRewardedAt = typeof task.scoreRewardedAt === 'number' ? task.scoreRewardedAt : undefined
  const scorePenalizedAt = typeof task.scorePenalizedAt === 'number' ? task.scorePenalizedAt : undefined
  const petRewardedAt = typeof task.petRewardedAt === 'number' ? task.petRewardedAt : undefined
  const taskDate = resolveTaskDate(task, {
    todayDate,
    createdAt,
    updatedAt,
    completed,
    completedAt,
  })

  return {
    id: typeof task.id === 'string' && task.id ? task.id : createTaskId(fallbackTime),
    title,
    note: typeof task.note === 'string' ? task.note.trim() : '',
    quadrant,
    completed,
    createdAt,
    updatedAt,
    completedAt: completed ? completedAt || updatedAt : undefined,
    taskDate,
    dueText: formatDueText(taskDate, todayDate),
    scoreRewardedAt,
    scorePenalizedAt,
    petRewardedAt,
  }
}

function getTodayTasks(tasks: TodoTask[], todayDate: string): TodoTask[] {
  return tasks.filter((task) => task.taskDate === todayDate)
}

function getTasksByDate(tasks: TodoTask[], taskDate: string): TodoTask[] {
  return tasks.filter((task) => task.taskDate === taskDate)
}

function rollPendingTasksToToday(tasks: TodoTask[], todayDate: string): TodoTask[] {
  const now = Date.now()

  return tasks.map((task) => {
    if (task.completed || task.taskDate >= todayDate) {
      return {
        ...task,
        dueText: formatDueText(task.taskDate, todayDate),
      }
    }

    return {
      ...task,
      taskDate: todayDate,
      dueText: '今天',
      updatedAt: now,
    }
  })
}

function resolveTaskDate(
  task: Partial<TodoTask>,
  fallback: {
    todayDate: string
    createdAt: number
    updatedAt: number
    completed: boolean
    completedAt?: number
  },
): string {
  if (typeof task.taskDate === 'string' && TASK_DATE_PATTERN.test(task.taskDate)) {
    return task.taskDate
  }

  if (fallback.completed) {
    return formatTaskDate(new Date(fallback.completedAt || fallback.updatedAt || fallback.createdAt))
  }

  return fallback.todayDate
}

function formatDueText(taskDate: string, todayDate: string): string {
  return getTaskDateText(taskDate, todayDate)
}
