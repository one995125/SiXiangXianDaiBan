export const CLOUD_ENV_ID = 'cloud1-d4gfatip0edd01506'

export interface CloudCallResult<T> {
  result?: T
}

/**
 * 初始化微信云开发。
 *
 * 调用时机：app.onLaunch 中最先执行。
 * 注意：基础库 2.21.0+ 支持 wx.cloud；如果开发者工具未开通云开发，这里只记录错误，不阻断本地任务功能。
 */
export function initCloudBase() {
  if (!(wx as any).cloud) {
    console.warn('当前基础库不支持 wx.cloud，云函数能力不可用')
    return
  }

  ;(wx as any).cloud.init({
    env: CLOUD_ENV_ID,
    traceUser: true,
  })
}

export function callCloudFunction<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!(wx as any).cloud) {
      const error = new Error('当前环境不支持 wx.cloud') as Error & { code?: string }
      error.code = 'CLOUD_UNAVAILABLE'
      reject(error)
      return
    }

    ;(wx as any).cloud.callFunction({
      name,
      data,
      config: {
        env: CLOUD_ENV_ID,
      },
      success: (result: CloudCallResult<T>) => {
        resolve(result.result as T)
      },
      fail: reject,
    })
  })
}
