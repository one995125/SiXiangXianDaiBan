import { refreshContentTopPadding } from './safe-area'

export type LegacyRouteKey = 'index' | 'stats' | 'pet' | 'collection' | 'explore' | 'merge'

interface LegacyRouteFallback {
  title: string
  description: string
  primaryLabel: string
  primaryUrl: string
  secondaryLabel: string
  secondaryUrl: string
  detailLabel: string
  detailUrl: string
}

const LEGACY_ROUTE_FALLBACKS: Record<LegacyRouteKey, LegacyRouteFallback> = {
  index: {
    title: '旧首页已迁移',
    description: '原四象限首页已并入新版「今日」和「计划」。正在为你打开今日页。',
    primaryLabel: '去今日',
    primaryUrl: '/pages/today/today',
    secondaryLabel: '去计划',
    secondaryUrl: '/pages/checkins/checkins',
    detailLabel: '查看记录',
    detailUrl: '/pages/records/records',
  },
  stats: {
    title: '旧统计页已迁移',
    description: '原统计入口已拆到「记录」和「总览」。正在为你打开记录页。',
    primaryLabel: '去记录',
    primaryUrl: '/pages/records/records',
    secondaryLabel: '去总览',
    secondaryUrl: '/pages/calendar/calendar',
    detailLabel: '去我的',
    detailUrl: '/pages/mine/mine',
  },
  pet: {
    title: '小伙伴入口已下线',
    description: '旧宠物成长入口不再承载当前业务。计划、打卡和连续记录已迁移到「计划」。',
    primaryLabel: '去计划',
    primaryUrl: '/pages/checkins/checkins',
    secondaryLabel: '去今日',
    secondaryUrl: '/pages/today/today',
    detailLabel: '去我的',
    detailUrl: '/pages/mine/mine',
  },
  collection: {
    title: '旧图鉴已下线',
    description: '原图鉴卡片不再作为主流程入口。历史内容可在「记录」里查看，日期节点可在「总览」里查看。',
    primaryLabel: '去记录',
    primaryUrl: '/pages/records/records',
    secondaryLabel: '去总览',
    secondaryUrl: '/pages/calendar/calendar',
    detailLabel: '去我的',
    detailUrl: '/pages/mine/mine',
  },
  explore: {
    title: '旧探索已下线',
    description: '探索能量玩法已移出当前信息架构。继续记录和打卡请进入「今日」或「计划」。',
    primaryLabel: '去今日',
    primaryUrl: '/pages/today/today',
    secondaryLabel: '去计划',
    secondaryUrl: '/pages/checkins/checkins',
    detailLabel: '查看记录',
    detailUrl: '/pages/records/records',
  },
  merge: {
    title: '旧合成入口已下线',
    description: '卡片合成不再保留独立入口。当前版本以记录、计划和总览作为主要信息架构。',
    primaryLabel: '去记录',
    primaryUrl: '/pages/records/records',
    secondaryLabel: '去计划',
    secondaryUrl: '/pages/checkins/checkins',
    detailLabel: '去我的',
    detailUrl: '/pages/mine/mine',
  },
}

function openCurrentRoute(url: string): void {
  wx.redirectTo({
    url,
    fail: (redirectError) => {
      console.warn('[legacy-route] redirectTo 失败，尝试 reLaunch', url, redirectError)
      wx.reLaunch({
        url,
        fail: (reLaunchError) => {
          console.error('[legacy-route] reLaunch 失败', url, reLaunchError)
          wx.showToast({
            title: '跳转失败，请稍后重试',
            icon: 'none',
          })
        },
      })
    },
  })
}

function redirectLegacyRoute(
  routeKey: LegacyRouteKey,
  onFailed: (message: string) => void,
): void {
  const fallback = LEGACY_ROUTE_FALLBACKS[routeKey]

  wx.redirectTo({
    url: fallback.primaryUrl,
    fail: (redirectError) => {
      console.warn('[legacy-route] 自动迁移跳转失败，尝试重启到新入口', routeKey, redirectError)
      wx.reLaunch({
        url: fallback.primaryUrl,
        fail: (reLaunchError) => {
          console.error('[legacy-route] 自动迁移兜底失败', routeKey, reLaunchError)
          onFailed('自动跳转失败，请手动选择入口')
        },
      })
    },
  })
}

export function createLegacyRedirectPage(routeKey: LegacyRouteKey): void {
  const fallback = LEGACY_ROUTE_FALLBACKS[routeKey]

  Component({
    data: {
      contentTopPadding: 24,
      redirecting: true,
      fallback,
    },

    lifetimes: {
      attached() {
        this.initViewportPadding()
        this.redirectToCurrentRoute()
      },
    },

    methods: {
      /**
       * 旧入口也使用自定义导航样式，进入时先预留安全区。
       * 调用时机：页面 attached 后立即执行，失败时保持默认间距。
       */
      initViewportPadding() {
        refreshContentTopPadding(this)
      },

      /**
       * 自动把旧页面迁移到当前 IA 的主入口。
       * 注意：这里不再读取旧业务 storage，也不触发旧 pet/score/todo 流程。
       */
      redirectToCurrentRoute() {
        this.setData({ redirecting: true })
        redirectLegacyRoute(routeKey, (message) => {
          this.setData({ redirecting: false })
          wx.showToast({
            title: message,
            icon: 'none',
          })
        })
      },

      goPrimary() {
        openCurrentRoute(fallback.primaryUrl)
      },

      goSecondary() {
        openCurrentRoute(fallback.secondaryUrl)
      },

      goDetail() {
        openCurrentRoute(fallback.detailUrl)
      },
    },
  })
}
