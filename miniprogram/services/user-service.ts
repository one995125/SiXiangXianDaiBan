import { callCloudFunction } from './cloud-service'

/**
 * 微信登录本地状态服务。
 *
 * 注意：wx.login 只能在前端拿到临时 code，不能直接得到 openid。
 * 生产环境需要把 code 发到云函数或后端换取 openid/session_key，并按 openid 做用户数据隔离。
 */
export interface UserLoginState {
  hasLogin: boolean
  code: string
  codeUpdatedAt: number
  backendLinked: boolean
  openid?: string
  appid?: string
  unionid?: string
  lastLoginError?: string
}

interface LoginCloudResult {
  success: boolean
  openid: string
  appid: string
  unionid: string
  env: string
  serverTime: number
}

const USER_SESSION_STORAGE_KEY = 'sixiang_user_session_v1'

function createEmptyLoginState(lastLoginError = ''): UserLoginState {
  return {
    hasLogin: false,
    code: '',
    codeUpdatedAt: 0,
    backendLinked: false,
    lastLoginError,
  }
}

export function loadUserLoginState(): UserLoginState {
  const storedState = wx.getStorageSync(USER_SESSION_STORAGE_KEY) as unknown

  if (!storedState || typeof storedState !== 'object') {
    return createEmptyLoginState()
  }

  const rawState = storedState as Partial<UserLoginState>

  return {
    hasLogin: Boolean(rawState.hasLogin && rawState.code),
    code: typeof rawState.code === 'string' ? rawState.code : '',
    codeUpdatedAt: typeof rawState.codeUpdatedAt === 'number' ? rawState.codeUpdatedAt : 0,
    backendLinked: Boolean(rawState.backendLinked),
    openid: typeof rawState.openid === 'string' ? rawState.openid : undefined,
    appid: typeof rawState.appid === 'string' ? rawState.appid : undefined,
    unionid: typeof rawState.unionid === 'string' ? rawState.unionid : undefined,
    lastLoginError: typeof rawState.lastLoginError === 'string' ? rawState.lastLoginError : '',
  }
}

export function saveUserLoginState(state: UserLoginState): UserLoginState {
  wx.setStorageSync(USER_SESSION_STORAGE_KEY, state)
  return state
}

export function loginWithWechat(): Promise<UserLoginState> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (result) => {
        if (!result.code) {
          const failedState = saveUserLoginState(createEmptyLoginState('微信登录未返回 code'))
          reject(failedState)
          return
        }

        const localLoginState: UserLoginState = {
          hasLogin: true,
          code: result.code,
          codeUpdatedAt: Date.now(),
          backendLinked: false,
          lastLoginError: '',
        }

        try {
          const cloudResult = await callCloudFunction<LoginCloudResult>('sixiangLogin', {
            code: result.code,
          })

          const nextState: UserLoginState = {
            ...localLoginState,
            backendLinked: Boolean(cloudResult && cloudResult.success && cloudResult.openid),
            openid: cloudResult && cloudResult.openid ? cloudResult.openid : undefined,
            appid: cloudResult && cloudResult.appid ? cloudResult.appid : undefined,
            unionid: cloudResult && cloudResult.unionid ? cloudResult.unionid : undefined,
          }

          resolve(saveUserLoginState(nextState))
        } catch (error) {
          console.warn('登录云函数调用失败，已降级为本地登录状态', error)
          resolve(
            saveUserLoginState({
              ...localLoginState,
              lastLoginError: '已完成微信登录，云函数登录待重试',
            }),
          )
        }
      },
      fail: (error) => {
        const failedState = saveUserLoginState(createEmptyLoginState('微信登录失败'))
        console.error('微信登录失败', error)
        reject(failedState)
      },
    })
  })
}

export function clearUserLoginState() {
  wx.removeStorageSync(USER_SESSION_STORAGE_KEY)
}
