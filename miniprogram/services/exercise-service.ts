import { addPetReward } from './pet-service'
import { scheduleUserDataCloudSync } from './cloud-sync-service'
import { formatTaskDate } from './todo-service'
import { WeRunState } from './werun-service'

export type ExerciseType = 'steps' | 'pushup'

export interface ExerciseDefinition {
  id: ExerciseType
  title: string
  targetText: string
  reward: number
  desc: string
}

export interface ExerciseRewardRecord {
  id: ExerciseType
  rewardedAt: number
}

export interface ExerciseRewardState {
  date: string
  rewarded: ExerciseRewardRecord[]
}

export interface ExerciseView extends ExerciseDefinition {
  statusText: string
  actionText: string
  canClaim: boolean
  claimed: boolean
  disabled: boolean
}

export interface ExerciseClaimResult {
  ok: boolean
  message: string
  reward: number
  exercises: ExerciseView[]
}

const EXERCISE_STORAGE_KEY = 'sixiang_exercise_rewards_v1'

export const EXERCISE_DEFINITIONS: ExerciseDefinition[] = [
  {
    id: 'steps',
    title: '微信步数',
    targetText: '每日 6000 步',
    reward: 12,
    desc: '达标后给小伙伴能量，不达标不扣分',
  },
  {
    id: 'pushup',
    title: '俯卧撑',
    targetText: '完成 10 个',
    reward: 5,
    desc: '适合快速补一点运动量',
  },
]

/**
 * 读取当天运动奖励状态。
 * 新的一天会自动清空领取记录，避免跨天重复状态影响今日奖励。
 */
export function loadExerciseRewardState(todayDate = formatTaskDate()): ExerciseRewardState {
  const rawState = wx.getStorageSync(EXERCISE_STORAGE_KEY) as unknown

  if (!rawState || typeof rawState !== 'object') {
    return {
      date: todayDate,
      rewarded: [],
    }
  }

  const state = rawState as Partial<ExerciseRewardState>

  if (state.date !== todayDate) {
    return {
      date: todayDate,
      rewarded: [],
    }
  }

  return {
    date: todayDate,
    rewarded: Array.isArray(state.rewarded)
      ? state.rewarded.filter((item) => isExerciseType(item.id) && typeof item.rewardedAt === 'number')
      : [],
  }
}

export function loadExerciseViews(weRunState: WeRunState): ExerciseView[] {
  const rewardState = loadExerciseRewardState()

  return EXERCISE_DEFINITIONS.map((definition) => buildExerciseView(definition, rewardState, weRunState))
}

/**
 * 领取运动奖励。
 * 步数奖励必须先由微信运动同步确认达标；自定义运动由用户手动确认完成。
 */
export function claimExerciseReward(type: ExerciseType, weRunState: WeRunState): ExerciseClaimResult {
  const rewardState = loadExerciseRewardState()
  const definition = EXERCISE_DEFINITIONS.find((item) => item.id === type)

  if (!definition) {
    return {
      ok: false,
      message: '运动项目不存在',
      reward: 0,
      exercises: loadExerciseViews(weRunState),
    }
  }

  const view = buildExerciseView(definition, rewardState, weRunState)

  if (view.claimed) {
    return {
      ok: false,
      message: '今天已经领取过',
      reward: 0,
      exercises: loadExerciseViews(weRunState),
    }
  }

  if (!view.canClaim) {
    return {
      ok: false,
      message: type === 'steps' ? '步数达标后再领取' : '请先确认完成运动',
      reward: 0,
      exercises: loadExerciseViews(weRunState),
    }
  }

  addPetReward(definition.reward)

  const nextState = {
    ...rewardState,
    rewarded: [
      ...rewardState.rewarded,
      {
        id: type,
        rewardedAt: Date.now(),
      },
    ],
  }
  wx.setStorageSync(EXERCISE_STORAGE_KEY, nextState)
  scheduleUserDataCloudSync()

  return {
    ok: true,
    message: `已获得 +${definition.reward} 能量`,
    reward: definition.reward,
    exercises: loadExerciseViews(weRunState),
  }
}

export function clearExerciseRewardState() {
  wx.removeStorageSync(EXERCISE_STORAGE_KEY)
  scheduleUserDataCloudSync()
}

function buildExerciseView(
  definition: ExerciseDefinition,
  rewardState: ExerciseRewardState,
  weRunState: WeRunState,
): ExerciseView {
  const claimed = rewardState.rewarded.some((item) => item.id === definition.id)
  const stepsReady = definition.id === 'steps' ? weRunState.reachedTarget : true
  const canClaim = !claimed && stepsReady

  return {
    ...definition,
    claimed,
    canClaim,
    disabled: claimed || !stepsReady,
    statusText: buildExerciseStatusText(definition, weRunState, claimed),
    actionText: claimed ? '已领取' : canClaim ? `领取 +${definition.reward}` : definition.id === 'steps' ? '未达标' : '完成',
  }
}

function buildExerciseStatusText(definition: ExerciseDefinition, weRunState: WeRunState, claimed: boolean): string {
  if (claimed) {
    return '今天奖励已领取'
  }

  if (definition.id === 'steps') {
    if (!weRunState.synced) {
      return '先同步微信步数'
    }

    return weRunState.reachedTarget ? '已达标，可以领取' : '未达标也不扣分'
  }

  return '完成后手动领取'
}

function isExerciseType(value: unknown): value is ExerciseType {
  return value === 'steps' || value === 'pushup'
}
