import {
  TodayDashboard,
  checkInRememberRecord,
  loadTodayDashboard,
  markRememberRecordDone,
  reorderRememberRecordInQuadrant,
  reorderRememberRecordInType,
} from '../../services/record-service'
import {
  CompanionCheckinDay,
  CompanionView,
  checkInCompanionToday,
  createEmptyCompanionView,
  loadCompanionView,
} from '../../services/companion-service'
import { buildRecordOrderMenu } from '../../utils/record-order'
import { refreshContentTopPadding } from '../../utils/safe-area'
import { buildShareAppMessage, buildShareTimeline, enableAppShareMenu } from '../../utils/share'
import {
  WechatReminderConfig,
  cancelWechatReminder,
  confirmWechatReminder,
  loadWechatReminderConfig,
  requestWechatReminderAuthorization,
} from '../../services/reminder-service'

function createEmptyDashboard(): TodayDashboard {
  return {
    todayDate: '',
    todayLabel: '',
    dateTitle: '',
    weekdayLabel: '',
    overviewCards: [],
    quadrants: [],
    recentReminders: [],
    anniversaryCards: [],
    anniversaryMainCards: [],
    anniversaryStackCards: [],
    anniversaryTotalCount: 0,
    todayTaskItems: [],
    checkinItems: [],
    todayCheckinItems: [],
    todayReminders: [],
    laterReminders: [],
    todayCount: 0,
    recentCount: 0,
    todayTaskCount: 0,
    todayTaskDoneCount: 0,
    todayProgressPercent: 0,
    todayProgressText: '0 / 1',
    checkinCount: 0,
    checkinDoneCount: 0,
    checkinPendingCount: 0,
    checkinRemainingCount: 0,
    hasQuadrantRecords: false,
    hasTodayTaskItems: false,
    hasTodayReminders: false,
    hasRecentReminders: false,
    hasCheckinItems: false,
  }
}

