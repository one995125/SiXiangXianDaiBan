import {
  ANNIVERSARY_MODE_OPTIONS,
  AnniversaryMode,
  DEFAULT_TODO_QUADRANT_ID,
  FAMILY_SPACE_FEATURE_ENABLED,
  REMIND_OPTIONS,
  RECURRENCE_OPTIONS,
  RECORD_TYPE_METAS,
  FamilyState,
  NoteKind,
  RecordDraft,
  RecordType,
  RecordVisibility,
  TODO_QUADRANT_OPTIONS,
  TodoQuadrantId,
  RecurrenceType,
  WEEKDAY_OPTIONS,
  createDefaultRecordDraft,
  getCategoryOptions,
  getRecordTypeMeta,
  inferAnniversaryMode,
  isRecordType,
  isRecurrenceType,
  isTodoQuadrantId,
  loadFamilyState,
  loadRememberRecordById,
  upsertRememberRecord,
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
  rescheduleWechatReminder,
} from '../../services/reminder-service'

const CUSTOM_CATEGORY_LABEL = '自定义分类'
const EXERCISE_CATEGORY_LABEL = '运动打卡'
const EXERCISE_NOTE_PLACEHOLDER = '每组12个，做8组'
const DEFAULT_NOTE_PLACEHOLDER = '补充地址、电话或需要携带的物品...'

type DeadlineQuickKey = 'today' | 'week' | 'month' | 'custom'

interface DeadlineQuickOption {
  key: DeadlineQuickKey
  label: string
  desc: string
}

interface VisibilityOption {
  value: RecordVisibility
  label: string
  desc: string
  disabled: boolean
}

const DEADLINE_QUICK_OPTIONS: DeadlineQuickOption[] = [
  { key: 'today', label: '今天', desc: '今天前完成' },
  { key: 'week', label: '本周内', desc: '周日前完成' },
  { key: 'month', label: '本月内', desc: '月底前完成' },
  { key: 'custom', label: '自定义', desc: '选择截止日' },
]

function buildVisibilityOptions(familyState: FamilyState | null): VisibilityOption[] {
  const privateOption: VisibilityOption = {
    value: 'private',
    label: '仅自己',
    desc: '只保存在当前账号',
    disabled: false,
  }

  if (!FAMILY_SPACE_FEATURE_ENABLED) {
    return [privateOption]
  }

  return [
    privateOption,
    {
      value: 'family',
      label: '家庭可见',
      desc: familyState ? `${familyState.displayName}可见` : '先在我的页开启家庭空间',
      disabled: !familyState,
    },
  ]
}

function buildWeekdayOptions(selectedDays: number[]) {
  return WEEKDAY_OPTIONS.map((item) => ({
    ...item,
    checked: selectedDays.includes(item.value),
  }))
}

function formatDeadlineDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDeadlineDate(dateText: string): Date {
  const [yearText, monthText, dayText] = dateText.split('-')
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
}

function getEndOfWeek(baseDate = new Date()): Date {
  const day = baseDate.getDay()
  const offset = day === 0 ? 0 : 7 - day
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset)
}

function getEndOfMonth(baseDate = new Date()): Date {
  return new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0)
}

function getSelectedDeadlineQuickKey(dateText: string, baseDate = new Date()): DeadlineQuickKey {
  if (!dateText) {
    return 'custom'
  }

  if (dateText === formatDeadlineDate(baseDate)) {
    return 'today'
  }

  if (dateText === formatDeadlineDate(getEndOfWeek(baseDate))) {
    return 'week'
  }

  if (dateText === formatDeadlineDate(getEndOfMonth(baseDate))) {
    return 'month'
  }

  return 'custom'
}

function isExerciseRecurringDraft(draft: RecordDraft): boolean {
  return draft.type === 'todo' && draft.category === EXERCISE_CATEGORY_LABEL && draft.recurrenceType !== 'none'
}

function getNotePlaceholder(draft: RecordDraft): string {
  return isExerciseRecurringDraft(draft) ? EXERCISE_NOTE_PLACEHOLDER : DEFAULT_NOTE_PLACEHOLDER
}

function applyExerciseTargetDefaults(
  draft: RecordDraft,
  _targetCountTouched: boolean,
  _targetUnitTouched: boolean,
): RecordDraft {
  if (draft.recurrenceType === 'none') {
    return draft
  }

  return {
    ...draft,
    targetCount: 1,
    targetUnit: '次',
  }
}

