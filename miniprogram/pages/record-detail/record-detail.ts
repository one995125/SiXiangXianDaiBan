import {
  RecordView,
  checkInRememberRecord,
  getTodayDate,
  loadRememberRecordById,
  markRememberRecordDone,
  softDeleteRememberRecord,
  toggleRememberRecordPinned,
  toRecordView,
} from '../../services/record-service'
import { refreshContentTopPadding } from '../../utils/safe-area'
import {
  WechatReminderConfig,
  WechatReminderStatus,
  cancelWechatReminder,
  confirmWechatReminder,
  loadWechatReminderConfig,
  loadWechatReminderStatus,
  requestWechatReminderAuthorization,
} from '../../services/reminder-service'

const EMPTY_REMINDER_CONFIG: WechatReminderConfig = { enabled: false, templateId: '', message: '微信提醒暂未配置' }
const EMPTY_REMINDER_STATUS: WechatReminderStatus = {
  status: 'none',
  statusText: '微信提醒未开启',
  sendAt: 0,
  sendAtText: '',
  hasActiveAuthorization: false,
  canActivate: true,
  errorCode: '',
  errorCategory: '',
  errorHint: '',
}

function parseDate(dateText: string): Date {
  const [year, month, day] = dateText.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day)
}

function isOneTimeReminderPassed(record: RecordView, now = new Date()): boolean {
  if (!record.remindBeforeMinutes || record.type === 'anniversary' || record.isRecurring) {
    return false
  }
  const [year, month, day] = record.date.split('-').map(Number)
  const [hour, minute] = (record.isAllDay || !record.time ? '09:00' : record.time).split(':').map(Number)
  // 与云函数保持一致：全天事项及具体时间都按北京时间计算。
  const eventAt = Date.UTC(year, month - 1, day, hour - 8, minute)
  return !Number.isFinite(eventAt) || eventAt - record.remindBeforeMinutes * 60 * 1000 <= now.getTime() + 5000
}

