import {
  QuadrantId,
  TodoTask,
  formatTaskDate,
  saveAllTodoTasksAfterScoreSettlement,
} from './todo-service'
import { scheduleUserDataCloudSync } from './cloud-sync-service'

export type ScoreLogType = 'daily_decay' | 'task_reward' | 'task_penalty'

export interface ScoreLog {
  id: string
  type: ScoreLogType
  scoreDelta: number
  scoreAfter: number
  taskId?: string
  taskTitle?: string
  quadrant?: QuadrantId
  date: string
  createdAt: number
  reason: string
}

export interface ScoreState {
  score: number
  startedAt: number
  lastSettledDate: string
  logs: ScoreLog[]
}

export interface MedalInfo {
  name: string
  shortName: string
  description: string
  minScore: number
  nextName: string
  nextScore: number
  nextGap: number
}

export interface ScoreSummary {
  score: number
  medal: MedalInfo
  todayDecay: number
  todayReward: number
  todayPenalty: number
  todayNet: number
  recentLogs: ScoreLog[]
}

const SCORE_STORAGE_KEY = 'sixiang_score_state_v1'
const INITIAL_SCORE = 80
const DAILY_DECAY_SCORE = 1
const MAX_LOG_COUNT = 50
const TASK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const QUADRANT_SCORE_MAP: Record<QuadrantId, number> = {
  'do-now': 4,
  schedule: 3,
  quick: 2,
  avoid: 1,
}

const MEDAL_LEVELS = [
  {
    minScore: 120,
    name: '钻石冠勋章',
    shortName: '钻石冠',
    description: '长期稳定守约，已经形成很强的任务节奏。',
  },
  {
    minScore: 100,
    name: '金星勋章',
    shortName: '金星',
    description: '执行状态很好，继续保持重要任务优先。',
  },
  {
    minScore: 80,
    name: '银叶勋章',
    shortName: '银叶',
    description: '守约状态稳定，适合继续积累连续完成感。',
  },
  {
    minScore: 60,
    name: '铜芽勋章',
    shortName: '铜芽',
    description: '正在建立节奏，优先完成一件重要任务。',
  },
  {
    minScore: 0,
    name: '守约提醒',
    shortName: '提醒',
    description: '近期违约偏多，先把今天的任务减到可完成。',
  },
]

/**
 * 读取本地积分状态。
 * 旧用户没有积分 storage 时会从 80 分初始化，不会影响任务 storage 的兼容迁移。
 */
export function loadScoreState(): ScoreState {
  const todayDate = formatTaskDate()
  const storedState = wx.getStorageSync(SCORE_STORAGE_KEY) as unknown

  if (!storedState || typeof storedState !== 'object') {
    return createInitialScoreState(todayDate)
  }

  const rawState = storedState as Partial<ScoreState>
  const startedAt = typeof rawState.startedAt === 'number' ? rawState.startedAt : Date.now()
  const score = typeof rawState.score === 'number' ? Math.max(0, rawState.score) : INITIAL_SCORE
  const lastSettledDate = isScoreDate(rawState.lastSettledDate) ? rawState.lastSettledDate : todayDate
  const logs = Array.isArray(rawState.logs) ? normalizeScoreLogs(rawState.logs) : []

  return {
    score,
    startedAt,
    lastSettledDate,
    logs: logs.slice(0, MAX_LOG_COUNT),
  }
}

/**
 * 首页首次加载时调用。
 * 结算包含每日基础扣分，以及昨天及更早未完成任务的违约扣分。
 */