function buildDerivedFormData(draft: RecordDraft) {
  return {
    notePlaceholder: getNotePlaceholder(draft),
  }
}

function createFormDraftFromRecord(id: string): RecordDraft | null {
  const record = loadRememberRecordById(id, true)

  if (!record || record.deletedAt) {
    return null
  }

  return {
    id: record.id,
    type: record.type,
    title: record.title,
    category: record.category,
    noteKind: record.noteKind,
    quadrant: record.quadrant,
    anniversaryMode: record.anniversaryMode,
    date: record.date,
    time: record.time,
    isAllDay: record.isAllDay,
    remindBeforeMinutes: record.remindBeforeMinutes,
    repeatRule: record.repeatRule,
    recurrenceType: record.recurrenceType,
    weeklyDays: record.weeklyDays,
    targetCount: record.targetCount,
    targetUnit: record.targetUnit,
    status: record.status,
    note: record.note,
    visibility: record.visibility,
    familyId: record.familyId,
  }
}

function findRemindIndex(minutes: number): number {
  const index = REMIND_OPTIONS.findIndex((item) => item.value === minutes)
  return index >= 0 ? index : 0
}

function findRecurrenceIndex(type: RecurrenceType): number {
  const index = RECURRENCE_OPTIONS.findIndex((item) => item.value === type)
  return index >= 0 ? index : 0
}

function getInitialType(value: string | undefined): RecordType {
  return isRecordType(value) ? value : 'todo'
}

function getInitialRecurrence(type: RecordType, value: string | undefined): RecurrenceType {
  if (type !== 'todo' || !isRecurrenceType(value)) {
    return 'none'
  }

  return value
}

function createEmptyReminderConfig(): WechatReminderConfig {
  return { enabled: false, templateId: '', message: '微信提醒暂未配置' }
}

