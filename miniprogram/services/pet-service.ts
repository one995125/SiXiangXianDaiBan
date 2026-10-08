import { isUserDataCloudSyncReady, scheduleUserDataCloudSync } from './cloud-sync-service'
import { QuadrantId, TodoTask, formatTaskDate } from './todo-service'

export type PetId = 'xiaoye' | 'xingxing' | 'tuantuan'
export type CollectionCardType = 'pet' | 'achievement' | 'appearance' | 'protection'

export interface PetDefinition {
  id: PetId
  name: string
  personality: string
}

export interface CollectionCardDefinition {
  id: string
  name: string
  type: CollectionCardType
  petId: PetId
  description: string
}

export interface CollectionCardItem {
  cardId: string
  count: number
  star: number
  unlockedAt: number
}

export interface PetState {
  activePetId: PetId
  exp: number
  energy: number
  dailyEnergyDate: string
  dailyEnergy: number
  startedAt: number
  dailyExploreDate: string
  dailyExploreCount: number
  cards: CollectionCardItem[]
}

export interface PetSummary {
  activePet: PetDefinition
  level: number
  exp: number
  currentLevelExp: number
  nextLevelExp: number
  levelProgress: number
  energy: number
  todayEnergy: number
  avatar: string
  stateText: string
}

export interface CollectionCardView extends CollectionCardDefinition {
  count: number
  star: number
  unlocked: boolean
  avatar: string
  statusText: string
}

export interface ExploreResult {
  ok: boolean
  message: string
  card?: CollectionCardView
  summary: PetSummary
}

export interface MergeResult {
  ok: boolean
  message: string
  card?: CollectionCardView
}

const PET_STORAGE_KEY = 'sixiang_pet_state_v1'
const EXP_LEVELS = [0, 60, 160]
const EXPLORE_COST = 20
const DAILY_EXPLORE_LIMIT = 3

const QUADRANT_PET_REWARD_MAP: Record<QuadrantId, number> = {
  'do-now': 8,
  schedule: 6,
  quick: 4,
  avoid: 2,
}

export const PET_DEFINITIONS: PetDefinition[] = [
  { id: 'xiaoye', name: '小叶', personality: '温柔陪伴型' },
  { id: 'xingxing', name: '星星', personality: '目标行动型' },
  { id: 'tuantuan', name: '团团', personality: '轻松可爱型' },
]

export const COLLECTION_CARDS: CollectionCardDefinition[] = [
  { id: 'xiaoye', name: '小叶', type: 'pet', petId: 'xiaoye', description: '默认陪你守约的小伙伴' },
  { id: 'xingxing', name: '星星', type: 'pet', petId: 'xingxing', description: '适合目标感更强的日子' },
  { id: 'tuantuan', name: '团团', type: 'pet', petId: 'tuantuan', description: '轻松陪伴型小伙伴' },
  { id: 'first-promise', name: '首次守约', type: 'achievement', petId: 'xiaoye', description: '完成第一件任务后获得' },
  { id: 'seven-days', name: '连续 7 天', type: 'achievement', petId: 'xingxing', description: '连续守约的长期目标' },
  { id: 'important-task', name: '重要任务', type: 'achievement', petId: 'tuantuan', description: '持续完成重要任务' },
  { id: 'green-scarf', name: '绿围巾', type: 'appearance', petId: 'xiaoye', description: '给小伙伴换上温柔围巾' },
  { id: 'silver-leaf', name: '银叶徽章', type: 'appearance', petId: 'xingxing', description: '守约积分稳定的纪念' },
  { id: 'promise-shield', name: '守约保护', type: 'protection', petId: 'tuantuan', description: '只保护连续守约，不抵消逾期扣分' },
]

/**
 * 读取宠物本地状态。
 * 旧用户没有宠物 storage 时会自动初始化，不影响任务和积分数据。
 */
export function loadPetState(): PetState {
  const todayDate = formatTaskDate()
  const rawState = wx.getStorageSync(PET_STORAGE_KEY) as unknown

  if (!rawState || typeof rawState !== 'object') {
    return createInitialPetState(todayDate)
  }

  const state = rawState as Partial<PetState>
  return normalizePetState(state, todayDate)
}

export function loadPetSummary(): PetSummary {
  return buildPetSummary(loadPetState())
}

/**
 * 任务首次完成时调用。
 * 页面层负责把 task.petRewardedAt 写回任务，服务层负责宠物经验、能量和图鉴进度。
 */
export function rewardPetByTaskCompletion(task: TodoTask): PetState {
  if (task.petRewardedAt) {
    return loadPetState()
  }

  const reward = getPetRewardByQuadrant(task.quadrant)
  const state = loadPetState()
  const nextState = {
    ...state,
    exp: state.exp + reward,
    energy: state.energy + reward,
    dailyEnergy: state.dailyEnergy + reward,
    cards: upsertCard(upsertCard(state.cards, 'first-promise'), task.quadrant === 'schedule' ? 'important-task' : ''),
  }

  savePetState(nextState)
  return nextState
}

