import {
  CompanionView,
  checkInCompanionToday,
  createEmptyCompanionView,
  ensureCompanionAdopted,
  loadCompanionView,
} from '../../services/companion-service'
import { loadGrowthView } from '../../services/growth-service'
import { refreshContentTopPadding } from '../../utils/safe-area'

Component({
  data: {
    contentTopPadding: 24,
    companion: createEmptyCompanionView() as CompanionView,
    checkinBusy: false,
  },

  lifetimes: {
    attached() {
      this.initViewportPadding()
      this.refreshCompanion()
    },
  },

  pageLifetimes: {
    show() {
      this.refreshCompanion()
    },
  },

  methods: {
    /** 按系统胶囊位置计算顶部安全距离，避免真机刘海遮挡返回按钮。 */
    initViewportPadding() {
      refreshContentTopPadding(this, { extraTop: 12 })
    },

    /** 礼簿已解锁的用户首次进入时自动领养，随后读取统一宠物视图。 */
    refreshCompanion() {
      if (loadGrowthView().isGiftUnlocked) ensureCompanionAdopted()
      this.setData({ companion: loadCompanionView() })
    },

    goBack() {
      if (getCurrentPages().length > 1) {
        wx.navigateBack()
        return
      }
      wx.redirectTo({ url: '../checkins/checkins' })
    },

    goPlan() {
      wx.redirectTo({ url: '../checkins/checkins' })
    },

    /**
     * 每个北京时间自然日只奖励一次5点成长值。
     * 服务层使用 daily:YYYY-MM-DD 幂等，重复点击不会重复增加经验。
     */
    checkInCompanion() {
      if (this.data.checkinBusy || !this.data.companion.isAvailable) return
      this.setData({ checkinBusy: true })
      try {
        const result = checkInCompanionToday()
        this.setData({ companion: result.view })
        wx.showToast({
          title: result.rewarded ? '签到成功，小暖 +5 EXP' : '今天已经签到了',
          icon: 'none',
        })
      } finally {
        this.setData({ checkinBusy: false })
      }
    },
  },
})
