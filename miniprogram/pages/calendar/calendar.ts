import {
  CalendarMonthView,
  buildCalendarMonthView,
  checkInRememberRecord,
  formatDateLabel,
  getTodayDate,
  loadRememberStorageSummary,
  loadTodayDashboard,
  markRememberRecordDone,
  queryRememberRecords,
  shiftMonth,
} from '../../services/record-service'
import {
  buildGiftBookSummary,
  buildGiftExchangeSummary,
} from '../../services/gift-mood-service'
import { refreshContentTopPadding } from '../../utils/safe-area'
import { buildShareAppMessage, buildShareTimeline, enableAppShareMenu } from '../../utils/share'
import { GrowthView, loadGrowthView } from '../../services/growth-service'
import {
  WechatReminderConfig,
  cancelWechatReminder,
  confirmWechatReminder,
  loadWechatReminderConfig,
  requestWechatReminderAuthorization,
} from '../../services/reminder-service'

type OverviewTarget = 'today' | 'checkins' | 'records' | 'create'

interface OverviewMetricCard {
  key: string
  label: string
  value: string
  unit: string
  tone: string
  target: OverviewTarget
  targetType?: 'anniversary' | 'gifts'
  valueClass: string
}

interface OverviewView {
  todayLabel: string
  metricCards: OverviewMetricCard[]
}

function createEmptyOverview(): OverviewView {
  return {
    todayLabel: '',
    metricCards: [],
  }
}

function createEmptyCalendarView(): CalendarMonthView {
  const today = getTodayDate()
  return {
    monthDate: today,
    monthLabel: '',
    days: [],
    selectedDate: today,
    selectedDateTitle: '',
    selectedWeekdayLabel: '',
    selectedSummaryText: '',
    selectedRecords: [],
    monthNodes: [],
  }
}

/**
 * 将 YYYY-MM-DD 转成设备本地日期，供指定发生日打卡使用。
 *
 * 注意事项：不能直接使用 new Date('YYYY-MM-DD')，否则部分环境会按 UTC 解析并造成日期偏移。
 */
function parseLocalDate(dateText: string): Date {
  const [year, month, day] = dateText.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day)
}

function formatMoneyValue(amount: number): string {
  const safeAmount = Math.max(0, Number(amount || 0))
  const displayAmount = Number.isInteger(safeAmount) ? String(safeAmount) : safeAmount.toFixed(2)
  return `¥${displayAmount}`
}

const TARGET_ROUTES: Record<Exclude<OverviewTarget, 'create'>, string> = {
  today: '../today/today',
  checkins: '../checkins/checkins',
  records: '../records/records',
}

