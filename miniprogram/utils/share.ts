export type SharePageKey = 'today' | 'checkins' | 'records' | 'calendar' | 'mine'
export type ShareScene = 'default' | 'growth_companion' | 'plan_companion' | 'anniversary_companion'

interface SharePageConfig {
  title: string
  path: string
}

interface ShareMessageOverrides {
  title?: string
  imageUrl?: string
}

/** 统一的5:4微信分享卡片封面；压缩后约95KB，避免明显增加小程序包体。 */
export const APP_SHARE_IMAGE_URL = '/assets/images/brand/share-card-productivity-desk.jpg'

const SHARE_PAGE_CONFIGS: Record<SharePageKey, SharePageConfig> = {
  today: {
    title: '四象限待办清单',
    path: '/pages/today/today',
  },
  checkins: {
    title: '把计划拆成每天的小进度',
    path: '/pages/checkins/checkins',
  },
  records: {
    title: '记录待办、纪念日、效期和心情',
    path: '/pages/records/records',
  },
  calendar: {
    title: '打开总览，看清记录、计划和节点',
    path: '/pages/calendar/calendar',
  },
  mine: {
    title: '四象限待办清单',
    path: '/pages/today/today',
  },
}

/**
 * 情境化分享仅配置通用标题和静态落地页，不接收记录 id、标题或日期等私人内容。
 * growth_companion 的动态进度标题由计划页通过 overrides 覆盖。
 */
const SHARE_SCENE_CONFIGS: Record<Exclude<ShareScene, 'default'>, SharePageConfig> = {
  growth_companion: {
    title: '一起开始七日成长',
    path: '/pages/checkins/checkins?from=growth_share',
  },
  plan_companion: {
    title: '一起把计划，慢慢变成生活',
    path: '/pages/checkins/checkins?from=plan_companion',
  },
  anniversary_companion: {
    title: '和TA一起记录美好发生',
    path: '/pages/records/records?type=anniversary&from=anniversary_share',
  },
}

function resolveShareConfig(pageKey: SharePageKey, scene: ShareScene): SharePageConfig {
  if (scene !== 'default') {
    return SHARE_SCENE_CONFIGS[scene]
  }

  const config = SHARE_PAGE_CONFIGS[pageKey] || SHARE_PAGE_CONFIGS.today
  return {
    ...config,
    path: `${config.path}?from=share`,
  }
}

/**
 * 开启右上角胶囊菜单里的“转发给朋友”和“分享到朋友圈”。
 *
 * 调用时机：主页面 attached/onLoad 时执行一次。
 * 注意事项：这里只开启微信官方分享入口，不做强制分享、分享解锁或诱导分享。
 */
export function enableAppShareMenu(): void {
  if (typeof wx.showShareMenu !== 'function') {
    return
  }

  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'] as any,
    })
  } catch (error) {
    console.warn('[share] showShareMenu failed', error)
  }
}

/**
 * 生成“转发给朋友”的分享参数。
 *
 * 参数 pageKey：当前页面标识，用来选择标题和落地页。
 * 注意事项：不拼接用户记录 id、openid 等个人数据，避免把本机私有记录暴露给接收方。
 */
export function buildShareAppMessage(
  pageKey: SharePageKey = 'today',
  scene: ShareScene = 'default',
  overrides: ShareMessageOverrides = {},
) {
  const config = resolveShareConfig(pageKey, scene)

  return {
    title: overrides.title || config.title,
    path: config.path,
    imageUrl: overrides.imageUrl || APP_SHARE_IMAGE_URL,
  }
}

/**
 * 生成“分享到朋友圈”的分享参数。
 *
 * 参数 pageKey：当前页面标识，用来选择标题。
 * 注意事项：朋友圈分享由微信使用当前页面承接，不能像转发给朋友一样指定 path；这里只写 query。
 */
export function buildShareTimeline(
  pageKey: SharePageKey = 'today',
  scene: ShareScene = 'default',
  overrides: ShareMessageOverrides = {},
) {
  const config = scene === 'default'
    ? (SHARE_PAGE_CONFIGS[pageKey] || SHARE_PAGE_CONFIGS.today)
    : SHARE_SCENE_CONFIGS[scene]
  const queryIndex = config.path.indexOf('?')
  const query = queryIndex >= 0 ? config.path.slice(queryIndex + 1) : 'from=timeline'

  return {
    title: overrides.title || config.title,
    query,
    imageUrl: overrides.imageUrl || APP_SHARE_IMAGE_URL,
  }
}
