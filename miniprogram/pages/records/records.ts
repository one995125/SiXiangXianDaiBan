import {
  RECORD_TYPE_METAS,
  RecordFilterType,
  RecordView,
  loadCompletedRecords,
  queryRememberRecords,
  reorderRememberRecordInType,
} from '../../services/record-service'
import { buildRecordOrderMenu } from '../../utils/record-order'
import { refreshContentTopPadding } from '../../utils/safe-area'
import { buildShareAppMessage, buildShareTimeline, enableAppShareMenu } from '../../utils/share'
import {
  GiftBook,
  GiftContact,
  GiftExchangeBook,
  GiftExchangeContact,
  GiftExchangeDirection,
  GiftExchangeEntryKind,
  GiftExchangeRecord,
  GiftRecord,
  MOOD_OPTIONS,
  MoodRecord,
  MoodType,
  addGiftExchangeContact,
  addGiftExchangeRecord,
  addGiftContact,
  addGiftRecord,
  addMoodRecord,
  loadGiftExchangeBook,
  loadGiftBook,
  loadMoodRecords,
  removeGiftExchangeRecord,
  removeGiftRecord,
  updateGiftRecord,
} from '../../services/gift-mood-service'
import { GrowthView, isGiftFeatureUnlocked, loadGrowthView } from '../../services/growth-service'
import * as RecordsViewModel from '../../utils/records-view-model'

interface RecordTab {
  label: string
  value: RecordFilterType
}

type GiftSubTab = 'sent' | 'received' | 'exchange'
type GiftLedgerKind = 'happy' | 'sad'
type GiftLedgerTone = 'rose' | 'blue' | 'mint' | 'violet' | 'amber' | 'peach'

const GIFT_LEDGER_TONES: GiftLedgerTone[] = ['rose', 'blue', 'mint', 'violet', 'amber', 'peach']

/**
 * 根据记录 id 生成稳定的展示色。
 * 仅用于视图层：排序、搜索和重新进入页面时颜色保持一致，不写入本地或云端数据。
 */
function getGiftLedgerTone(seed: string): GiftLedgerTone {
  const hash = String(seed || '').split('').reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 0)
  return GIFT_LEDGER_TONES[hash % GIFT_LEDGER_TONES.length]
}

interface GiftLedgerRow {
  id: string
  anchorId: string
  title: string
  amount: number
  amountText: string
  date: string
  note: string
  kind: GiftLedgerKind
  kindLabel: string
  direction: GiftExchangeDirection
  directionText: string
  toneClass: GiftLedgerTone
  sortTime: number
}

interface GiftLedgerSummaryCard {
  kind: GiftLedgerKind
  iconAsset: string
  label: string
  directionLabel: string
  amountText: string
  count: number
  names: string[]
  isActive: boolean
}

interface MoodRecordView extends MoodRecord {
  dateTimeText: string
}

function formatMoodDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface GiftExchangeRecordView {
  id: string
  direction: GiftExchangeDirection
  directionText: string
  entryKind: GiftExchangeEntryKind
  entryKindText: string
  giftName: string
  date: string
  amountText: string
  note: string
  sortTime: number
}

interface GiftExchangeContactView {
  id: string
  name: string
  relation: string
  avatar: string
  avatarAsset: string
  receivedCount: number
  sentCount: number
  latestText: string
  latestDate: string
  latestLine: string
  receivedAmountText: string
  sentAmountText: string
  records: GiftExchangeRecordView[]
}

const TABS: RecordTab[] = [
  { label: '全部', value: 'all' },
  { label: '周期', value: 'recurring' },
  ...RECORD_TYPE_METAS.map<RecordTab>((meta) => ({
    label: meta.shortLabel,
    value: meta.type,
  })),
]

const DEFAULT_GIFT_AVATAR = '\ud83c\udf81'

function isRecordFilterType(value: string | undefined): value is RecordFilterType {
  return Boolean(value && TABS.some((tab) => tab.value === value))
}

