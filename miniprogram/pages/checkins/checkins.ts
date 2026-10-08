import {
  CheckinCenterView,
  checkInRememberRecord,
  loadCheckinCenter,
  markRememberRecordDone,
} from '../../services/record-service'
import { refreshContentTopPadding } from '../../utils/safe-area'
import { APP_SHARE_IMAGE_URL, buildShareAppMessage, buildShareTimeline, enableAppShareMenu } from '../../utils/share'
import {
  GrowthView,
  checkInGrowthToday,
  hasShownGrowthUnlockPrompt,
  loadGrowthView,
  markGrowthUnlockPromptShown,
} from '../../services/growth-service'
import { createGrowthSharePoster } from '../../utils/growth-poster'
import {
  WechatReminderConfig,
  cancelWechatReminder,
  confirmWechatReminder,
  loadWechatReminderConfig,
  requestWechatReminderAuthorization,
} from '../../services/reminder-service'
import {
  CompanionView,
  checkInCompanionToday,
  createEmptyCompanionView,
  ensureCompanionAdopted,
  loadCompanionView,
  markCompanionIntroShown,
} from '../../services/companion-service'

function createEmptyCheckinCenter(): CheckinCenterView {
  return {
    todayDate: '',
    todayLabel: '',
    summaryCards: [],
    dueItems: [],
    dailyItems: [],
    weeklyItems: [],
    monthlyItems: [],
    yearlyItems: [],
    dailyActions: [],
    allItems: [],
    weekDays: [],
    streakDays: 0,
    doneCount: 0,
    pendingCount: 0,
    totalCount: 0,
    hasDueItems: false,
    hasAllItems: false,
  }
}