export function settleScoreWithTasks(tasks: TodoTask[], todayDate = formatTaskDate()): ScoreState {
  const safeTodayDate = isScoreDate(todayDate) ? todayDate : formatTaskDate()
  const now = Date.now()
  const state = loadScoreState()
  let nextState = state
  let hasTaskPenaltyUpdate = false
  const nextTasks = tasks.map((task) => ({ ...task }))

  getDatesAfterUntil(state.lastSettledDate, safeTodayDate).forEach((date) => {
    nextState = applyScoreChange(nextState, {
      type: 'daily_decay',
      scoreDelta: -DAILY_DECAY_SCORE,
      date,
      createdAt: now,
      reason: '每日基础扣分',
    })
  })

  nextTasks.forEach((task) => {
    if (task.completed || task.scorePenalizedAt || task.taskDate >= safeTodayDate) {
      return
    }

    const penalty = getQuadrantScore(task.quadrant)
    task.scorePenalizedAt = now
    hasTaskPenaltyUpdate = true
    nextState = applyScoreChange(nextState, {
      type: 'task_penalty',
      scoreDelta: -penalty,
      taskId: task.id,
      taskTitle: task.title,
      quadrant: task.quadrant,
      date: safeTodayDate,
      createdAt: now,
      reason: `逾期未完成扣 ${penalty} 分`,
    })
  })

  nextState = {
    ...nextState,
    lastSettledDate: safeTodayDate,
  }

  if (!isSameScoreState(state, nextState)) {
    saveScoreState(nextState)
  }

  if (hasTaskPenaltyUpdate) {
    saveAllTodoTasksAfterScoreSettlement(nextTasks)
  }

  return nextState
}

/**
 * 任务首次完成时奖励积分。
 * 页面层负责把 scoreRewardedAt 写回任务，服务层只处理积分流水和总分。
 */
export function rewardTaskCompletion(task: TodoTask): ScoreState {
  if (task.scoreRewardedAt) {
    return loadScoreState()
  }

  const reward = getQuadrantScore(task.quadrant)

  return applyAndSaveScoreChange({
    type: 'task_reward',
    scoreDelta: reward,
    taskId: task.id,
    taskTitle: task.title,
    quadrant: task.quadrant,
    date: formatTaskDate(),
    createdAt: Date.now(),
    reason: `完成任务加 ${reward} 分`,
  })
}

export function loadScoreSummary(): ScoreSummary {
  const state = loadScoreState()
  const todayDate = formatTaskDate()
  const todayLogs = state.logs.filter((log) => log.date === todayDate)
  const todayDecay = sumAbs(todayLogs, 'daily_decay')
  const todayReward = sumPositive(todayLogs, 'task_reward')
  const todayPenalty = sumAbs(todayLogs, 'task_penalty')
  const todayNet = todayLogs.reduce((total, log) => total + log.scoreDelta, 0)

  return {
    score: state.score,
    medal: getMedalByScore(state.score),
    todayDecay,
    todayReward,
    todayPenalty,
    todayNet,
    recentLogs: state.logs.slice(0, 8),
  }
}

export function getMedalByScore(score: number): MedalInfo {
  const safeScore = Math.max(0, Math.floor(score || 0))
  const currentLevel = MEDAL_LEVELS.find((level) => safeScore >= level.minScore) || MEDAL_LEVELS[MEDAL_LEVELS.length - 1]
  const orderedAscending = MEDAL_LEVELS.slice().reverse()
  const nextLevel = orderedAscending.find((level) => level.minScore > safeScore)

  return {
    ...currentLevel,
    nextName: nextLevel ? nextLevel.shortName : '已达最高等级',
    nextScore: nextLevel ? nextLevel.minScore : currentLevel.minScore,
    nextGap: nextLevel ? Math.max(nextLevel.minScore - safeScore, 0) : 0,
  }
}

export function getQuadrantScore(quadrant: QuadrantId): number {
  return QUADRANT_SCORE_MAP[quadrant] || 1
}

export function clearScoreState(): void {
  wx.removeStorageSync(SCORE_STORAGE_KEY)
  scheduleUserDataCloudSync()
}

function createInitialScoreState(todayDate: string): ScoreState {
  const now = Date.now()

  return {
    score: INITIAL_SCORE,
    startedAt: now,
    lastSettledDate: todayDate,
    logs: [],
  }
}