function createEmptyReminderStatus(): WechatReminderStatus {
  return {
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
}

/**
 * 在弹出订阅授权前做本地快速校验。
 * 周期计划和纪念日由服务端查找下一次发生日；普通待办和效期若提醒时间已过则不消耗授权。
 */
function isOneTimeReminderTimePassed(draft: RecordDraft, baseDate = new Date()): boolean {
  if (!draft.remindBeforeMinutes || draft.type === 'anniversary' || draft.recurrenceType !== 'none') {
    return false
  }

  const [year, month, day] = draft.date.split('-').map(Number)
  const [hour, minute] = (draft.isAllDay || !draft.time ? '09:00' : draft.time).split(':').map(Number)
  // 提醒服务统一以北京时间解释记录日期，不能使用设备本地时区直接构造 Date。
  const eventAt = Date.UTC(year, month - 1, day, hour - 8, minute)
  return !Number.isFinite(eventAt) || eventAt - draft.remindBeforeMinutes * 60 * 1000 <= baseDate.getTime() + 5000
}

Page({
  data: {
    contentTopPadding: 24,
    source: 'today',
    isEditing: false,
    recordTypes: RECORD_TYPE_METAS,
    remindOptions: REMIND_OPTIONS,
    remindLabels: REMIND_OPTIONS.map((item) => item.label),
    remindIndex: 0,
    recurrenceOptions: RECURRENCE_OPTIONS,
    recurrenceLabels: RECURRENCE_OPTIONS.map((item) => item.label),
    recurrenceIndex: 0,
    deadlineQuickOptions: DEADLINE_QUICK_OPTIONS,
    selectedDeadlineQuickKey: 'today' as DeadlineQuickKey,
    todoQuadrantOptions: TODO_QUADRANT_OPTIONS,
    anniversaryModeOptions: ANNIVERSARY_MODE_OPTIONS,
    weekdayOptions: buildWeekdayOptions(createDefaultRecordDraft().weeklyDays),
    categoryOptions: [] as string[],
    categoryLabels: [] as string[],
    categoryIndex: 0,
    isCustomCategory: false,
    familyFeatureEnabled: FAMILY_SPACE_FEATURE_ENABLED,
    familyState: null as FamilyState | null,
    visibilityOptions: buildVisibilityOptions(null),
    draft: createDefaultRecordDraft(),
    titleCount: 0,
    targetCountTouched: false,
    targetUnitTouched: false,
    noteKindOptions: [
      { value: 'temporary', label: '临时便签', desc: '未完成时每天进入计划和第四象限' },
      { value: 'long_term', label: '长期便签', desc: '用于知识、地址与长期备忘' },
    ],
    notePlaceholder: DEFAULT_NOTE_PLACEHOLDER,
    reminderConfig: createEmptyReminderConfig(),
    reminderStatus: createEmptyReminderStatus(),
    reminderStatusLoading: false,
    submitBusy: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.initViewportPadding()

    const id = options.id || ''
    const source = options.source || 'today'
    const initialType = getInitialType(options.type)
    const initialRecurrence = getInitialRecurrence(initialType, options.recurrence)
    const draft = id ? createFormDraftFromRecord(id) : createDefaultRecordDraft(initialType)
    const familyState = FAMILY_SPACE_FEATURE_ENABLED ? loadFamilyState() : null

    if (!draft) {
      wx.showToast({
        title: '记录不存在',
        icon: 'none',
      })
      wx.redirectTo({ url: '../today/today' })
      return
    }

    const safeDraft: RecordDraft = FAMILY_SPACE_FEATURE_ENABLED
      ? draft
      : { ...draft, visibility: 'private', familyId: '' }

    const targetCountTouched = Boolean(id)
    const targetUnitTouched = Boolean(id)
    const initialDraft: RecordDraft = id
      ? safeDraft
      : {
          ...safeDraft,
          recurrenceType: initialRecurrence,
          targetCount: initialRecurrence === 'none' ? safeDraft.targetCount : 1,
          targetUnit: initialRecurrence === 'none' ? safeDraft.targetUnit : safeDraft.targetUnit || '次',
        }
    const nextDraft = applyExerciseTargetDefaults(initialDraft, targetCountTouched, targetUnitTouched)

    this.setData({
      source,
      isEditing: Boolean(id),
      targetCountTouched,
      targetUnitTouched,
      familyState,
      visibilityOptions: buildVisibilityOptions(familyState),
      draft: nextDraft,
      titleCount: nextDraft.title.length,
      ...buildDerivedFormData(nextDraft),
      remindIndex: findRemindIndex(nextDraft.remindBeforeMinutes),
      recurrenceIndex: findRecurrenceIndex(nextDraft.recurrenceType),
      selectedDeadlineQuickKey: getSelectedDeadlineQuickKey(nextDraft.date),
      weekdayOptions: buildWeekdayOptions(nextDraft.weeklyDays),
    })
    this.refreshCategoryPicker(nextDraft.type, nextDraft.category)
    this.refreshReminderContext(id)
  },

  onShow() {
    this.refreshFamilyState()
  },

  onCloudUserDataReady() {
    this.refreshReminderContext()
  },

  async refreshReminderContext(recordId?: string) {
    const targetRecordId = recordId || String((this.data.draft as RecordDraft).id || '')
    this.setData({ reminderStatusLoading: true })
    const config = await loadWechatReminderConfig()
    const status = targetRecordId ? await loadWechatReminderStatus(targetRecordId) : createEmptyReminderStatus()
    this.setData({
      reminderConfig: config,
      reminderStatus: status,
      reminderStatusLoading: false,
    })
  },

  /**
   * 读取安全区并设置顶部留白。
   *
   * 调用时机：页面 onLoad。
   * 注意：只使用微信小程序系统 API，不依赖浏览器 DOM/BOM。
   */
  initViewportPadding() {
    refreshContentTopPadding(this)
  },

  /**
   * 刷新本地家庭空间状态，并同步可见范围选项。
   *
   * 调用时机：页面显示时，处理用户从“我的”页开启家庭空间后返回表单的场景。
   * 注意事项：只读取本地 storage，不发起网络请求，避免表单页产生额外云函数调用。
   */
  refreshFamilyState() {
    const familyState = FAMILY_SPACE_FEATURE_ENABLED ? loadFamilyState() : null
    const draft = this.data.draft as RecordDraft
    const nextDraft = !FAMILY_SPACE_FEATURE_ENABLED
      ? { ...draft, visibility: 'private' as RecordVisibility, familyId: '' }
      : draft.visibility === 'family' && familyState
        ? { ...draft, familyId: familyState.familyId }
        : draft

    this.setData({
      familyState,
      visibilityOptions: buildVisibilityOptions(familyState),
      draft: nextDraft,
    })
  },

  refreshCategoryPicker(type: RecordType, selectedCategory: string) {
    const categoryOptions = getCategoryOptions(type)
    const categoryIndex = categoryOptions.indexOf(selectedCategory)
    const isCustomCategory = Boolean(selectedCategory && categoryIndex < 0)

    this.setData({
      categoryOptions,
      categoryLabels: categoryOptions.concat(CUSTOM_CATEGORY_LABEL),
      categoryIndex: isCustomCategory ? categoryOptions.length : Math.max(categoryIndex, 0),
      isCustomCategory,
    })
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '../today/today' })
      },
    })
  },

  /**
   * 切换记录类型。
   *
   * 调用时机：用户点击表单顶部四类入口。
   * 注意：非待办类型会自动关闭周期目标，避免纪念日/效期误写打卡字段。
   */
  selectType(event: WechatMiniprogram.BaseEvent) {
    const type = String(event.currentTarget.dataset.type || 'todo') as RecordType
    const meta = getRecordTypeMeta(type)
    const draft = this.data.draft as RecordDraft
    const rawNextDraft: RecordDraft = {
      ...draft,
      type,
      category: meta.category,
      noteKind: type === 'note' ? draft.noteKind || 'temporary' : draft.noteKind,
      remindBeforeMinutes: type === 'note' ? 0 : draft.remindBeforeMinutes,
      repeatRule: type === 'anniversary' ? 'yearly' : 'none',
      anniversaryMode: type === 'anniversary' ? inferAnniversaryMode(draft.title, meta.category) : 'elapsed',
      quadrant: type === 'todo' ? draft.quadrant || DEFAULT_TODO_QUADRANT_ID : DEFAULT_TODO_QUADRANT_ID,
      recurrenceType: type === 'todo' ? draft.recurrenceType : 'none',
      targetCount: type === 'todo' ? draft.targetCount : 0,
      targetUnit: type === 'todo' ? draft.targetUnit : '',
    }
    const nextDraft = applyExerciseTargetDefaults(
      rawNextDraft,
      Boolean(this.data.targetCountTouched),
      Boolean(this.data.targetUnitTouched),
    )

    this.setData({
      draft: nextDraft,
      ...buildDerivedFormData(nextDraft),
      remindIndex: findRemindIndex(nextDraft.remindBeforeMinutes),
      recurrenceIndex: findRecurrenceIndex(nextDraft.recurrenceType),
      selectedDeadlineQuickKey: getSelectedDeadlineQuickKey(nextDraft.date),
      weekdayOptions: buildWeekdayOptions(nextDraft.weeklyDays),
    })
    this.refreshCategoryPicker(type, nextDraft.category)
  },

  /**
   * 切换记录可见范围。
   *
   * 调用时机：用户点击“仅自己 / 家庭可见”选项时。
   * 注意事项：家庭可见必须绑定当前 FAMILY_STORAGE_KEY 中的 familyId；未开启家庭空间时只提示，不写入 draft。
   */
  selectVisibility(event: WechatMiniprogram.BaseEvent) {
    if (!FAMILY_SPACE_FEATURE_ENABLED) {
      this.setData({
        familyState: null,
        visibilityOptions: buildVisibilityOptions(null),
        'draft.visibility': 'private',
        'draft.familyId': '',
      })
      return
    }

    const visibility = String(event.currentTarget.dataset.visibility || 'private') as RecordVisibility
    const disabled = event.currentTarget.dataset.disabled === true || event.currentTarget.dataset.disabled === 'true'
    const familyState = loadFamilyState()

    if (visibility === 'family') {
      if (disabled || !familyState) {
        wx.showToast({
          title: '请先在我的页开启家庭空间',
          icon: 'none',
        })
        this.refreshFamilyState()
        return
      }

      this.setData({
        familyState,
        visibilityOptions: buildVisibilityOptions(familyState),
        'draft.visibility': 'family',
        'draft.familyId': familyState.familyId,
      })
      return
    }

    this.setData({
      familyState,
      visibilityOptions: buildVisibilityOptions(familyState),
      'draft.visibility': 'private',
      'draft.familyId': '',
    })
  },

  onTitleInput(event: WechatMiniprogram.Input) {
    const title = String(event.detail.value || '').slice(0, 30)
    this.setData({
      'draft.title': title,
      titleCount: title.length,
    })
  },

  onCategoryChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value || 0)
    const categoryOptions = this.data.categoryOptions as string[]

    if (index >= categoryOptions.length) {
      const nextDraft: RecordDraft = {
        ...(this.data.draft as RecordDraft),
        category: '',
      }

      this.setData({
        categoryIndex: index,
        isCustomCategory: true,
        'draft.category': '',
        ...buildDerivedFormData(nextDraft),
      })
      return
    }

    const selectedCategory = categoryOptions[index] || ''
    const draft = this.data.draft as RecordDraft
    const rawNextDraft: RecordDraft = {
      ...draft,
      category: selectedCategory,
      anniversaryMode:
        draft.type === 'anniversary' ? inferAnniversaryMode(draft.title, selectedCategory) : draft.anniversaryMode,
    }
    const nextDraft = applyExerciseTargetDefaults(
      rawNextDraft,
      Boolean(this.data.targetCountTouched),
      Boolean(this.data.targetUnitTouched),
    )
    const update: Record<string, unknown> = {
      categoryIndex: index,
      isCustomCategory: false,
      'draft.category': nextDraft.category,
      'draft.targetCount': nextDraft.targetCount,
      'draft.targetUnit': nextDraft.targetUnit,
      notePlaceholder: getNotePlaceholder(nextDraft),
    }

    if (draft.type === 'anniversary') {
      update['draft.anniversaryMode'] = nextDraft.anniversaryMode
    }

    this.setData(update)
  },

  switchAnniversaryMode(event: WechatMiniprogram.BaseEvent) {
    const mode = String(event.currentTarget.dataset.mode || 'elapsed') as AnniversaryMode
    this.setData({
      'draft.anniversaryMode': mode,
    })
  },

  /** 切换便签类型；临时便签固定进入第四象限且不设置提醒。 */
  selectNoteKind(event: WechatMiniprogram.BaseEvent) {
    const noteKind = String(event.currentTarget.dataset.kind || 'temporary') as NoteKind
    const isTemporary = noteKind === 'temporary'
    const category = isTemporary ? '临时便签' : '知识便签'
    this.setData({
      'draft.noteKind': noteKind,
      'draft.category': category,
      'draft.quadrant': isTemporary ? 'avoid' : DEFAULT_TODO_QUADRANT_ID,
      'draft.remindBeforeMinutes': 0,
      'draft.isAllDay': true,
    })
    this.refreshCategoryPicker('note', category)
  },

  /**
   * 选择待办所属的四象限。
   *
   * 调用时机：用户在待办表单里点击象限卡片。
   * 注意：只写入新版记录 draft，旧四象限待办缓存不参与本次记录保存。
   */
  selectTodoQuadrant(event: WechatMiniprogram.BaseEvent) {
    const quadrant = String(event.currentTarget.dataset.quadrant || DEFAULT_TODO_QUADRANT_ID) as TodoQuadrantId

    this.setData({
      'draft.quadrant': isTodoQuadrantId(quadrant) ? quadrant : DEFAULT_TODO_QUADRANT_ID,
    })
  },

  /**
   * 选择普通待办的截止日期快捷项。
   *
   * 调用时机：用户点击“今天 / 本周内 / 本月内”快捷按钮。
   * 注意：这里只复用 draft.date，不新增云端字段；“自定义”由日期 picker 负责选择。
   */
  selectDeadlineQuick(event: WechatMiniprogram.BaseEvent) {
    const key = String(event.currentTarget.dataset.key || 'today') as DeadlineQuickKey
    if (key === 'custom') {
      this.setData({ selectedDeadlineQuickKey: 'custom' })
      return
    }

    const today = new Date()
    let deadlineDate = today

    if (key === 'week') {
      deadlineDate = getEndOfWeek(today)
    } else if (key === 'month') {
      deadlineDate = getEndOfMonth(today)
    }

    const dateText = formatDeadlineDate(deadlineDate)
    const draft = this.data.draft as RecordDraft
    const nextDays = draft.weeklyDays.length ? draft.weeklyDays : [deadlineDate.getDay()]

    this.setData({
      'draft.date': dateText,
      'draft.weeklyDays': nextDays,
      selectedDeadlineQuickKey: getSelectedDeadlineQuickKey(dateText, today),
      weekdayOptions: buildWeekdayOptions(nextDays),
    })
  },

  onCustomCategoryInput(event: WechatMiniprogram.Input) {
    const draft = this.data.draft as RecordDraft
    const rawNextDraft: RecordDraft = {
      ...draft,
      category: String(event.detail.value || '').slice(0, 20),
    }
    const nextDraft = applyExerciseTargetDefaults(
      rawNextDraft,
      Boolean(this.data.targetCountTouched),
      Boolean(this.data.targetUnitTouched),
    )

    this.setData({
      'draft.category': nextDraft.category,
      'draft.targetCount': nextDraft.targetCount,
      'draft.targetUnit': nextDraft.targetUnit,
      ...buildDerivedFormData(nextDraft),
    })
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    const date = String(event.detail.value || '')
    const draft = this.data.draft as RecordDraft
    const selectedDate = parseDeadlineDate(date)
    const nextDays = draft.weeklyDays.length ? draft.weeklyDays : [selectedDate.getDay()]

    this.setData({
      'draft.date': date,
      'draft.weeklyDays': nextDays,
      selectedDeadlineQuickKey: getSelectedDeadlineQuickKey(date),
      weekdayOptions: buildWeekdayOptions(nextDays),
    })
  },

  onTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({
      'draft.time': String(event.detail.value || ''),
      'draft.isAllDay': false,
    })
  },

  toggleAllDay() {
    const draft = this.data.draft as RecordDraft
    this.setData({
      'draft.isAllDay': !draft.isAllDay,
      'draft.time': !draft.isAllDay ? '' : draft.time || '09:00',
    })
  },

  onRemindChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value || 0)
    const option = REMIND_OPTIONS[index] || REMIND_OPTIONS[0]
    this.setData({
      remindIndex: index,
      'draft.remindBeforeMinutes': option.value,
    })
  },

  /**
   * 修改周期目标类型。
   *
   * 调用时机：用户在“重复方式”选择器中切换不重复/每日/每周/每月。
   * 注意：每月目标以记录开始日为触发日，月底不存在同日时由服务层收敛到当月最后一天。
   */
  onRecurrenceChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value || 0)
    const option = RECURRENCE_OPTIONS[index] || RECURRENCE_OPTIONS[0]
    const draft = this.data.draft as RecordDraft
    const fallbackDay = new Date(draft.date.replace(/-/g, '/')).getDay()
    const nextDays = option.value === 'weekly' && !draft.weeklyDays.length ? [fallbackDay] : draft.weeklyDays
    const rawNextDraft: RecordDraft = {
      ...draft,
      recurrenceType: option.value,
      weeklyDays: nextDays,
      targetCount: option.value === 'none' ? 0 : 1,
      targetUnit: option.value === 'none' ? '' : '次',
    }
    const nextDraft = applyExerciseTargetDefaults(
      rawNextDraft,
      Boolean(this.data.targetCountTouched),
      Boolean(this.data.targetUnitTouched),
    )

    this.setData({
      recurrenceIndex: index,
      'draft.recurrenceType': nextDraft.recurrenceType,
      'draft.weeklyDays': nextDraft.weeklyDays,
      'draft.targetUnit': nextDraft.targetUnit,
      'draft.targetCount': nextDraft.targetCount,
      ...buildDerivedFormData(nextDraft),
      selectedDeadlineQuickKey: getSelectedDeadlineQuickKey(nextDraft.date),
      weekdayOptions: buildWeekdayOptions(nextDraft.weeklyDays),
    })
  },

  toggleWeeklyDay(event: WechatMiniprogram.BaseEvent) {
    const day = Number(event.currentTarget.dataset.day)
    const draft = this.data.draft as RecordDraft
    const nextDays = draft.weeklyDays.includes(day)
      ? draft.weeklyDays.filter((item) => item !== day)
      : draft.weeklyDays.concat(day)
    const normalizedDays = nextDays.length ? nextDays.sort() : [day]

    this.setData({
      'draft.weeklyDays': normalizedDays,
      weekdayOptions: buildWeekdayOptions(normalizedDays),
    })
  },

  onTargetCountInput(event: WechatMiniprogram.Input) {
    const value = Number(event.detail.value || 0)
    this.setData({
      'draft.targetCount': Number.isFinite(value) && value > 0 ? Math.floor(value) : 0,
      targetCountTouched: true,
    })
  },

  onTargetUnitInput(event: WechatMiniprogram.Input) {
    this.setData({
      'draft.targetUnit': String(event.detail.value || '').slice(0, 12),
      targetUnitTouched: true,
    })
  },

  onNoteInput(event: WechatMiniprogram.Input) {
    this.setData({
      'draft.note': String(event.detail.value || '').slice(0, 500),
    })
  },

  /**
   * 提交并保存记录。
   *
   * 调用时机：用户点击底部保存按钮。
   * 注意：新写入强制 private；周期目标的累计进度由服务层负责写入 checkinHistory。
   */
  async submitForm() {
    if (this.data.submitBusy) {
      return
    }
    const familyState = FAMILY_SPACE_FEATURE_ENABLED ? loadFamilyState() : null
    const draft: RecordDraft = {
      ...(this.data.draft as RecordDraft),
    }

    if (!FAMILY_SPACE_FEATURE_ENABLED) {
      draft.visibility = 'private'
      draft.familyId = ''
    } else if (draft.visibility === 'family') {
      if (!familyState) {
        wx.showToast({
          title: '请先在我的页开启家庭空间',
          icon: 'none',
        })
        this.refreshFamilyState()
        return
      }

      draft.familyId = familyState.familyId
    } else {
      draft.visibility = 'private'
      draft.familyId = ''
    }

    if (!draft.title.trim()) {
      wx.showToast({
        title: '请填写标题',
        icon: 'none',
      })
      return
    }

    if (!draft.date) {
      wx.showToast({
        title: '请选择日期',
        icon: 'none',
      })
      return
    }

    if (!draft.category.trim()) {
      wx.showToast({
        title: '请选择或填写分类',
        icon: 'none',
      })
      return
    }

    if (draft.recurrenceType === 'weekly' && !draft.weeklyDays.length) {
      wx.showToast({
        title: '请选择每周打卡日',
        icon: 'none',
      })
      return
    }

    if (draft.recurrenceType !== 'none') {
      draft.targetCount = 1
      draft.targetUnit = '次'
    }

    const reminderConfig = this.data.reminderConfig as WechatReminderConfig
    const reminderStatus = this.data.reminderStatus as WechatReminderStatus
    const wantsWechatReminder = draft.type !== 'note' && draft.remindBeforeMinutes > 0
    const needsAuthorization = wantsWechatReminder && reminderConfig.enabled && !reminderStatus.hasActiveAuthorization
    let authorization: 'accepted' | 'rejected' | 'unavailable' | 'cancelled' = 'unavailable'

    if (needsAuthorization && isOneTimeReminderTimePassed(draft)) {
      wx.showToast({
        title: '提醒时间已过，请调整日期或时间',
        icon: 'none',
      })
      return
    }

    // 必须直接发生在“保存并开启微信提醒”的点击事件中，不能等云同步结束后再调授权 API。
    if (needsAuthorization) {
      authorization = await requestWechatReminderAuthorization(reminderConfig.templateId)
    }

    this.setData({ submitBusy: true })
    try {
      const record = upsertRememberRecord(draft)
      let reminderMessage = ''

      if (!wantsWechatReminder) {
        await cancelWechatReminder(record.id)
      } else if (!reminderConfig.enabled) {
        reminderMessage = '记录已保存，微信提醒暂未开放'
      } else if (reminderStatus.hasActiveAuthorization) {
        const result = await rescheduleWechatReminder(record.id)
        reminderMessage = result.success ? '已保存并更新微信提醒' : result.message || '记录已保存，提醒更新失败'
      } else if (authorization === 'accepted') {
        const result = await confirmWechatReminder(record.id)
        reminderMessage = result.pending ? '记录已保存，微信提醒待联网确认' : result.success ? '已保存并开启微信提醒' : result.message || ''
      } else if (authorization === 'rejected' || authorization === 'cancelled') {
        reminderMessage = '记录已保存，微信提醒未开启'
      }

      wx.showToast({
        title: reminderMessage || (this.data.isEditing ? '已保存修改' : '已保存记录'),
        icon: 'none',
      })

      if (this.data.isEditing) {
        wx.redirectTo({ url: `../record-detail/record-detail?id=${record.id}` })
        return
      }

      const routes: Record<string, string> = {
        today: '../today/today',
        checkins: '../checkins/checkins',
        calendar: '../calendar/calendar',
        records: '../records/records',
        mine: '../mine/mine',
      }
      wx.redirectTo({ url: routes[String(this.data.source)] || '../today/today' })
    } catch (error) {
      console.error('保存记录失败', error)
      wx.showToast({
        title: error instanceof Error ? error.message : '保存失败，请稍后重试',
        icon: 'none',
      })
    } finally {
      this.setData({ submitBusy: false })
    }
  },
})