Component({
  data: {
    contentTopPadding: 24,
    center: createEmptyCheckinCenter(),
    growth: loadGrowthView() as GrowthView,
    companion: createEmptyCompanionView() as CompanionView,
    companionFeedback: '',
    companionAnimating: false,
    growthPosterVisible: false,
    growthPosterGenerating: false,
    growthPosterPath: '',
    activePeriod: 'day',
    reminderConfig: { enabled: false, templateId: '', message: '' } as WechatReminderConfig,
    renewReminderRecordId: '',
    renewReminderTitle: '',
    renewReminderBusy: false,
    periodTabs: [
      { key: 'day', label: '日' },
      { key: 'week', label: '周' },
      { key: 'month', label: '月' },
      { key: 'year', label: '年' },
    ],
  },

  lifetimes: {
    attached() {
      this.initViewportPadding()
      enableAppShareMenu()
      this.loadCheckins()
      this.preloadReminderConfig()
    },
  },

  pageLifetimes: {
    show() {
      this.loadCheckins()
    },
  },

  methods: {
    initViewportPadding() {
      refreshContentTopPadding(this)
    },

    async preloadReminderConfig() {
      this.setData({ reminderConfig: await loadWechatReminderConfig() })
    },

    /**
     * 刷新打卡中心数据。
     *
     * 调用时机：页面进入、云端用户数据回填、完成一次打卡后。
     * 注意事项：这里只读取本地快照，云同步仍由记录服务和全局同步服务按 openid 隔离处理。
     */
    loadCheckins() {
      const growth = loadGrowthView()
      if (growth.isGiftUnlocked) ensureCompanionAdopted()
      this.setData({
        center: loadCheckinCenter(),
        growth,
        companion: growth.isGiftUnlocked ? loadCompanionView() : createEmptyCompanionView(),
      })
      this.maybeShowGiftUnlockedPrompt()
      this.maybeShowCompanionIntro()
    },

    onCloudUserDataReady() {
      this.loadCheckins()
      this.preloadReminderConfig()
    },

    onGrowthStateChanged() {
      this.loadCheckins()
    },

    onShareAppMessage(event?: { target?: { dataset?: { shareScene?: string } } }) {
      const growth = this.data.growth as GrowthView
      const shareScene = String(event?.target?.dataset?.shareScene || '')

      if (shareScene === 'plan_companion') {
        return buildShareAppMessage('checkins', 'plan_companion')
      }

      if (!growth.isGiftUnlocked) {
        return buildShareAppMessage('checkins', 'growth_companion', {
          title: `我已完成${growth.progress}/7，一起开始七日成长`,
          imageUrl: this.data.growthPosterPath || APP_SHARE_IMAGE_URL,
        })
      }
      return buildShareAppMessage('checkins')
    },

    onShareTimeline() {
      const growth = this.data.growth as GrowthView
      if (!growth.isGiftUnlocked) {
        return buildShareTimeline('checkins', 'growth_companion', {
          title: `我已完成${growth.progress}/7，一起开始七日成长`,
          imageUrl: APP_SHARE_IMAGE_URL,
        })
      }
      return buildShareTimeline('checkins')
    },

    openCreateForm() {
      wx.navigateTo({ url: '../record-form/record-form?source=checkins&type=todo&recurrence=daily' })
    },

    async checkInGrowth() {
      const growth = this.data.growth as GrowthView
      if (growth.isTodayChecked || growth.isGiftUnlocked) {
        return
      }

      wx.showLoading({ title: '签到中', mask: true })
      try {
        await checkInGrowthToday()
        this.loadCheckins()
        wx.showToast({ title: '签到成功', icon: 'success' })
      } catch (error) {
        wx.showToast({ title: error instanceof Error ? error.message : '签到失败，请稍后重试', icon: 'none' })
      } finally {
        wx.hideLoading()
      }
    },

    openGrowthTask(event: WechatMiniprogram.BaseEvent) {
      const target = String(event.currentTarget.dataset.target || '')
      if (target === 'plan') {
        this.openCreateForm()
      } else if (target === 'today') {
        wx.redirectTo({ url: '../today/today' })
      } else if (target === 'memory') {
        wx.redirectTo({ url: '../records/records?view=moods' })
      }
    },

    /** 根据实时成长数据生成图四风格的本地海报，不上传用户数据。 */
    async generateGrowthPoster() {
      const growth = this.data.growth as GrowthView
      if (this.data.growthPosterGenerating) {
        return
      }

      this.setData({ growthPosterGenerating: true })
      wx.showLoading({ title: '生成海报中', mask: true })
      try {
        const growthPosterPath = await createGrowthSharePoster(this, {
          progress: growth.progress,
          checkinCount: growth.checkinCount,
          milestoneCount: growth.milestoneCount,
        })
        this.setData({
          growthPosterPath,
          growthPosterVisible: true,
        })
      } catch (error) {
        wx.showToast({ title: error instanceof Error ? error.message : '海报生成失败', icon: 'none' })
      } finally {
        wx.hideLoading()
        this.setData({ growthPosterGenerating: false })
      }
    },

    closeGrowthPoster() {
      this.setData({ growthPosterVisible: false })
    },

    stopGrowthPosterEvent() {},

    /** 保存海报到相册；拒绝授权时引导用户在设置中重新开启。 */
    saveGrowthPoster() {
      const filePath = String(this.data.growthPosterPath || '')
      if (!filePath) {
        wx.showToast({ title: '请先生成海报', icon: 'none' })
        return
      }

      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: (error) => {
          const message = String(error.errMsg || '')
          if (message.includes('auth deny') || message.includes('auth denied')) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存图片，海报只保存在你的设备相册。',
              confirmText: '去设置',
              success: ({ confirm }) => {
                if (confirm) wx.openSetting()
              },
            })
            return
          }
          wx.showToast({ title: '保存失败，请重试', icon: 'none' })
        },
      })
    },

    maybeShowGiftUnlockedPrompt() {
      const growth = loadGrowthView()
      if (growth.state.cohort !== 'new' || !growth.isGiftUnlocked || hasShownGrowthUnlockPrompt()) {
        return
      }

      markGrowthUnlockPromptShown()
      ensureCompanionAdopted()
      markCompanionIntroShown()
      this.setData({ companion: loadCompanionView() })
      wx.showModal({
        title: '礼簿已解锁',
        content: '七日成长完成啦，礼簿已经解锁，小暖也来陪你了。',
        confirmText: '看看小暖',
        cancelText: '稍后',
        success: ({ confirm }) => {
          if (confirm) {
            wx.navigateTo({ url: '../pet/pet' })
          }
        },
      })
    },

    /** 老用户首次进入计划页时展示一次轻量领养介绍。 */
    maybeShowCompanionIntro() {
      const growth = this.data.growth as GrowthView
      const companion = loadCompanionView()
      this.setData({ companion })
      if (!growth.isGiftUnlocked || !companion.state || companion.state.introShownAt) return

      markCompanionIntroShown()
      this.setData({ companion: loadCompanionView() })
      wx.showModal({
        title: '小暖来啦',
        content: '完成计划会给小暖带来成长能量。成长只增不减，偶尔休息也没关系。',
        confirmText: '看看小家',
        cancelText: '知道了',
        success: ({ confirm }) => {
          if (confirm) wx.navigateTo({ url: '../pet/pet' })
        },
      })
    },

    /** 每日陪伴签到由服务层按北京时间日期幂等处理。 */
    checkInCompanion() {
      const companion = this.data.companion as CompanionView
      if (!companion.isAvailable || companion.isTodayChecked) return
      const result = checkInCompanionToday()
      this.setData({ companion: result.view })
      if (result.rewarded) this.showCompanionFeedback(result.feedback, result.leveledUp)
    },

    openCompanionHome() {
      wx.navigateTo({ url: '../pet/pet' })
    },

    showCompanionFeedback(feedback: string, leveledUp = false) {
      if (!feedback) return
      this.setData({
        companionFeedback: leveledUp ? `小暖升级啦 · ${feedback}` : `+成长值 · ${feedback}`,
        companionAnimating: true,
      })
      setTimeout(() => this.setData({ companionFeedback: '', companionAnimating: false }), 1800)
    },

    switchPeriod(event: WechatMiniprogram.BaseEvent) {
      this.setData({ activePeriod: String(event.currentTarget.dataset.period || 'day') })
    },

    openRecordDetail(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      if (id) {
        wx.navigateTo({ url: `../record-detail/record-detail?id=${id}` })
      }
    },

    /**
     * 为当前周期写入一次打卡记录。
     *
     * 参数说明：从按钮 data-id 读取记录 id；服务层会按日/周计算当前 periodKey。
     * 注意事项：不要在页面直接改 checkinHistory，统一走 checkInRememberRecord，保证本地缓存和云同步标记一致。
     */
    checkInRecord(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      if (!id) {
        return
      }

      const selectedRecord = (this.data.center as CheckinCenterView).allItems.find((item) => item.id === id)
      const companionBefore = (this.data.companion as CompanionView).exp
      const updatedRecord = selectedRecord && selectedRecord.recurrenceType === 'none'
        ? markRememberRecordDone(id)
        : checkInRememberRecord(id)
      if (updatedRecord) {
        cancelWechatReminder(id)
        this.loadCheckins()
        const companionAfter = this.data.companion as CompanionView
        if (companionAfter.exp > companionBefore) {
          const oldLevel = companionBefore >= 160 ? 3 : companionBefore >= 60 ? 2 : 1
          this.showCompanionFeedback('小暖吃到一颗计划能量', companionAfter.level > oldLevel)
        }
        if (selectedRecord && selectedRecord.recurrenceType !== 'none' && selectedRecord.remindBeforeMinutes > 0 && (this.data.reminderConfig as WechatReminderConfig).enabled) {
          this.setData({ renewReminderRecordId: id, renewReminderTitle: selectedRecord.title })
        }
        wx.showToast({
          title: selectedRecord && selectedRecord.recurrenceType === 'none' ? '已完成' : '已打卡',
          icon: 'none',
        })
        return
      }

      if (selectedRecord && !selectedRecord.isCheckinDue) {
        wx.showToast({
          title: '未到打卡日',
          icon: 'none',
        })
      }
    },

    dismissRenewReminder() {
      this.setData({ renewReminderRecordId: '', renewReminderTitle: '' })
    },

    async renewNextReminder() {
      const config = this.data.reminderConfig as WechatReminderConfig
      const recordId = String(this.data.renewReminderRecordId || '')
      if (!recordId || !config.enabled || !config.templateId || this.data.renewReminderBusy) {
        this.dismissRenewReminder()
        return
      }
      const authorization = await requestWechatReminderAuthorization(config.templateId)
      if (authorization !== 'accepted') {
        this.dismissRenewReminder()
        wx.showToast({ title: '暂未开启下一次提醒', icon: 'none' })
        return
      }
      this.setData({ renewReminderBusy: true })
      const result = await confirmWechatReminder(recordId, 'next')
      this.setData({ renewReminderBusy: false, renewReminderRecordId: '', renewReminderTitle: '' })
      wx.showToast({ title: result.pending ? '提醒待联网确认' : result.success ? '下一次提醒已开启' : result.message || '开启失败', icon: 'none' })
    },

  },
})