/**
 * 给宠物增加通用奖励。
 *
 * 调用时机：任务以外的正向行为完成后，例如步数达标、自定义运动。
 * 注意：是否允许重复领取由调用方控制，本函数只负责增加经验、能量和当日能量。
 */
export function addPetReward(reward: number): PetState {
  const safeReward = Math.max(0, Math.floor(reward))
  const state = loadPetState()

  if (!safeReward) {
    return state
  }

  const nextState = {
    ...state,
    exp: state.exp + safeReward,
    energy: state.energy + safeReward,
    dailyEnergy: state.dailyEnergy + safeReward,
  }

  savePetState(nextState)
  return nextState
}

export function exploreCollection(): ExploreResult {
  const state = resetDailyExploreIfNeeded(loadPetState())

  if (state.dailyExploreCount >= DAILY_EXPLORE_LIMIT) {
    return {
      ok: false,
      message: '今日探索次数已用完',
      summary: buildPetSummary(state),
    }
  }

  if (state.energy < EXPLORE_COST) {
    return {
      ok: false,
      message: '守约能量不足',
      summary: buildPetSummary(state),
    }
  }

  const card = pickExploreCard(state.dailyExploreCount)
  const nextState = {
    ...state,
    energy: state.energy - EXPLORE_COST,
    dailyExploreCount: state.dailyExploreCount + 1,
    cards: upsertCard(state.cards, card.id),
  }

  savePetState(nextState)
  return {
    ok: true,
    message: `获得${card.name}`,
    card: buildCollectionCardView(card, nextState.cards),
    summary: buildPetSummary(nextState),
  }
}

export function mergeCollectionCard(cardId: string): MergeResult {
  const state = loadPetState()
  const card = COLLECTION_CARDS.find((item) => item.id === cardId)
  const item = state.cards.find((entry) => entry.cardId === cardId)

  if (!card || !item) {
    return { ok: false, message: '卡片尚未解锁' }
  }

  if (item.star >= 3) {
    return { ok: false, message: '已经是最高星级' }
  }

  if (item.count < 3) {
    return { ok: false, message: '需要 3 张相同卡片' }
  }

  const nextCards = state.cards.map((entry) =>
    entry.cardId === cardId
      ? {
          ...entry,
          count: entry.count - 3,
          star: entry.star + 1,
        }
      : entry,
  )
  const nextState = {
    ...state,
    cards: nextCards,
  }

  savePetState(nextState)
  return {
    ok: true,
    message: `${card.name} 已升到 ${item.star + 1} 星`,
    card: buildCollectionCardView(card, nextCards),
  }
}

export function loadCollectionCards(type?: CollectionCardType): CollectionCardView[] {
  const cards = loadPetState().cards
  const definitions = type ? COLLECTION_CARDS.filter((card) => card.type === type) : COLLECTION_CARDS

  return definitions.map((card) => buildCollectionCardView(card, cards))
}

export function loadMergeableCards(): CollectionCardView[] {
  return loadCollectionCards().filter((card) => card.unlocked)
}

export function clearPetState(): void {
  wx.removeStorageSync(PET_STORAGE_KEY)
  scheduleUserDataCloudSync()
}

export function getPetAvatar(petId: PetId, level: number): string {
  const safeLevel = Math.max(1, Math.min(level, 3))
  return `/assets/images/pets/${petId}-lv${safeLevel}.png`
}

export function getPetRewardByQuadrant(quadrant: QuadrantId): number {
  return QUADRANT_PET_REWARD_MAP[quadrant] || 2
}

function createInitialPetState(todayDate: string): PetState {
  const now = Date.now()

  return {
    activePetId: 'xiaoye',
    exp: 0,
    energy: 0,
    dailyEnergyDate: todayDate,
    dailyEnergy: 0,
    startedAt: now,
    dailyExploreDate: todayDate,
    dailyExploreCount: 0,
    cards: [
      { cardId: 'xiaoye', count: 1, star: 1, unlockedAt: now },
      { cardId: 'silver-leaf', count: 1, star: 1, unlockedAt: now },
    ],
  }
}

function normalizePetState(state: Partial<PetState>, todayDate: string): PetState {
  const activePetId = isPetId(state.activePetId) ? state.activePetId : 'xiaoye'
  const normalizedState = {
    activePetId,
    exp: typeof state.exp === 'number' ? Math.max(0, Math.floor(state.exp)) : 0,
    energy: typeof state.energy === 'number' ? Math.max(0, Math.floor(state.energy)) : 0,
    dailyEnergyDate: typeof state.dailyEnergyDate === 'string' ? state.dailyEnergyDate : todayDate,
    dailyEnergy: typeof state.dailyEnergy === 'number' ? Math.max(0, Math.floor(state.dailyEnergy)) : 0,
    startedAt: typeof state.startedAt === 'number' ? state.startedAt : Date.now(),
    dailyExploreDate: typeof state.dailyExploreDate === 'string' ? state.dailyExploreDate : todayDate,
    dailyExploreCount: typeof state.dailyExploreCount === 'number' ? Math.max(0, Math.floor(state.dailyExploreCount)) : 0,
    cards: normalizeCards(state.cards),
  }

  return resetDailyExploreIfNeeded(normalizedState)
}

