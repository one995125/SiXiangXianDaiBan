import { callCloudFunction } from './cloud-service'
import { scheduleUserDataCloudSync } from './cloud-sync-service'
import { formatTaskDate } from './todo-service'

/**
 * 微信运动同步状态。
 *
 * encryptedData/iv 需要配合 wx.login 换得的 session_key 在服务端解密。
 * 当前本地优先版本只保存授权和同步状态，不在前端伪造真实步数。
 */
export interface WeRunState {
  authorized: boolean
  synced: boolean
  encryptedData: string
  iv: string
  cloudID: string
  syncedAt: number
  syncDate: string
  stepCount: number
  stepText: string
  targetSteps: number
  reachedTarget: boolean
  statusText: string
  lastError: string
}

interface DecryptWeRunCloudResult {
  success: boolean
  code?: string
  message?: string
  todayDate: string
  stepCount: number
  targetSteps: number
  reachedTarget: boolean
  serverTime: number
}

export interface WeRunSyncError {
  code: 'AUTH_DENIED' | 'SYNC_FAILED'
  message: string
}

const WERUN_STORAGE_KEY = 'sixiang_werun_state_v1'
const STEP_TARGET = 6000

function createInitialWeRunState(overrides: Partial<WeRunState> = {}): WeRunState {
  const state: WeRunState = {
    authorized: false,
    synced: false,
    encryptedData: '',
    iv: '',
    cloudID: '',
    syncedAt: 0,
    syncDate: '',
    stepCount: 0,
    stepText: '待同步',
    targetSteps: STEP_TARGET,
    reachedTarget: false,
    statusText: '点击同步微信步数',
    lastError: '',
    ...overrides,
  }

  if (state.stepCount > 0) {
    state.stepText = `${state.stepCount} 步`
    state.reachedTarget = state.stepCount >= state.targetSteps
  }

  return state
}

export function loadWeRunState(): WeRunState {
  const storedState = wx.getStorageSync(WERUN_STORAGE_KEY) as unknown

  if (!storedState || typeof storedState !== 'object') {
    return createInitialWeRunState()
  }

  const rawState = storedState as Partial<WeRunState>

  return createInitialWeRunState({
    authorized: Boolean(rawState.authorized),
    synced: Boolean(rawState.synced),
    encryptedData: typeof rawState.encryptedData === 'string' ? rawState.encryptedData : '',
    iv: typeof rawState.iv === 'string' ? rawState.iv : '',
    cloudID: typeof rawState.cloudID === 'string' ? rawState.cloudID : '',
    syncedAt: typeof rawState.syncedAt === 'number' ? rawState.syncedAt : 0,
    syncDate: typeof rawState.syncDate === 'string' ? rawState.syncDate : '',
    stepCount: typeof rawState.stepCount === 'number' ? rawState.stepCount : 0,
    targetSteps: typeof rawState.targetSteps === 'number' ? rawState.targetSteps : STEP_TARGET,
    statusText: typeof rawState.statusText === 'string' ? rawState.statusText : '点击同步微信步数',
    lastError: typeof rawState.lastError === 'string' ? rawState.lastError : '',
  })
}

function saveWeRunState(state: WeRunState): WeRunState {
  wx.setStorageSync(WERUN_STORAGE_KEY, state)
  scheduleUserDataCloudSync()
  return state
}

function getWeRunSetting(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.getSetting({
      success: (result) => {
        resolve(Boolean(result.authSetting['scope.werun']))
      },
      fail: () => {
        resolve(false)
      },
    })
  })
}

function authorizeWeRun(): Promise<void> {
  return new Promise((resolve, reject: (error: WeRunSyncError) => void) => {
    wx.authorize({
      scope: 'scope.werun',
      success: () => resolve(),
      fail: () => {
        reject({
          code: 'AUTH_DENIED',
          message: '用户未授权微信运动步数',
        })
      },
    })
  })
}

function getEncryptedWeRunData(): Promise<WechatMiniprogram.GetWeRunDataSuccessCallbackResult> {
  return new Promise((resolve, reject: (error: WeRunSyncError) => void) => {
    wx.getWeRunData({
      success: resolve,
      fail: () => {
        reject({
          code: 'SYNC_FAILED',
          message: '同步微信运动数据失败',
        })
      },
    })
  })
}

export async function syncWeRunData(): Promise<WeRunState> {
  const hasAuthorized = await getWeRunSetting()

  if (!hasAuthorized) {
    await authorizeWeRun()
  }

  const result = await getEncryptedWeRunData()
  const now = Date.now()
  const cloudID = typeof (result as any).cloudID === 'string' ? (result as any).cloudID : ''
  const syncDate = formatTaskDate(new Date(now))
  const encryptedState = createInitialWeRunState({
    authorized: true,
    synced: true,
    encryptedData: result.encryptedData || '',
    iv: result.iv || '',
    cloudID,
    syncedAt: now,
    syncDate,
    stepCount: 0,
    stepText: '已同步',
    statusText: '已获取加密数据，待服务端解密步数',
    lastError: '',
  })

  if (!cloudID) {
    return saveWeRunState({
      ...encryptedState,
      lastError: '微信运动未返回 cloudID',
      statusText: '已同步加密数据，暂不能解密步数',
    })
  }

  try {
    const cloudResult = await callCloudFunction<DecryptWeRunCloudResult>('sixiangDecryptWeRunData', {
      cloudID,
      targetSteps: STEP_TARGET,
      todayDate: syncDate,
    })

    if (!cloudResult || !cloudResult.success) {
      return saveWeRunState({
        ...encryptedState,
        lastError: cloudResult && cloudResult.message ? cloudResult.message : '解密微信步数失败',
        statusText: '已同步加密数据，解密待重试',
      })
    }

    return saveWeRunState(
      createInitialWeRunState({
        ...encryptedState,
        stepCount: cloudResult.stepCount,
        stepText: `${cloudResult.stepCount} 步`,
        targetSteps: cloudResult.targetSteps,
        reachedTarget: cloudResult.reachedTarget,
        statusText: cloudResult.reachedTarget
          ? `今日已达成 ${cloudResult.targetSteps} 步`
          : `还差 ${Math.max(cloudResult.targetSteps - cloudResult.stepCount, 0)} 步达标`,
      }),
    )
  } catch (error) {
    console.warn('解密微信步数云函数调用失败，已保留加密同步状态', error)
    return saveWeRunState({
      ...encryptedState,
      lastError: '解密云函数调用失败',
      statusText: '已同步加密数据，解密待重试',
    })
  }
}

export function markWeRunAuthDenied(): WeRunState {
  return saveWeRunState(
    createInitialWeRunState({
      authorized: false,
      synced: false,
      lastError: '用户未授权微信运动步数',
      statusText: '需要授权后同步',
    }),
  )
}

export function clearWeRunState() {
  wx.removeStorageSync(WERUN_STORAGE_KEY)
  scheduleUserDataCloudSync()
}
