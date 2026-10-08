export interface ContentTopPaddingOptions {
  /**
   * 状态栏或安全区下方额外留白。
   *
   * 调用时机：页面 onLoad 或组件 attached 阶段读取，直接用于 desk-content 的 padding-top。
   * 注意事项：单位是 px，和 wx.getSystemInfoSync、wx.getMenuButtonBoundingClientRect 返回值保持一致。
   */
  extraTop?: number
  /**
   * 右上角微信胶囊按钮底部到页面内容之间的最小距离，避免真机冷启动时内容压到胶囊下方。
   */
  capsuleGap?: number
  /**
   * 部分 Android 冷启动偶发拿不到 statusBarHeight/safeArea.top 时的兜底状态栏高度。
   */
  fallbackStatusTop?: number
  /**
   * 首次设置后延迟复查一次胶囊位置，处理真机冷启动时系统信息尚未稳定的情况。
   */
  settleDelay?: number
}

interface ContentTopPaddingHost {
  data: {
    contentTopPadding?: number
  }
  setData(data: { contentTopPadding: number }): void
}

const DEFAULT_EXTRA_TOP = 22
const DEFAULT_CAPSULE_GAP = 12
const DEFAULT_FALLBACK_STATUS_TOP = 24
const DEFAULT_SETTLE_DELAY = 120

function getMenuButtonBottom(): number {
  try {
    const menuRect = wx.getMenuButtonBoundingClientRect()

    if (!menuRect || menuRect.bottom <= 0) {
      return 0
    }

    return menuRect.bottom
  } catch (error) {
    console.warn('读取微信胶囊按钮位置失败，使用状态栏安全区兜底', error)
    return 0
  }
}

export function getContentTopPadding(options: ContentTopPaddingOptions = {}): number {
  const extraTop = options.extraTop ?? DEFAULT_EXTRA_TOP
  const capsuleGap = options.capsuleGap ?? DEFAULT_CAPSULE_GAP
  const fallbackStatusTop = options.fallbackStatusTop ?? DEFAULT_FALLBACK_STATUS_TOP
  let statusTop = fallbackStatusTop

  try {
    const systemInfo = wx.getSystemInfoSync()
    const safeAreaTop = systemInfo.safeArea ? systemInfo.safeArea.top || 0 : 0
    const statusBarTop = systemInfo.statusBarHeight || 0
    const measuredStatusTop = Math.max(safeAreaTop, statusBarTop)

    if (measuredStatusTop > 0) {
      statusTop = measuredStatusTop
    }
  } catch (error) {
    console.warn('读取窗口安全区失败，使用默认顶部留白兜底', error)
  }

  const statusPadding = statusTop + extraTop
  const capsulePadding = getMenuButtonBottom() + capsuleGap

  return Math.ceil(Math.max(statusPadding, capsulePadding))
}

export function refreshContentTopPadding(host: ContentTopPaddingHost, options: ContentTopPaddingOptions = {}) {
  const nextPadding = getContentTopPadding(options)

  if (host.data.contentTopPadding !== nextPadding) {
    host.setData({ contentTopPadding: nextPadding })
  }

  const settleDelay = options.settleDelay ?? DEFAULT_SETTLE_DELAY

  if (settleDelay <= 0) {
    return
  }

  setTimeout(() => {
    const settledPadding = getContentTopPadding(options)

    if (host.data.contentTopPadding !== settledPadding) {
      host.setData({ contentTopPadding: settledPadding })
    }
  }, settleDelay)
}
