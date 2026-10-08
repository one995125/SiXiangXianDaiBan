import { initCloudBase } from './services/cloud-service'
import { scheduleUserDataCloudSync, syncUserDataOnLaunch } from './services/cloud-sync-service'
import { ensureFirstUseMockData } from './services/onboarding-service'
import { UserLoginState, loginWithWechat } from './services/user-service'
import {
  captureGrowthBootstrapContext,
  ensureOfflineGrowthFallback,
} from './services/growth-service'
import { retryPendingWechatReminderRegistrations } from './services/reminder-service'

/**
 * 初始化示例数据。
 *
 * 调用时机：首轮云同步成功并确认当前 openid 的云端基线后。
 * 注意：示例只在没有任何业务数据且未初始化过时写入；写入后走统一云同步，
 * 用户删除示例记录后不会再次自动生成。拉云失败时禁止生成示例，避免新设备把示例/空快照覆盖到旧云数据。
 */
function ensureFirstUseMockDataReady() {
  if (!ensureFirstUseMockData()) {
    return
  }

  scheduleUserDataCloudSync()
  try {
    getCurrentPages().forEach((page) => {
      if (typeof (page as any).onCloudUserDataReady === 'function') {
        ;(page as any).onCloudUserDataReady()
      }
    })
  } catch (error) {
    console.warn('刷新示例数据失败', error)
  }
}

App<IAppOption>({
  globalData: {},

  onLaunch(options) {
    initCloudBase()

    // 必须在写入本次启动日志和生成示例数据之前判断，以免把全新用户误识别为老用户。
    const growthBootstrap = captureGrowthBootstrapContext(options && options.query)
    ensureOfflineGrowthFallback(growthBootstrap)

    // 保留 starter 日志，便于在微信开发者工具 Storage 面板确认小程序启动正常。
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 记得的用户数据仍按 openid 隔离：先登录拿到云端身份，再拉取/上传当前用户快照。
    // 云同步失败不会阻塞本地记录能力；后续保存记录会通过 dirtyAt 自动重试。
    loginWithWechat()
      .then((state) => {
        ;(this.globalData as any).userLoginState = state
      })
      .catch((state: UserLoginState) => {
        ;(this.globalData as any).userLoginState = state
      })
      .then(() => syncUserDataOnLaunch(growthBootstrap))
      .then(() => retryPendingWechatReminderRegistrations())
      .then(() => ensureFirstUseMockDataReady())
      .catch((error) => {
        console.warn('[sixiangSyncUserData] 启动云同步失败，继续使用本地缓存；为保护旧云数据，本次不生成或上传示例', error)
        ensureOfflineGrowthFallback(growthBootstrap)
      })
  },
})