Component({
  data: {
    contentTopPadding: 24,
    overview: createEmptyOverview(),
    growth: loadGrowthView() as GrowthView,
    calendarView: createEmptyCalendarView(),
    selectedDateLabel: '',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    reminderConfig: { enabled: false, templateId: '', message: '' } as WechatReminderConfig,
    renewReminderRecordId: '',
    renewReminderTitle: '',
    renewReminderBusy: false,
  },

  lifetimes: {
    attached() {
      this.initViewportPadding()
      enableAppShareMenu()
      this.loadOverview()
      this.refreshCalendar(getTodayDate(), getTodayDate())
      this.preloadReminderConfig()
    },
  },

  pageLifetimes: {
    show() {
      this.loadOverview()
      this.refreshCalendar(
        this.data.calendarView.monthDate || getTodayDate(),
        this.data.calendarView.selectedDate || getTodayDate(),
      )
    },
  },

  methods: {
    async preloadReminderConfig() {
      this.setData({ reminderConfig: await loadWechatReminderConfig() })
    },
    initViewportPadding() {
      refreshContentTopPadding(this)
    },

    /**
     * 生成总览页的单屏摘要。
     *
     * 调用时机：页面进入、云端用户数据回填、记录或礼簿数据变更后。
     * 注意事项：只读取现有本地快照；礼簿金额是用户自填数据，不涉及支付或交易。
     */
    loadOverview() {
      const dashboard = loadTodayDashboard()
      const storageSummary = loadRememberStorageSummary()
      const anniversaryCount = queryRememberRecords({ type: 'anniversary', includeDone: false }).length
      const growth = loadGrowthView()
      const giftSummary = growth.isGiftUnlocked ? buildGiftBookSummary() : null
      const giftExchangeSummary = growth.isGiftUnlocked ? buildGiftExchangeSummary() : null
      const overview: OverviewView = {
        todayLabel: dashboard.todayLabel,
        metricCards: [
          {
            key: 'anniversary',
            label: '纪念日',
            value: String(anniversaryCount),
            unit: '条',
            tone: 'violet',
            target: 'records',
            targetType: 'anniversary',
            valueClass: '',
          },
          {
            key: 'pending',
            label: '待处理',
            value: String(storageSummary.pendingCount),
            unit: '条',
            tone: 'coral',
            target: 'records',
            valueClass: '',
          },
          {
            key: 'goals',
            label: '计划完成',
            value: `${dashboard.checkinDoneCount}/${dashboard.checkinCount}`,
            unit: '',
            tone: 'mint',
            target: 'checkins',
            valueClass: '',
          },
          {
            key: 'expiry',
            label: '临近效期',
            value: String(dashboard.laterReminders.length),
            unit: '项',
            tone: 'amber',
            target: 'today',
            valueClass: '',
          },
          {
            key: 'gift-ledger',
            label: '礼金总额',
            value: giftSummary ? formatMoneyValue(giftSummary.totalAmount) : '待解锁',
            unit: '',
            tone: 'lagoon',
            target: 'records',
            targetType: 'gifts',
            valueClass: giftSummary ? 'is-money' : 'is-locked',
          },
          {
            key: 'gift-exchange',
            label: '往来总额',
            value: giftExchangeSummary ? formatMoneyValue(giftExchangeSummary.totalAmount) : '待解锁',
            unit: '',
            tone: 'violet',
            target: 'records',
            targetType: 'gifts',
            valueClass: giftExchangeSummary ? 'is-money' : 'is-locked',
          },
        ],
      }

      this.setData({
        overview,
        growth,
      })
    },

    onCloudUserDataReady() {
      this.loadOverview()
      this.preloadReminderConfig()
      this.refreshCalendar(
        this.data.calendarView.monthDate || getTodayDate(),
        this.data.calendarView.selectedDate || getTodayDate(),
      )
    },

    onGrowthStateChanged() {
      this.loadOverview()
    },

    onShareAppMessage() {
      return buildShareAppMessage('calendar')
    },

    onShareTimeline() {
      return buildShareTimeline('calendar')
    },

    openCreateForm() {
      wx.navigateTo({ url: '../record-form/record-form?source=calendar' })
    },

    openRecordDetail(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      if (!id) {
        return
      }

      wx.navigateTo({ url: `../record-detail/record-detail?id=${id}` })
    },

    /**
     * 刷新总览页月历和当前选中日期的记录。
     *
     * 调用时机：页面进入、切换月份、选择日期、完成记录或云端数据回填后。
     * 注意事项：月历数据统一由 record-service 聚合，页面只维护展示状态。
     */
    refreshCalendar(monthDate: string, selectedDate: string) {
      const calendarView = buildCalendarMonthView(monthDate, selectedDate)
      this.setData({
        calendarView,
        selectedDateLabel: formatDateLabel(calendarView.selectedDate),
      })
    },

    switchMonth(event: WechatMiniprogram.BaseEvent) {
      const offset = Number(event.currentTarget.dataset.offset || 0)
      const monthDate = shiftMonth(this.data.calendarView.monthDate || getTodayDate(), offset)
      this.refreshCalendar(monthDate, monthDate)
    },

    selectDate(event: WechatMiniprogram.BaseEvent) {
      const date = String(event.currentTarget.dataset.date || '')
      if (!date) {
        return
      }

      this.refreshCalendar(this.data.calendarView.monthDate || date, date)
    },

    /**
     * 完成选中日期中的普通事项，或为周期计划写入该日期的独立打卡。
     *
     * 注意事项：周期计划必须使用选中日期，避免查看历史日期时误记到今天。
     */
    checkInCalendarRecord(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      const target = this.data.calendarView.selectedRecords.find((item) => item.id === id)
      if (!id || !target) {
        return
      }

      const updatedRecord = target.isRecurring
        ? checkInRememberRecord(
          id,
          undefined,
          '',
          parseLocalDate(this.data.calendarView.selectedDate),
        )
        : markRememberRecordDone(id, true)

      if (!updatedRecord) {
        return
      }

      cancelWechatReminder(id)
      if (target.isRecurring && target.remindBeforeMinutes > 0 && (this.data.reminderConfig as WechatReminderConfig).enabled) {
        this.setData({ renewReminderRecordId: id, renewReminderTitle: target.title })
      }
      this.loadOverview()
      this.refreshCalendar(
        this.data.calendarView.monthDate || getTodayDate(),
        this.data.calendarView.selectedDate || getTodayDate(),
      )
      wx.showToast({
        title: target.isRecurring ? '已打卡' : '已标记完成',
        icon: 'none',
      })
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

    openTarget(event: WechatMiniprogram.BaseEvent) {
      const target = String(event.currentTarget.dataset.target || '') as OverviewTarget
      const targetType = String(event.currentTarget.dataset.type || '')

      if (target === 'create') {
        this.openCreateForm()
        return
      }

      if (TARGET_ROUTES[target]) {
        const route = TARGET_ROUTES[target]
        const url = target === 'records' && targetType === 'anniversary'
          ? `${route}?type=anniversary`
          : target === 'records' && targetType === 'gifts'
            ? `${route}?view=gifts`
            : route
        wx.redirectTo({ url })
      }
    },
  },
})