function applyAndSaveScoreChange(logInput: Omit<ScoreLog, 'id' | 'scoreAfter'>): ScoreState {
  const state = applyScoreChange(loadScoreState(), logInput)

  saveScoreState(state)
  return state
}

function applyScoreChange(state: ScoreState, logInput: Omit<ScoreLog, 'id' | 'scoreAfter'>): ScoreState {
  const nextScore = Math.max(0, state.score + logInput.scoreDelta)
  const log: ScoreLog = {
    id: createScoreLogId(logInput.createdAt),
    ...logInput,
    scoreAfter: nextScore,
  }

  return {
    ...state,
    score: nextScore,
    logs: [log].concat(state.logs).slice(0, MAX_LOG_COUNT),
  }
}

function saveScoreState(state: ScoreState): void {
  wx.setStorageSync(SCORE_STORAGE_KEY, {
    ...state,
    score: Math.max(0, state.score),
    logs: state.logs.slice(0, MAX_LOG_COUNT),
  })
  scheduleUserDataCloudSync()
}

function normalizeScoreLogs(rawLogs: unknown[]): ScoreLog[] {
  return rawLogs
    .map((rawLog) => normalizeScoreLog(rawLog))
    .filter((log): log is ScoreLog => Boolean(log))
    .sort((first, second) => second.createdAt - first.createdAt)
}

function normalizeScoreLog(rawLog: unknown): ScoreLog | null {
  if (!rawLog || typeof rawLog !== 'object') {
    return null
  }

  const log = rawLog as Partial<ScoreLog>
  const createdAt = typeof log.createdAt === 'number' ? log.createdAt : Date.now()
  const date = isScoreDate(log.date) ? log.date : formatTaskDate(new Date(createdAt))
  const type = isScoreLogType(log.type) ? log.type : undefined

  if (!type || typeof log.scoreDelta !== 'number' || typeof log.scoreAfter !== 'number') {
    return null
  }

  return {
    id: typeof log.id === 'string' && log.id ? log.id : createScoreLogId(createdAt),
    type,
    scoreDelta: log.scoreDelta,
    scoreAfter: Math.max(0, log.scoreAfter),
    taskId: typeof log.taskId === 'string' ? log.taskId : undefined,
    taskTitle: typeof log.taskTitle === 'string' ? log.taskTitle : undefined,
    quadrant: log.quadrant,
    date,
    createdAt,
    reason: typeof log.reason === 'string' ? log.reason : '',
  }
}

function getDatesAfterUntil(startDate: string, endDate: string): string[] {
  if (!isScoreDate(startDate) || !isScoreDate(endDate) || startDate >= endDate) {
    return []
  }

  const dates: string[] = []
  const cursor = parseScoreDate(startDate)
  const end = parseScoreDate(endDate)

  if (!cursor || !end) {
    return []
  }

  cursor.setDate(cursor.getDate() + 1)

  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatTaskDate(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

function parseScoreDate(date: string): Date | null {
  if (!isScoreDate(date)) {
    return null
  }

  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function isScoreDate(value: unknown): value is string {
  return typeof value === 'string' && TASK_DATE_PATTERN.test(value)
}

function isScoreLogType(value: unknown): value is ScoreLogType {
  return value === 'daily_decay' || value === 'task_reward' || value === 'task_penalty'
}

function sumAbs(logs: ScoreLog[], type: ScoreLogType): number {
  return logs
    .filter((log) => log.type === type)
    .reduce((total, log) => total + Math.abs(log.scoreDelta), 0)
}

function sumPositive(logs: ScoreLog[], type: ScoreLogType): number {
  return logs
    .filter((log) => log.type === type && log.scoreDelta > 0)
    .reduce((total, log) => total + log.scoreDelta, 0)
}

function createScoreLogId(timestamp: number): string {
  const randomPart = Math.floor(Math.random() * 100000).toString(36)
  return `score_${timestamp}_${randomPart}`
}

function isSameScoreState(first: ScoreState, second: ScoreState): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}