function normalizeCards(cards: unknown): CollectionCardItem[] {
  if (!Array.isArray(cards)) {
    return createInitialPetState(formatTaskDate()).cards
  }

  return cards
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const card = item as Partial<CollectionCardItem>
      if (!COLLECTION_CARDS.some((definition) => definition.id === card.cardId)) {
        return null
      }

      return {
        cardId: card.cardId || '',
        count: typeof card.count === 'number' ? Math.max(0, Math.floor(card.count)) : 1,
        star: typeof card.star === 'number' ? Math.max(1, Math.min(3, Math.floor(card.star))) : 1,
        unlockedAt: typeof card.unlockedAt === 'number' ? card.unlockedAt : Date.now(),
      }
    })
    .filter((item): item is CollectionCardItem => Boolean(item))
}

function resetDailyExploreIfNeeded(state: PetState): PetState {
  const todayDate = formatTaskDate()

  if (state.dailyExploreDate === todayDate) {
    if (state.dailyEnergyDate === todayDate) {
      return state
    }

    const nextState = {
      ...state,
      dailyEnergyDate: todayDate,
      dailyEnergy: 0,
    }

    if (isUserDataCloudSyncReady()) {
      savePetState(nextState)
    }
    return nextState
  }

  const nextState = {
    ...state,
    dailyEnergyDate: todayDate,
    dailyEnergy: 0,
    dailyExploreDate: todayDate,
    dailyExploreCount: 0,
  }

  if (isUserDataCloudSyncReady()) {
    savePetState(nextState)
  }
  return nextState
}

function buildPetSummary(state: PetState): PetSummary {
  const activePet = PET_DEFINITIONS.find((pet) => pet.id === state.activePetId) || PET_DEFINITIONS[0]
  const level = getPetLevel(state.exp)
  const currentLevelExp = EXP_LEVELS[level - 1] || 0
  const nextLevelExp = EXP_LEVELS[level] || EXP_LEVELS[EXP_LEVELS.length - 1]
  const levelRange = Math.max(nextLevelExp - currentLevelExp, 1)
  const levelProgress = level >= 3 ? 100 : Math.min(100, Math.round(((state.exp - currentLevelExp) / levelRange) * 100))

  return {
    activePet,
    level,
    exp: state.exp,
    currentLevelExp,
    nextLevelExp,
    levelProgress,
    energy: state.energy,
    todayEnergy: state.dailyEnergy,
    avatar: getPetAvatar(activePet.id, level),
    stateText: `${activePet.name} Lv.${level} · 今日 +${state.dailyEnergy} 能量`,
  }
}

function buildCollectionCardView(card: CollectionCardDefinition, cards: CollectionCardItem[]): CollectionCardView {
  const item = cards.find((entry) => entry.cardId === card.id)
  const star = item ? item.star : 1

  return {
    ...card,
    count: item ? item.count : 0,
    star,
    unlocked: Boolean(item),
    avatar: getPetAvatar(card.petId, star),
    statusText: item ? `${item.count} 张 · ${item.star} 星` : '未解锁',
  }
}

function upsertCard(cards: CollectionCardItem[], cardId: string): CollectionCardItem[] {
  if (!cardId) {
    return cards
  }

  const current = cards.find((item) => item.cardId === cardId)

  if (!current) {
    return cards.concat({ cardId, count: 1, star: 1, unlockedAt: Date.now() })
  }

  return cards.map((item) => (item.cardId === cardId ? { ...item, count: item.count + 1 } : item))
}

function pickExploreCard(countBeforeExplore: number): CollectionCardDefinition {
  const sequence = ['xingxing', 'tuantuan', 'green-scarf', 'promise-shield', 'seven-days']
  const cardId = sequence[countBeforeExplore % sequence.length]

  return COLLECTION_CARDS.find((card) => card.id === cardId) || COLLECTION_CARDS[0]
}

function savePetState(state: PetState): void {
  wx.setStorageSync(PET_STORAGE_KEY, {
    ...state,
    exp: Math.max(0, Math.floor(state.exp)),
    energy: Math.max(0, Math.floor(state.energy)),
    dailyEnergy: Math.max(0, Math.floor(state.dailyEnergy)),
    cards: state.cards.filter((card) => card.count > 0 || card.star > 1),
  })
  scheduleUserDataCloudSync()
}

function getPetLevel(exp: number): number {
  if (exp >= EXP_LEVELS[2]) {
    return 3
  }

  if (exp >= EXP_LEVELS[1]) {
    return 2
  }

  return 1
}

function isPetId(value: unknown): value is PetId {
  return value === 'xiaoye' || value === 'xingxing' || value === 'tuantuan'
}
