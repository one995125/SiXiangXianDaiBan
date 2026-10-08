import {
  GiftBook,
  GiftContact,
  GiftExchangeBook,
  GiftExchangeContact,
  GiftExchangeDirection,
  GiftExchangeEntryKind,
  GiftExchangeRecord,
  GiftRecord,
} from '../services/gift-mood-service'

export type GiftLedgerKind = 'happy' | 'sad'
export type GiftLedgerTone = 'rose' | 'blue' | 'mint' | 'violet' | 'amber' | 'peach'

const GIFT_LEDGER_TONES: GiftLedgerTone[] = ['rose', 'blue', 'mint', 'violet', 'amber', 'peach']
const DEFAULT_GIFT_AVATAR = '🎁'

export interface GiftLedgerRow {
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

export interface GiftLedgerSummaryCard {
  kind: GiftLedgerKind
  iconAsset: string
  label: string
  directionLabel: string
  amountText: string
  count: number
  names: string[]
  isActive: boolean
}

export interface GiftExchangeRecordView {
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

export interface GiftExchangeContactView {
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

export function formatGiftLedgerAmount(amount: number): string {
  const safeAmount = Math.max(0, Number(amount || 0))
  return `¥${Number.isInteger(safeAmount) ? safeAmount : safeAmount.toFixed(2)}`
}

function getSortTime(dateText: string, fallback: number): number {
  const parsedTime = new Date(dateText.replace(/-/g, '/')).getTime()
  return Number.isFinite(parsedTime) ? parsedTime : fallback || 0
}

function getGiftLedgerTone(seed: string): GiftLedgerTone {
  const hash = String(seed || '').split('').reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 0)
  return GIFT_LEDGER_TONES[hash % GIFT_LEDGER_TONES.length]
}

function getGiftLedgerKind(gift: GiftRecord): GiftLedgerKind {
  const text = `${gift.title} ${gift.occasion} ${gift.note}`.toLowerCase()
  const sadKeywords = ['憾', '白事', '丧', '悼', '吊', '祭', '殡', '忌', '帛金', '慰问']
  return sadKeywords.some((keyword) => text.includes(keyword)) ? 'sad' : 'happy'
}

function toGiftLedgerRow(contact: GiftContact, gift: GiftRecord): GiftLedgerRow {
  const kind = getGiftLedgerKind(gift)
  const amount = Math.max(0, Number(gift.amount || 0))
  return {
    id: gift.id,
    anchorId: `gift-ledger-${String(gift.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    title: `${contact.name}${gift.title || ''}`,
    amount,
    amountText: formatGiftLedgerAmount(amount),
    date: gift.date,
    note: gift.note || '',
    kind,
    kindLabel: kind === 'happy' ? '喜事' : '憾事',
    direction: gift.direction,
    directionText: gift.direction === 'sent' ? '我送出' : '我收到',
    toneClass: getGiftLedgerTone(gift.id),
    sortTime: getSortTime(gift.date, gift.createdAt),
  }
}

/** 礼金列表、搜索与分类统一使用同一份排序后的视图数据。 */
export function buildAllGiftLedgerRows(book: GiftBook): GiftLedgerRow[] {
  return book.contacts.reduce<GiftLedgerRow[]>((result, contact) => {
    return result.concat(contact.gifts.map((gift) => toGiftLedgerRow(contact, gift)))
  }, []).sort((first, second) => second.sortTime - first.sortTime)
}

export function buildGiftLedgerView(
  book: GiftBook,
  activeKind: GiftLedgerKind,
  activeDirection: GiftExchangeDirection,
): { cards: GiftLedgerSummaryCard[]; rows: GiftLedgerRow[] } {
  const allRows = buildAllGiftLedgerRows(book)
  const cards = (['happy', 'sad'] as GiftLedgerKind[]).map((kind) => {
    const rows = allRows.filter((row) => row.kind === kind && row.direction === activeDirection)
    return {
      kind,
      iconAsset: kind === 'happy' ? '/assets/ui-icons/gift-happy.png' : '/assets/ui-icons/gift-sad.png',
      label: kind === 'happy' ? '喜事' : '憾事',
      directionLabel: activeDirection === 'received' ? '收到' : '送出',
      amountText: formatGiftLedgerAmount(rows.reduce((sum, row) => sum + row.amount, 0)),
      count: rows.length,
      names: rows.slice(0, 3).map((row) => row.title),
      isActive: kind === activeKind,
    }
  })
  return {
    cards,
    rows: allRows.filter((row) => row.kind === activeKind && row.direction === activeDirection),
  }
}

function toGiftExchangeRecordView(record: GiftExchangeRecord): GiftExchangeRecordView {
  return {
    id: record.id,
    direction: record.direction,
    directionText: record.direction === 'sent' ? '送出' : '收到',
    entryKind: record.entryKind === 'cash' ? 'cash' : 'gift',
    entryKindText: record.entryKind === 'cash' ? '礼金' : '礼物',
    giftName: record.giftName,
    date: record.date,
    amountText: record.hasAmount ? formatGiftLedgerAmount(record.amount) : '',
    note: record.note,
    sortTime: getSortTime(record.date, record.createdAt),
  }
}

function formatGiftExchangeTotalAmount(records: GiftExchangeRecord[]): string {
  const totalAmount = records.reduce((sum, record) => sum + (record.hasAmount ? record.amount : 0), 0)
  return totalAmount > 0 ? formatGiftLedgerAmount(totalAmount) : '未填金额'
}

function toGiftExchangeContactView(contact: GiftExchangeContact): GiftExchangeContactView {
  const records = contact.records.map(toGiftExchangeRecordView).sort((first, second) => second.sortTime - first.sortTime)
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
    receivedAmountText: formatGiftExchangeTotalAmount(receivedRecords),
    sentAmountText: formatGiftExchangeTotalAmount(sentRecords),
    records,
  }
}

export function buildGiftExchangeView(book: GiftExchangeBook, selectedContactId: string): {
  contacts: GiftExchangeContactView[]
  selectedContact: GiftExchangeContactView | null
  rows: GiftExchangeRecordView[]
} {
  const contacts = book.contacts.map(toGiftExchangeContactView).sort((first, second) => {
    const firstTime = first.records.length ? first.records[0].sortTime : 0
    const secondTime = second.records.length ? second.records[0].sortTime : 0
    return secondTime - firstTime
  })
  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) || null
  return { contacts, selectedContact, rows: selectedContact ? selectedContact.records : [] }
}