Component({
  data: {
    contentTopPadding: 24,
    viewTab: 'records',
    growth: loadGrowthView() as GrowthView,
    tabs: TABS,
    activeType: 'all' as RecordFilterType,
    keyword: '',
    includeDone: false,
    routeFilterApplied: false,
    records: [] as RecordView[],
    recordsSortNote: '按更新时间排序',
    completedCount: 0,
    giftBook: { contacts: [], deletedGiftIds: [], updatedAt: 0 } as GiftBook,
    giftExchangeBook: { contacts: [], migratedGiftIds: [], deletedRecordIds: [], updatedAt: 0 } as GiftExchangeBook,
    giftSubTab: 'sent' as GiftSubTab,
    giftLedgerKind: 'happy' as GiftLedgerKind,
    giftLedgerCards: [] as GiftLedgerSummaryCard[],
    giftLedgerRows: [] as GiftLedgerRow[],
    giftLedgerSearchVisible: false,
    giftLedgerSearchKeyword: '',
    giftLedgerSearchResults: [] as GiftLedgerRow[],
    giftLedgerSearchResultsHeight: 0,
    giftLedgerSearchHint: '输入姓名、事项、方向、备注、金额或日期',
    giftLedgerHighlightedId: '',
    giftLedgerScrollTop: 0,
    giftLedgerSaveLabel: '保存送出礼金',
    giftExchangeContacts: [] as GiftExchangeContactView[],
    selectedGiftExchangeContactId: '',
    selectedGiftExchangeContact: null as GiftExchangeContactView | null,
    giftExchangeRows: [] as GiftExchangeRecordView[],
    giftExchangeFormVisible: false,
    giftExchangeContactName: '',
    giftExchangeContactRelation: '',
    giftExchangeGiftName: '',
    giftExchangeAmount: '',
    giftExchangeNote: '',
    giftExchangeDate: '',
    giftExchangeDirection: 'received' as GiftExchangeDirection,
    giftExchangeEntryKind: 'gift' as GiftExchangeEntryKind,
    giftContactName: '',
    giftContactRelation: '',
    giftTitle: '',
    giftAmount: '',
    giftNote: '',
    giftDate: '',
    giftLedgerFormVisible: false,
    giftLedgerEditingId: '',
    giftLedgerFormKind: 'happy' as GiftLedgerKind,
    giftLedgerDirection: 'sent' as GiftExchangeDirection,
    giftKeyboardHeight: 0,
    giftFormMaxHeight: 520,
    giftFormScrollHeight: 440,
    moodOptions: MOOD_OPTIONS,
    activeMood: 'happy' as MoodType,
    activeMoodPrompt: MOOD_OPTIONS[0].prompt,
    moodNote: '',
    moodRecords: [] as MoodRecordView[],
  },

  lifetimes: {
    attached() {
      this.initViewportPadding()
      enableAppShareMenu()
      this.applyRouteFilter()
      this.loadRecords()
    },
  },

  pageLifetimes: {
    show() {
      this.applyRouteFilter()
      this.loadRecords()
    },
  },

  methods: {
    initViewportPadding() {
      refreshContentTopPadding(this)
    },

    applyRouteFilter() {
      if (this.data.routeFilterApplied) {
        return
      }

      const pages = getCurrentPages()
      const currentPage = pages[pages.length - 1] as unknown as { options?: Record<string, string | undefined> }
      const type = currentPage?.options?.type
      const view = currentPage?.options?.view

      if (view === 'gifts' || view === 'moods' || view === 'records') {
        this.setData({
          routeFilterApplied: true,
          viewTab: view,
        })
        return
      }

      if (!isRecordFilterType(type)) {
        return
      }

      this.setData({
        routeFilterApplied: true,
        viewTab: 'records',
        activeType: type,
        includeDone: false,
      })
    },

    /**
     * 根据当前筛选条件刷新记录库列表。
     *
     * 调用时机：页面显示、搜索输入、分类切换、云同步回填。
     * 注意事项：搜索只在本地快照中执行，不做前端直连数据库查询，避免权限边界被绕过。
     */
    loadRecords() {
      const completedRecords = loadCompletedRecords()
      const growth = loadGrowthView()
      const giftBook = growth.isGiftUnlocked
        ? loadGiftBook()
        : { contacts: [], deletedGiftIds: [], updatedAt: 0 } as GiftBook
      const giftDirection: GiftExchangeDirection = this.data.giftSubTab === 'received' ? 'received' : 'sent'
      const giftLedger = RecordsViewModel.buildGiftLedgerView(giftBook, this.data.giftLedgerKind, giftDirection)
      const giftExchangeBook = growth.isGiftUnlocked
        ? loadGiftExchangeBook()
          : { contacts: [], migratedGiftIds: [], deletedRecordIds: [], updatedAt: 0 } as GiftExchangeBook
      const giftExchange = RecordsViewModel.buildGiftExchangeView(giftExchangeBook, this.data.selectedGiftExchangeContactId)
      const records = this.data.includeDone
        ? completedRecords.filter((record) => this.matchActiveFilter(record))
        : queryRememberRecords({
            type: this.data.activeType,
            keyword: this.data.keyword,
          })

      this.setData({
        growth,
        records,
        recordsSortNote: !this.data.includeDone
          && !this.data.keyword.trim()
          && (this.data.activeType === 'todo' || this.data.activeType === 'anniversary')
          ? '长按可调整顺序'
          : '按更新时间排序',
        completedCount: completedRecords.length,
        giftBook,
        giftExchangeBook,
        giftLedgerCards: giftLedger.cards,
        giftLedgerRows: giftLedger.rows,
        giftLedgerSaveLabel: this.getGiftLedgerSaveLabel(),
        giftExchangeContacts: giftExchange.contacts,
        selectedGiftExchangeContact: giftExchange.selectedContact,
        giftExchangeRows: giftExchange.rows,
        moodRecords: loadMoodRecords().map((record) => ({
          ...record,
          dateTimeText: formatMoodDateTime(record.createdAt),
        })),
      })
    },

    onCloudUserDataReady() {
      this.loadRecords()
    },

    onGrowthStateChanged() {
      this.loadRecords()
    },

    onShareAppMessage() {
      return buildShareAppMessage('records')
    },

    onShareTimeline() {
      return buildShareTimeline('records')
    },

    matchActiveFilter(record: RecordView): boolean {
      const keyword = this.data.keyword.trim().toLowerCase()
      const activeType = this.data.activeType
      const typeMatched =
        activeType === 'all' ||
        (activeType === 'recurring' ? record.isRecurring : record.type === activeType)
      const keywordMatched =
        !keyword ||
        [record.title, record.category, record.note, record.recurrenceText].some((value) => value.toLowerCase().includes(keyword))

      return typeMatched && keywordMatched
    },

    switchTab(event: WechatMiniprogram.BaseEvent) {
      const value = String(event.currentTarget.dataset.value || 'all') as RecordFilterType
      this.setData({
        activeType: value,
        includeDone: false,
      })
      this.loadRecords()
    },

    onKeywordInput(event: WechatMiniprogram.Input) {
      this.setData({
        keyword: String(event.detail.value || ''),
      })
      this.loadRecords()
    },

    switchViewTab(event: WechatMiniprogram.BaseEvent) {
      const value = String(event.currentTarget.dataset.value || 'records')
      const enteringGiftLedger = value === 'gifts' && this.data.viewTab !== 'gifts'
      this.setData({
        viewTab: value,
        giftLedgerFormVisible: false,
        giftKeyboardHeight: 0,
        ...(enteringGiftLedger
          ? {
              giftSubTab: 'sent' as GiftSubTab,
              giftLedgerKind: 'happy' as GiftLedgerKind,
              giftLedgerFormKind: 'happy' as GiftLedgerKind,
              giftLedgerDirection: 'sent' as GiftExchangeDirection,
              selectedGiftExchangeContactId: '',
            }
          : {}),
      })
      this.loadRecords()
    },

    goToGrowthCheckin() {
      wx.redirectTo({ url: '../checkins/checkins' })
    },

    ensureGiftUnlocked(): boolean {
      if (isGiftFeatureUnlocked()) {
        return true
      }
      wx.showToast({ title: '完成七日成长后解锁', icon: 'none' })
      return false
    },

    switchGiftSubTab(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const rawValue = String(event.currentTarget.dataset.value || 'sent')
      const value: GiftSubTab = rawValue === 'exchange'
        ? 'exchange'
        : rawValue === 'received'
          ? 'received'
          : 'sent'
      const direction: GiftExchangeDirection = value === 'received' ? 'received' : 'sent'
      this.setData({
        giftSubTab: value,
        ...(value !== 'exchange'
          ? {
              giftLedgerDirection: direction,
              giftLedgerSaveLabel: direction === 'received' ? '保存收礼记录' : '保存送礼记录',
            }
          : {}),
        giftLedgerFormVisible: false,
        giftKeyboardHeight: 0,
        giftExchangeFormVisible: false,
      })
      this.loadRecords()
    },

    /**
     * 打开礼金账本搜索弹层。
     *
     * 调用时机：点击“礼金账本 / 往来记录”右侧的搜索按钮。
     * 注意事项：每次打开都清空上次关键词，避免用户误以为数据缺失。
     */
    openGiftLedgerSearch() {
      if (!this.ensureGiftUnlocked()) return
      this.setData({
        giftLedgerSearchVisible: true,
        giftLedgerSearchKeyword: '',
        giftLedgerSearchResults: [],
        giftLedgerSearchResultsHeight: 0,
        giftLedgerSearchHint: '输入姓名、事项、方向、备注、金额或日期',
      })
    },

    closeGiftLedgerSearch() {
      this.setData({
        giftLedgerSearchVisible: false,
        giftLedgerSearchKeyword: '',
        giftLedgerSearchResults: [],
        giftLedgerSearchResultsHeight: 0,
      })
    },

    stopGiftLedgerSearchEvent() {},

    /**
     * 在本地礼簿快照中实时搜索礼金数据。
     *
     * 参数：event.detail.value 为输入框当前内容。
     * 注意事项：检索送出和收到的全部礼金记录，不发起网络请求；单次只合并一次 setData。
     */
    onGiftLedgerSearchInput(event: WechatMiniprogram.Input) {
      if (!this.ensureGiftUnlocked()) return
      const keyword = String(event.detail.value || '').trim().toLowerCase()
      const allRows = RecordsViewModel.buildAllGiftLedgerRows(loadGiftBook())
      const results = keyword
        ? allRows.filter((row) => {
            const searchableText = [row.title, row.note, row.amountText, row.date, row.kindLabel, row.directionText]
              .join(' ')
              .toLowerCase()
            return searchableText.includes(keyword)
          })
        : []

      this.setData({
        giftLedgerSearchKeyword: String(event.detail.value || ''),
        giftLedgerSearchResults: results,
        giftLedgerSearchResultsHeight: Math.min(results.length * 112 + 12, 560),
        giftLedgerSearchHint: keyword
          ? (results.length ? `找到 ${results.length} 条相关记录` : '没有找到相关记录')
          : '输入姓名、事项、方向、备注、金额或日期',
      })
    },

    /**
     * 从搜索结果返回原账本中的具体记录。
     *
     * 调用时机：用户点击搜索结果卡片。
     * 注意事项：先切换到记录所属分类，再滚动并高亮，确保目标节点已经完成渲染。
     */
    locateGiftLedgerSearchResult(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const id = String(event.currentTarget.dataset.id || '')
      const anchorId = String(event.currentTarget.dataset.anchor || '')
      const kind = String(event.currentTarget.dataset.kind || 'happy') === 'sad' ? 'sad' : 'happy'
      const direction: GiftExchangeDirection = String(event.currentTarget.dataset.direction || 'sent') === 'received'
        ? 'received'
        : 'sent'
      if (!id || !anchorId) {
        return
      }

      this.setData({
        giftLedgerSearchVisible: false,
        giftLedgerSearchKeyword: '',
        giftLedgerSearchResults: [],
        giftLedgerSearchResultsHeight: 0,
        giftSubTab: direction as GiftSubTab,
        giftLedgerKind: kind as GiftLedgerKind,
        giftLedgerFormKind: kind as GiftLedgerKind,
        giftLedgerDirection: direction,
        giftLedgerSaveLabel: direction === 'received' ? '保存收礼记录' : '保存送礼记录',
        giftLedgerHighlightedId: id,
      }, () => {
        this.loadRecords()
        setTimeout(() => {
          this.centerGiftLedgerRow(anchorId)
        }, 120)
        setTimeout(() => {
          if (this.data.giftLedgerHighlightedId === id) {
            this.setData({ giftLedgerHighlightedId: '' })
          }
        }, 2200)
      })
    },

    /**
     * 计算目标账目中心与滚动容器中心的差值，使用受控 scrollTop 完成居中定位。
     * 列表首尾由 scroll-view 自动收敛，避免目标行被强制顶格显示。
     */
    centerGiftLedgerRow(anchorId: string) {
      const query = wx.createSelectorQuery().in(this)
      query.select('.desk-scroll').boundingClientRect()
      query.select('.desk-scroll').scrollOffset()
      query.select(`#${anchorId}`).boundingClientRect()
      query.exec((results) => {
        const container = results[0] as { top?: number; height?: number } | null
        const offset = results[1] as { scrollTop?: number } | null
        const target = results[2] as { top?: number; height?: number } | null
        if (!container || !target) {
          return
        }

        const currentTop = Number(offset?.scrollTop || 0)
        const desiredTop = currentTop
          + Number(target.top || 0)
          - Number(container.top || 0)
          - (Number(container.height || 0) - Number(target.height || 0)) / 2
        this.setData({ giftLedgerScrollTop: Math.max(0, Math.round(desiredTop)) })
      })
    },

    switchGiftLedgerKind(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const kind = String(event.currentTarget.dataset.kind || 'happy') === 'sad' ? 'sad' : 'happy'
      this.setData({
        giftLedgerKind: kind,
        giftLedgerFormKind: kind,
      })
      this.loadRecords()
    },

    /**
     * 把已有礼簿联系人数据转换成设计稿里的挂礼账本视图。
     *
     * 调用时机：记录页刷新礼簿子模块时。
     * 注意事项：当前“送礼 / 收礼”标签决定方向筛选，礼金仍通过 sourceGiftId 镜像到往来记录。
     */
    buildGiftLedger(book: GiftBook): { cards: GiftLedgerSummaryCard[]; rows: GiftLedgerRow[] } {
      const activeKind = this.data.giftLedgerKind as GiftLedgerKind
      const activeDirection: GiftExchangeDirection = this.data.giftSubTab === 'received' ? 'received' : 'sent'
      const allRows = this.buildAllGiftLedgerRows(book)
      const cards = (['happy', 'sad'] as GiftLedgerKind[]).map((kind) => {
        const rows = allRows.filter((row) => row.kind === kind && row.direction === activeDirection)
        return {
          kind,
          iconAsset: kind === 'happy' ? '/assets/ui-icons/gift-happy.png' : '/assets/ui-icons/gift-sad.png',
          label: kind === 'happy' ? '喜事' : '憾事',
          directionLabel: activeDirection === 'received' ? '收到' : '送出',
          amountText: this.formatGiftLedgerAmount(rows.reduce((sum, row) => sum + row.amount, 0)),
          count: rows.length,
          names: rows.slice(0, 3).map((row) => row.title),
          isActive: kind === activeKind,
        }
      })

      return {
        cards,
        rows: allRows.filter((row) => row.kind === activeKind && row.direction === activeDirection),
      }
    },

    /** 汇总全部礼金记录，供分类列表和搜索弹层复用同一份排序规则。 */
    buildAllGiftLedgerRows(book: GiftBook): GiftLedgerRow[] {
      return book.contacts.reduce<GiftLedgerRow[]>((result, contact) => {
        return result.concat(
          contact.gifts.map((gift) => this.toGiftLedgerRow(contact, gift)),
        )
      }, []).sort((first, second) => second.sortTime - first.sortTime)
    },

    toGiftLedgerRow(contact: GiftContact, gift: GiftRecord): GiftLedgerRow {
      const kind = this.getGiftLedgerKind(gift)
      const amount = Math.max(0, Number(gift.amount || 0))
      return {
        id: gift.id,
        anchorId: `gift-ledger-${String(gift.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        title: `${contact.name}${gift.title || ''}`,
        amount,
        amountText: this.formatGiftLedgerAmount(amount),
        date: gift.date,
        note: gift.note || '',
        kind,
        kindLabel: kind === 'happy' ? '喜事' : '憾事',
        direction: gift.direction,
        directionText: gift.direction === 'sent' ? '我送出' : '我收到',
        toneClass: getGiftLedgerTone(gift.id),
        sortTime: this.getGiftLedgerSortTime(gift.date, gift.createdAt),
      }
    },

    getGiftLedgerKind(gift: GiftRecord): GiftLedgerKind {
      const text = `${gift.title} ${gift.occasion} ${gift.note}`.toLowerCase()
      const sadKeywords = ['憾', '白事', '丧', '悼', '吊', '祭', '殡', '忌', '帛金', '慰问']
      return sadKeywords.some((keyword) => text.includes(keyword)) ? 'sad' : 'happy'
    },

    formatGiftLedgerAmount(amount: number): string {
      const safeAmount = Math.max(0, Number(amount || 0))
      return `¥${Number.isInteger(safeAmount) ? safeAmount : safeAmount.toFixed(2)}`
    },

    getGiftLedgerSaveLabel(): string {
      return this.data.giftLedgerDirection === 'received' ? '保存收礼记录' : '保存送礼记录'
    },

    getGiftLedgerSortTime(dateText: string, fallback: number): number {
      const parsedTime = new Date(dateText.replace(/-/g, '/')).getTime()
      return Number.isFinite(parsedTime) ? parsedTime : fallback || 0
    },

    buildGiftExchange(book: GiftExchangeBook): {
      contacts: GiftExchangeContactView[]
      selectedContact: GiftExchangeContactView | null
      rows: GiftExchangeRecordView[]
    } {
      const contacts = book.contacts
        .map((contact) => this.toGiftExchangeContactView(contact))
        .sort((first, second) => {
          const firstTime = first.records.length ? first.records[0].sortTime : 0
          const secondTime = second.records.length ? second.records[0].sortTime : 0
          return secondTime - firstTime
        })
      const selectedContact = contacts.find((contact) => contact.id === this.data.selectedGiftExchangeContactId) || null

      return {
        contacts,
        selectedContact,
        rows: selectedContact ? selectedContact.records : [],
      }
    },

    toGiftExchangeContactView(contact: GiftExchangeContact): GiftExchangeContactView {
      const records = contact.records
        .map((record) => this.toGiftExchangeRecordView(record))
        .sort((first, second) => second.sortTime - first.sortTime)
      const latestRecord = records[0]
      const receivedRecords = contact.records.filter((record) => record.direction === 'received')
      const sentRecords = contact.records.filter((record) => record.direction === 'sent')
      const hasCustomAvatar = Boolean(contact.avatar && contact.avatar !== DEFAULT_GIFT_AVATAR)

      return {
        id: contact.id,
        name: contact.name,
        relation: contact.relation || '礼物往来',
        avatar: hasCustomAvatar ? contact.avatar : '',
        avatarAsset: hasCustomAvatar ? '' : '/assets/ui-icons/gift-exchange.png',
        receivedCount: receivedRecords.length,
        sentCount: sentRecords.length,
        latestText: latestRecord ? `${latestRecord.directionText}${latestRecord.giftName}` : '暂无往来记录',
        latestDate: latestRecord ? latestRecord.date : '',
        latestLine: latestRecord ? `${latestRecord.directionText}${latestRecord.giftName} · ${latestRecord.date}` : '暂无往来记录',
        receivedAmountText: this.formatGiftExchangeTotalAmount(receivedRecords),
        sentAmountText: this.formatGiftExchangeTotalAmount(sentRecords),
        records,
      }
    },

    toGiftExchangeRecordView(record: GiftExchangeRecord): GiftExchangeRecordView {
      return {
        id: record.id,
        direction: record.direction,
        directionText: record.direction === 'sent' ? '送出' : '收到',
        entryKind: record.entryKind === 'cash' ? 'cash' : 'gift',
        entryKindText: record.entryKind === 'cash' ? '礼金' : '礼物',
        giftName: record.giftName,
        date: record.date,
        amountText: record.hasAmount ? this.formatGiftLedgerAmount(record.amount) : '',
        note: record.note,
        sortTime: this.getGiftLedgerSortTime(record.date, record.createdAt),
      }
    },

    formatGiftExchangeTotalAmount(records: GiftExchangeRecord[]): string {
      const totalAmount = records.reduce((sum, record) => sum + (record.hasAmount ? record.amount : 0), 0)
      return totalAmount > 0 ? this.formatGiftLedgerAmount(totalAmount) : '未填金额'
    },

    showCompleted() {
      this.setData({
        includeDone: true,
        activeType: 'all',
      })
      this.loadRecords()
    },

    openRecordDetail(event: WechatMiniprogram.BaseEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      if (id) {
        wx.navigateTo({ url: `../record-detail/record-detail?id=${id}` })
      }
    },

    /**
     * 长按“待办”或“纪念日”记录打开排序菜单。
     *
     * 调用时机：单类型、未搜索、未查看归档的记录列表中长按记录行。
     * 注意：混合列表和搜索结果不开放排序，避免可见下标与完整同类列表不一致。
     */
    openRecordOrderMenu(event: WechatMiniprogram.BaseEvent) {
      const canReorder = !this.data.includeDone
        && !this.data.keyword.trim()
        && (this.data.activeType === 'todo' || this.data.activeType === 'anniversary')

      if (!canReorder) {
        return
      }

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

          this.loadRecords()
          wx.showToast({ title: '顺序已调整', icon: 'none' })
        },
      })
    },

    openGiftExchangeContact(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const id = String(event.currentTarget.dataset.id || '')
      if (!id) {
        return
      }

      this.setData({
        selectedGiftExchangeContactId: id,
        giftExchangeFormVisible: false,
      })
      this.loadRecords()
    },

    backToGiftExchangeContacts() {
      this.setData({
        selectedGiftExchangeContactId: '',
        giftExchangeFormVisible: false,
      })
      this.loadRecords()
    },

    onAddGiftExchangeTap() {
      if (!this.ensureGiftUnlocked()) return
      const visible = !this.data.giftExchangeFormVisible
      const today = new Date()
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const selectedContact = this.data.selectedGiftExchangeContact as GiftExchangeContactView | null

      this.setData({
        giftExchangeFormVisible: visible,
        giftExchangeDate: this.data.giftExchangeDate || date,
        giftExchangeDirection: this.data.giftExchangeDirection || 'received',
        giftExchangeContactName: selectedContact ? selectedContact.name : this.data.giftExchangeContactName,
        giftExchangeContactRelation: selectedContact ? selectedContact.relation : this.data.giftExchangeContactRelation,
      })
    },

    switchGiftExchangeDirection(event: WechatMiniprogram.BaseEvent) {
      const direction = String(event.currentTarget.dataset.value || 'received') === 'sent' ? 'sent' : 'received'
      this.setData({ giftExchangeDirection: direction as GiftExchangeDirection })
    },

    /** 切换往来条目的形态；礼金与普通礼物共用联系人和时间线。 */
    switchGiftExchangeEntryKind(event: WechatMiniprogram.BaseEvent) {
      const entryKind = String(event.currentTarget.dataset.value || 'gift') === 'cash' ? 'cash' : 'gift'
      this.setData({ giftExchangeEntryKind: entryKind as GiftExchangeEntryKind })
    },

    onGiftExchangeContactNameInput(event: WechatMiniprogram.Input) {
      this.setData({ giftExchangeContactName: String(event.detail.value || '').slice(0, 20) })
    },

    onGiftExchangeContactRelationInput(event: WechatMiniprogram.Input) {
      this.setData({ giftExchangeContactRelation: String(event.detail.value || '').slice(0, 12) })
    },

    onGiftExchangeGiftNameInput(event: WechatMiniprogram.Input) {
      this.setData({ giftExchangeGiftName: String(event.detail.value || '').slice(0, 30) })
    },

    onGiftExchangeAmountInput(event: WechatMiniprogram.Input) {
      this.setData({ giftExchangeAmount: String(event.detail.value || '') })
    },

    onGiftExchangeNoteInput(event: WechatMiniprogram.Input) {
      this.setData({ giftExchangeNote: String(event.detail.value || '').slice(0, 120) })
    },

    onGiftExchangeDateChange(event: WechatMiniprogram.PickerChange) {
      this.setData({ giftExchangeDate: String(event.detail.value || '') })
    },

    addGiftExchangeFromForm() {
      if (!this.ensureGiftUnlocked()) return
      const selectedContact = this.data.selectedGiftExchangeContact as GiftExchangeContactView | null
      const contactName = (selectedContact ? selectedContact.name : this.data.giftExchangeContactName).trim()
      const contactRelation = (selectedContact ? selectedContact.relation : this.data.giftExchangeContactRelation).trim()
      const giftName = this.data.giftExchangeGiftName.trim()
      const amountText = this.data.giftExchangeAmount.trim()

      if (!contactName) {
        wx.showToast({ title: '请填写对象', icon: 'none' })
        return
      }

      if (!giftName) {
        wx.showToast({
          title: this.data.giftExchangeEntryKind === 'cash' ? '请填写事项' : '请填写礼物',
          icon: 'none',
        })
        return
      }

      if (amountText && (!Number.isFinite(Number(amountText)) || Number(amountText) < 0)) {
        wx.showToast({ title: '金额不正确', icon: 'none' })
        return
      }

      const book = loadGiftExchangeBook()
      const existingContact = selectedContact
        ? book.contacts.find((contact) => contact.id === selectedContact.id)
        : this.findGiftExchangeContact(book.contacts, contactName, contactRelation)
      const contact = existingContact || addGiftExchangeContact({
        name: contactName,
        relation: contactRelation,
      })

      addGiftExchangeRecord(contact.id, {
        direction: this.data.giftExchangeDirection as GiftExchangeDirection,
        entryKind: this.data.giftExchangeEntryKind as GiftExchangeEntryKind,
        giftName,
        date: this.data.giftExchangeDate,
        amount: amountText ? Number(amountText) : undefined,
        note: this.data.giftExchangeNote,
      })

      this.setData({
        selectedGiftExchangeContactId: contact.id,
        giftExchangeFormVisible: false,
        giftExchangeGiftName: '',
        giftExchangeAmount: '',
        giftExchangeNote: '',
        giftExchangeContactName: '',
        giftExchangeContactRelation: '',
        giftExchangeDirection: 'received' as GiftExchangeDirection,
        giftExchangeEntryKind: 'gift' as GiftExchangeEntryKind,
      })
      this.loadRecords()
      wx.showToast({ title: '已添加往来记录', icon: 'none' })
    },

    findGiftExchangeContact(contacts: GiftExchangeContact[], name: string, relation: string): GiftExchangeContact | null {
      return contacts.find((contact) => contact.name === name && contact.relation === relation) || null
    },

    removeGiftExchangeRow(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const id = String(event.currentTarget.dataset.id || '')
      if (!id) {
        return
      }

      wx.showModal({
        title: '删除这条往来记录？',
        content: '礼金记录会同步从礼金账本移除；普通礼物只删除当前往来。联系人不会被删除。',
        confirmText: '删除',
        confirmColor: '#d45b52',
        success: (result) => {
          if (!result.confirm) {
            return
          }

          if (removeGiftExchangeRecord(id)) {
            this.loadRecords()
            wx.showToast({ title: '已删除', icon: 'none' })
          }
        },
      })
    },

    onGiftContactNameInput(event: WechatMiniprogram.Input) {
      this.setData({ giftContactName: String(event.detail.value || '').slice(0, 20) })
    },

    onGiftContactRelationInput(event: WechatMiniprogram.Input) {
      this.setData({ giftContactRelation: String(event.detail.value || '').slice(0, 12) })
    },

    onGiftTitleInput(event: WechatMiniprogram.Input) {
      this.setData({ giftTitle: String(event.detail.value || '').slice(0, 30) })
    },

    onGiftAmountInput(event: WechatMiniprogram.Input) {
      this.setData({ giftAmount: String(event.detail.value || '') })
    },

    onGiftNoteInput(event: WechatMiniprogram.Input) {
      this.setData({ giftNote: String(event.detail.value || '').slice(0, 80) })
    },

    onGiftDateChange(event: WechatMiniprogram.PickerChange) {
      this.setData({ giftDate: String(event.detail.value || '') })
    },

    removeGiftLedgerRow(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const id = String(event.currentTarget.dataset.id || '')

      if (!id) {
        return
      }

      wx.showModal({
        title: '删除这条礼簿记录？',
        content: '删除后只会移除这条送礼/收礼记录，不会删除联系人。',
        confirmText: '删除',
        confirmColor: '#8577dd',
        success: (result) => {
          if (!result.confirm) {
            return
          }

          if (removeGiftRecord(id)) {
            this.loadRecords()
            wx.showToast({ title: '已删除', icon: 'none' })
          }
        },
      })
    },

    switchGiftLedgerFormKind(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const kind = String(event.currentTarget.dataset.kind || 'happy') === 'sad' ? 'sad' : 'happy'
      this.setData({
        giftLedgerFormKind: kind,
        giftLedgerKind: kind,
      })
    },

    openGiftLedgerForm() {
      if (!this.ensureGiftUnlocked()) return
      if (this.data.giftSubTab === 'exchange') return
      const today = new Date()
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const formSize = this.getGiftLedgerFormSize(0)
      const direction: GiftExchangeDirection = this.data.giftSubTab === 'received' ? 'received' : 'sent'
      this.setData({
        giftLedgerFormVisible: true,
        giftLedgerEditingId: '',
        giftLedgerFormKind: this.data.giftLedgerKind,
        giftLedgerDirection: direction,
        giftLedgerSaveLabel: direction === 'received' ? '保存收礼记录' : '保存送礼记录',
        giftContactName: '',
        giftContactRelation: '',
        giftTitle: '',
        giftAmount: '',
        giftNote: '',
        giftDate: date,
        giftKeyboardHeight: 0,
        giftFormMaxHeight: formSize.maxHeight,
        giftFormScrollHeight: formSize.scrollHeight,
      })
    },

    /**
     * 从礼簿列表打开编辑弹层。
     *
     * 调用时机：点击记录行右侧“编辑”。方向沿用原记录，避免用户在送礼/收礼标签中重复选择。
     */
    openGiftLedgerEditForm(event: WechatMiniprogram.BaseEvent) {
      if (!this.ensureGiftUnlocked()) return
      const giftId = String(event.currentTarget.dataset.id || '')
      const book = loadGiftBook()
      let matchedContact: GiftContact | undefined
      let matchedGift: GiftRecord | undefined

      book.contacts.some((contact) => {
        const gift = contact.gifts.find((item) => item.id === giftId)
        if (!gift) return false
        matchedContact = contact
        matchedGift = gift
        return true
      })

      if (!matchedContact || !matchedGift) {
        wx.showToast({ title: '记录不存在或已被删除', icon: 'none' })
        return
      }

      const gift = matchedGift as GiftRecord
      const contact = matchedContact as GiftContact
      const kind: GiftLedgerKind = gift.occasion === '憾事' ? 'sad' : 'happy'
      const formSize = this.getGiftLedgerFormSize(0)
      this.setData({
        giftLedgerFormVisible: true,
        giftLedgerEditingId: gift.id,
        giftLedgerFormKind: kind,
        giftLedgerDirection: gift.direction,
        giftLedgerSaveLabel: '保存修改',
        giftContactName: contact.name,
        giftContactRelation: contact.relation,
        giftTitle: gift.title,
        giftAmount: gift.amount > 0 ? String(gift.amount) : '',
        giftNote: gift.note,
        giftDate: gift.date,
        giftKeyboardHeight: 0,
        giftFormMaxHeight: formSize.maxHeight,
        giftFormScrollHeight: formSize.scrollHeight,
      })
    },

    /**
     * 关闭礼金弹层并主动收起键盘。
     *
     * 调用时机：点击遮罩或右上角关闭按钮。
     * 注意：清零键盘高度，确保下次打开时弹层从屏幕底部正常出现。
     */
    closeGiftLedgerForm() {
      wx.hideKeyboard()
      this.setData({
        giftLedgerFormVisible: false,
        giftLedgerEditingId: '',
        giftKeyboardHeight: 0,
      })
    },

    // 弹层内部点击只用于阻止事件冒泡，避免误触遮罩关闭。
    stopGiftFormEvent() {},

    /**
     * 根据输入法高度把挂礼弹层抬到键盘上方。
     *
     * 参数 event.detail.height：微信输入框返回的键盘像素高度。
     * 注意：表单输入框关闭 adjust-position，避免系统上移与手动上移叠加。
     */
    onGiftFormKeyboardHeightChange(event: WechatMiniprogram.BaseEvent) {
      const detail = (event as unknown as { detail: { height?: number } }).detail
      const keyboardHeight = Math.max(0, Number(detail.height || 0))
      const formSize = this.getGiftLedgerFormSize(keyboardHeight)

      this.setData({
        giftKeyboardHeight: keyboardHeight,
        giftFormMaxHeight: formSize.maxHeight,
        giftFormScrollHeight: formSize.scrollHeight,
      })
    },

    /** 计算弹层及其滚动区域高度，兼容不同屏幕和输入法尺寸。 */
    getGiftLedgerFormSize(keyboardHeight: number): { maxHeight: number; scrollHeight: number } {
      // 项目类型包版本较旧，局部补充基础库 2.20.1+ 已提供的 getWindowInfo 类型。
      const windowHeight = (wx as unknown as { getWindowInfo(): { windowHeight: number } }).getWindowInfo().windowHeight
      const availableHeight = Math.max(260, windowHeight - keyboardHeight - 24)
      const maxHeight = Math.floor(Math.min(windowHeight * 0.74, availableHeight))

      return {
        maxHeight,
        scrollHeight: Math.max(220, maxHeight - 72),
      }
    },

    /**
     * 按设计稿的挂礼账本入口新增一条记录。
     *
     * 调用时机：用户展开“添加礼金记录”表单并点击保存。
     * 注意事项：礼簿数据仍只写本地 storage，再由统一云同步服务推送；金额不是支付交易，只是用户手动记账字段。
     */
    addGiftLedgerFromForm() {
      if (!this.ensureGiftUnlocked()) return
      const contactName = this.data.giftContactName.trim()
      const kind = this.data.giftLedgerFormKind as GiftLedgerKind
      const title = this.data.giftTitle.trim() || (kind === 'happy' ? '喜事' : '憾事')

      if (!contactName) {
        wx.showToast({ title: '请填写联系人', icon: 'none' })
        return
      }
      const book = loadGiftBook()
      const relation = this.data.giftContactRelation.trim()
      const existingContact = book.contacts.find(
        (contact) => contact.name === contactName && contact.relation === relation,
      )
      const contact = existingContact || addGiftContact({
        name: contactName,
        relation,
      })

      const giftInput: Partial<GiftRecord> = {
        title,
        occasion: kind === 'happy' ? '喜事' : '憾事',
        amount: Number(this.data.giftAmount || 0),
        direction: this.data.giftLedgerDirection as GiftExchangeDirection,
        date: this.data.giftDate,
        note: this.data.giftNote,
      }
      const editingId = String(this.data.giftLedgerEditingId || '')
      const savedGift = editingId
        ? updateGiftRecord(editingId, contact.id, giftInput)
        : addGiftRecord(contact.id, giftInput)

      if (!savedGift) {
        wx.showToast({ title: '保存失败，请刷新后重试', icon: 'none' })
        return
      }

      wx.showToast({
        title: editingId
          ? '礼簿记录已修改'
          : (this.data.giftLedgerDirection === 'received' ? '已记录收到礼金' : '已记录送出礼金'),
        icon: 'none',
      })
      this.setData({
        giftContactName: '',
        giftContactRelation: '',
        giftTitle: '',
        giftAmount: '',
        giftNote: '',
        giftLedgerEditingId: '',
        giftLedgerKind: kind,
        giftLedgerSaveLabel: this.data.giftLedgerDirection === 'received' ? '保存收礼记录' : '保存送礼记录',
        giftLedgerFormVisible: false,
        giftKeyboardHeight: 0,
      })
      this.loadRecords()
    },

    selectMood(event: WechatMiniprogram.BaseEvent) {
      const mood = String(event.currentTarget.dataset.mood || 'happy') as MoodType
      const option = MOOD_OPTIONS.find((item) => item.mood === mood) || MOOD_OPTIONS[0]

      this.setData({
        activeMood: option.mood,
        activeMoodPrompt: option.prompt,
      })
    },

    onMoodNoteInput(event: WechatMiniprogram.Input) {
      this.setData({ moodNote: String(event.detail.value || '').slice(0, 300) })
    },

    addMoodFromForm() {
      addMoodRecord({
        mood: this.data.activeMood as MoodType,
        note: this.data.moodNote,
      })
      this.setData({ moodNote: '' })
      this.loadRecords()
      wx.showToast({ title: '已记录心情', icon: 'none' })
    },

  },
})