Page({
  data: {
    contentTopPadding: 24,
    recordId: '',
    occurrenceDate: '',
    record: null as RecordView | null,
    actionBusy: false,
    reminderConfig: EMPTY_REMINDER_CONFIG,
    reminderStatus: EMPTY_REMINDER_STATUS,
    reminderBusy: false,
    showRenewReminderPrompt: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.initViewportPadding()
    const recordId = options.id || ''
    const occurrenceDate = options.date || ''

    this.setData({ recordId, occurrenceDate })
    this.loadRecord(recordId, occurrenceDate)
  },

  onShow() {
    this.setData({ actionBusy: false })

    if (this.data.recordId) {
      this.loadRecord(this.data.recordId, this.data.occurrenceDate)
    }
  },

  onCloudUserDataReady() {
    if (this.data.recordId) {
      this.loadRecord(this.data.recordId, this.data.occurrenceDate)
    }
  },

  /**
   * 读取安全区并设置页面顶部留白。
   *
   * 调用时机：页面 onLoad。
   * 注意：只使用 wx.getSystemInfoSync，不依赖浏览器 DOM/BOM。
   */
  initViewportPadding() {
    refreshContentTopPadding(this)
  },

  /**
   * 加载详情记录。
   *
   * 调用时机：页面进入、编辑返回、云同步回填后。
   * 注意：软删除记录不再展示；周期目标按传入 occurrenceDate 或今天展示当前周期进度。
   */
  loadRecord(recordId: string, occurrenceDate = '') {
    const record = loadRememberRecordById(recordId)

    if (!record) {
      this.setData({ record: null })
      wx.showToast({
        title: '记录不存在',
        icon: 'none',
      })
      return
    }

    this.setData({
      record: toRecordView(record, getTodayDate(), occurrenceDate || undefined),
    })
    this.refreshReminderContext(recordId)
  },

  async refreshReminderContext(recordId?: string) {
    const targetRecordId = recordId || String(this.data.recordId || '')
    if (!targetRecordId) {
      return
    }
    const config = await loadWechatReminderConfig()
    const status = await loadWechatReminderStatus(targetRecordId)
    this.setData({ reminderConfig: config, reminderStatus: status })
  },

  async enableWechatReminder() {
    if (!this.data.record || this.data.reminderBusy) {
      return
    }
    const config = this.data.reminderConfig as WechatReminderConfig
    if (!config.enabled || !config.templateId) {
      wx.showToast({ title: '微信提醒暂未配置', icon: 'none' })
      return
    }
    if (!this.data.record.remindBeforeMinutes) {
      this.editRecord()
      return
    }
    if (isOneTimeReminderPassed(this.data.record)) {
      wx.showToast({ title: '提醒时间已过，请先编辑时间', icon: 'none' })
      return
    }

    const authorization = await requestWechatReminderAuthorization(config.templateId)
    if (authorization !== 'accepted') {
      wx.showToast({ title: '微信提醒未开启', icon: 'none' })
      return
    }

    this.setData({ reminderBusy: true })
    const result = await confirmWechatReminder(this.data.recordId)
    this.setData({ reminderBusy: false })
    await this.refreshReminderContext()
    wx.showToast({
      title: result.pending ? '提醒待联网确认' : result.success ? '微信提醒已开启' : result.message || '开启提醒失败',
      icon: 'none',
    })
  },

  async disableWechatReminder() {
    if (this.data.reminderBusy) {
      return
    }
    this.setData({ reminderBusy: true })
    await cancelWechatReminder(this.data.recordId)
    this.setData({ reminderBusy: false })
    await this.refreshReminderContext()
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '../today/today' })
      },
    })
  },

  editRecord() {
    if (!this.data.recordId || this.data.actionBusy) {
      return
    }

    this.setData({ actionBusy: true })
    wx.navigateTo({
      url: `../record-form/record-form?id=${this.data.recordId}`,
      fail: (error) => {
        console.error('打开编辑页失败', error)
        this.setData({ actionBusy: false })
        wx.showToast({
          title: '打开编辑失败，请重试',
          icon: 'none',
        })
      },
    })
  },

  /**
   * 完成普通记录或给周期目标累计一次进度。
   *
   * 调用时机：用户点击底部主按钮。
   * 注意：targetCount 大于 1 时，周期目标每次点击默认 +1，达到目标后按钮置灰。
   */
  markDone() {
    if (!this.data.recordId || !this.data.record || this.data.actionBusy) {
      return
    }

    if (this.data.record.canPin) {
      return
    }

    this.setData({ actionBusy: true })
    const isRecurring = this.data.record.isRecurring
    const updatedRecord = isRecurring
      ? checkInRememberRecord(this.data.recordId, undefined, '', this.data.occurrenceDate ? parseDate(this.data.occurrenceDate) : new Date())
      : markRememberRecordDone(this.data.recordId, true)

    if (updatedRecord) {
      cancelWechatReminder(this.data.recordId)
      this.setData({
        actionBusy: false,
        record: toRecordView(updatedRecord, getTodayDate(), this.data.occurrenceDate || undefined),
        showRenewReminderPrompt: Boolean(isRecurring && this.data.record.remindBeforeMinutes > 0 && (this.data.reminderConfig as WechatReminderConfig).enabled),
      })
      wx.showToast({
        title: isRecurring ? '已记录进度' : this.data.record.type === 'expiry' ? '已标记处理' : '已标记完成',
        icon: 'none',
      })
      return
    }

    this.setData({ actionBusy: false })
    wx.showToast({
      title: isRecurring ? '当前不可记录进度' : this.data.record.type === 'expiry' ? '标记处理失败' : '标记失败，请重试',
      icon: 'none',
    })
  },

  dismissRenewReminder() {
    this.setData({ showRenewReminderPrompt: false })
  },

  async renewNextReminder() {
    const config = this.data.reminderConfig as WechatReminderConfig
    if (!config.enabled || !config.templateId || this.data.reminderBusy) {
      this.setData({ showRenewReminderPrompt: false })
      wx.showToast({ title: '微信提醒暂不可用', icon: 'none' })
      return
    }

    const authorization = await requestWechatReminderAuthorization(config.templateId)
    if (authorization !== 'accepted') {
      this.setData({ showRenewReminderPrompt: false })
      wx.showToast({ title: '暂未开启下一次提醒', icon: 'none' })
      return
    }

    this.setData({ reminderBusy: true })
    const result = await confirmWechatReminder(this.data.recordId, 'next')
    this.setData({ reminderBusy: false, showRenewReminderPrompt: false })
    await this.refreshReminderContext()
    wx.showToast({ title: result.pending ? '提醒待联网确认' : result.success ? '下一次提醒已开启' : result.message || '开启失败', icon: 'none' })
  },

  /**
   * 切换当前记录置顶状态。
   *
   * 调用时机：纪念日和便签详情页底部主按钮点击。
   * 注意：置顶通过 pinnedAt 参与统一排序，后置顶的记录会排在更前面。
   */
  togglePinned() {
    if (!this.data.recordId || !this.data.record || !this.data.record.canPin || this.data.actionBusy) {
      return
    }

    this.setData({ actionBusy: true })
    const updatedRecord = toggleRememberRecordPinned(this.data.recordId)

    if (updatedRecord) {
      const nextView = toRecordView(updatedRecord, getTodayDate(), this.data.occurrenceDate || undefined)
      this.setData({
        actionBusy: false,
        record: nextView,
      })
      wx.showToast({
        title: nextView.isPinned ? '已置顶' : '已取消置顶',
        icon: 'none',
      })
      return
    }

    this.setData({ actionBusy: false })
    wx.showToast({
      title: '置顶失败，请重试',
      icon: 'none',
    })
  },

  deleteRecord() {
    if (!this.data.recordId) {
      return
    }

    wx.showModal({
      title: '删除记录',
      content: '删除后会进入软删除状态，不再出现在默认列表中。',
      confirmText: '删除',
      confirmColor: '#d45b52',
      success: (result) => {
        if (!result.confirm) {
          return
        }

        if (softDeleteRememberRecord(this.data.recordId)) {
          cancelWechatReminder(this.data.recordId)
          wx.showToast({
            title: '已删除',
            icon: 'none',
          })
          wx.redirectTo({ url: '../today/today' })
        }
      },
    })
  },
})