Component({
  data: {
    contentTopPadding: 24,
    dashboard: createEmptyDashboard(),
    dailySignIn: {
      weekDays: [] as CompanionCheckinDay[],
      streakDays: 0,
      isTodayChecked: false,
    },
    signInBusy: false,
    companion: createEmptyCompanionView() as CompanionView,
    reminderConfig: { enabled: false, templateId: '', message: '' } as WechatReminderConfig,
    renewReminderRecordId: '',
    renewReminderTitle: '',
    renewReminderBusy: false,
  },

  lifetimes: {
    attached() {
      this.initViewportPadding()
      enableAppShareMenu()
      this.loadDashboard()
      this.preloadReminderConfig()
    },
  },

  pageLifetimes: {
    show() {
      this.loadDashboard()
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
     * 加载今天页聚合数据。
     *
     * 调用时机：页面进入、云同步回填、签到、打卡或完成普通提醒后。
     * 注意事项：周期待办由服务层单独放入 checkinItems，避免挤占普通提醒列表。
     */
    loadDashboard() {
      const dashboard = loadTodayDashboard()
      const companion = loadCompanionView()

      this.setData({
        dashboard,
        // 每日签到只读取小暖的签到日期，不与周期计划完成状态混用。
        dailySignIn: {
          weekDays: companion.weekDays,
          streakDays: companion.streakDays,
          isTodayChecked: companion.isTodayChecked,
        },
        companion,
      })
    },

    /**
     * 完成今天的小暖签到。
     * 服务层按北京时间使用 daily:YYYY-MM-DD 幂等，同一天重复点击不会重复增加经验。
     */
    signInToday() {
      const companion = this.data.companion as CompanionView
      if (this.data.signInBusy || !companion.isAvailable) return
      if (companion.isTodayChecked) {
        wx.showToast({ title: '今天已经签到了', icon: 'none' })
        return
      }

      this.setData({ signInBusy: true })
      try {
        const result = checkInCompanionToday()
        this.setData({
          companion: result.view,
          dailySignIn: {
            weekDays: result.view.weekDays,
            streakDays: result.view.streakDays,
            isTodayChecked: result.view.isTodayChecked,
          },
        })
        wx.showToast({
          title: result.rewarded
            ? result.leveledUp ? '签到成功，小暖升级啦' : `签到成功，小暖 +${result.amount} EXP`
            : '今天已经签到了',
          icon: 'none',
        })
      } finally {
        this.setData({ signInBusy: false })
      }
    },

    onCloudUserDataReady() {
      this.loadDashboard()
      this.preloadReminderConfig()
    },

    onShareAppMessage(event?: { target?: { dataset?: { shareScene?: string } } }) {
      const shareScene = String(event?.target?.dataset?.shareScene || '')
      if (shareScene === 'anniversary_companion') {
        return buildShareAppMessage('today', 'anniversary_companion')
      }
      if (shareScene === 'plan_companion') {
        return buildShareAppMessage('today', 'plan_companion')
      }

      return buildShareAppMessage('today')
    },

    onShareTimeline() {
      return buildShareTimeline('today')
    },

    openCreateForm() {
      wx.navigateTo({ url: '../record-form/record-form?source=today' })
    },

    openCheckins() {
      wx.redirectTo({ url: '../checkins/checkins' })
    },

    openAnniversaryRecords() {
      wx.redirectTo({ url: '../records/records?type=anniversary' })
    },

    /**
     * 长按首页纪念日卡片后打开排序菜单。
     *
     * 调用时机：用户长按首页纪念日行。
     * 注意：调整的是完整纪念日列表顺序，超过首页展示数量的记录也会参与排序。
     */
    openAnniversaryOrderMenu(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      const recordIndex = Number(event.currentTarget.dataset.index || 0)
      const recordCount = Number(event.currentTarget.dataset.count || 0)
      const menuItems = buildRecordOrderMenu(recordIndex, recordCount)

      if (!id || recordCount <= 1 || !menuItems.length) {
        wx.showToast({ title: '当前无需调整顺序', icon: 'none' })
        return
      }

      wx.showActionSheet({
        itemList: menuItems.map((item) => item.label),
        success: ({ tapIndex }) => {
          const selectedItem = menuItems[tapIndex]
          if (!selectedItem || !reorderRememberRecordInType(id, selectedItem.action)) {
            return
          }

          this.loadDashboard()
          wx.showToast({ title: '顺序已调整', icon: 'none' })
        },
      })
    },

    openRecordDetail(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      if (!id) {
        return
      }

      wx.navigateTo({ url: `../record-detail/record-detail?id=${id}` })
    },

    /**
     * 长按四象限事项后打开排序菜单。
     *
     * 调用时机：用户长按象限内的事项行。
     * 注意：排序由 record-service 持久化，并沿用现有云同步链路上传。
     */
    openQuadrantOrderMenu(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      const recordIndex = Number(event.currentTarget.dataset.index || 0)
      const recordCount = Number(event.currentTarget.dataset.count || 0)
      const menuItems = buildRecordOrderMenu(recordIndex, recordCount)

      if (!id || recordCount <= 1 || !menuItems.length) {
        wx.showToast({ title: '当前无需调整顺序', icon: 'none' })
        return
      }

      wx.showActionSheet({
        itemList: menuItems.map((item) => item.label),
        success: ({ tapIndex }) => {
          const selectedItem = menuItems[tapIndex]
          if (!selectedItem || !reorderRememberRecordInQuadrant(id, selectedItem.action)) {
            return
          }

          this.loadDashboard()
          wx.showToast({ title: '顺序已调整', icon: 'none' })
        },
      })
    },

    // 阻止长按完成按钮时冒泡触发事项排序菜单。
    ignoreQuadrantLongPress() {},

    checkInRecord(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      if (!id) {
        return
      }

      const dashboard = this.data.dashboard as TodayDashboard
      const target = dashboard.todayTaskItems.concat(dashboard.checkinItems).find((item) => item.id === id)
      const updatedRecord = target && target.isRecurring
        ? checkInRememberRecord(id)
        : markRememberRecordDone(id, true)

      if (updatedRecord) {
        cancelWechatReminder(id)
        this.loadDashboard()
        if (target && target.isRecurring && target.remindBeforeMinutes > 0 && (this.data.reminderConfig as WechatReminderConfig).enabled) {
          this.setData({ renewReminderRecordId: id, renewReminderTitle: target.title })
        }
        wx.showToast({
          title: target && target.isRecurring ? '已打卡' : '已标记完成',
          icon: 'none',
        })
      }
    },

    toggleRecordDone(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      if (!id) {
        return
      }

      const updatedRecord = markRememberRecordDone(id, true)
      if (updatedRecord) {
        cancelWechatReminder(id)
        this.loadDashboard()
        wx.showToast({
          title: '已标记完成',
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
