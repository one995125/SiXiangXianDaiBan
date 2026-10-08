import { GIFT_BOOK_STORAGE_KEY, GIFT_EXCHANGE_STORAGE_KEY, MOOD_RECORD_STORAGE_KEY } from '../constants/remember'
import { scheduleUserDataCloudSync } from './cloud-sync-service'

export type GiftDirection = 'sent' | 'received'
export type GiftExchangeDirection = 'received' | 'sent'
export type GiftExchangeEntryKind = 'cash' | 'gift'
export type MoodType = 'happy' | 'calm' | 'tired' | 'stressed' | 'sad'

export interface GiftRecord {
  id: string
  direction: GiftDirection
  title: string
  occasion: string
  date: string
  amount: number
  note: string
  createdAt: number
  updatedAt: number
}

export interface GiftContact {
  id: string
  name: string
  relation: string
  avatar: string
  birthday: string
  wishes: string[]
  note: string
  gifts: GiftRecord[]
  createdAt: number
  updatedAt: number
}

export interface GiftBook {
  contacts: GiftContact[]
  /** 跨设备合并用的删除凭证，避免另一台设备把已删除礼金重新带回。 */
  deletedGiftIds: string[]
  updatedAt: number
}

export interface GiftBookSummary {
  sentCount: number
  receivedCount: number
  totalAmount: number
  sentAmount: number
  receivedAmount: number
  contactCount: number
}

export interface GiftExchangeRecord {
  id: string
  direction: GiftExchangeDirection
  entryKind?: GiftExchangeEntryKind
  giftName: string
  date: string
  amount: number
  hasAmount: boolean
  note: string
  sourceGiftId: string
  createdAt: number
  updatedAt: number
}

export interface GiftExchangeContact {
  id: string
  name: string
  relation: string
  avatar: string
  records: GiftExchangeRecord[]
  createdAt: number
  updatedAt: number
}

export interface GiftExchangeBook {
  contacts: GiftExchangeContact[]
  migratedGiftIds: string[]
  /** 独立往来记录的删除凭证；礼簿镜像删除也会同步记录。 */
  deletedRecordIds: string[]
  updatedAt: number
}

export interface GiftExchangeSummary {
  sentCount: number
  receivedCount: number
  totalCount: number
  sentAmount: number
  receivedAmount: number
  totalAmount: number
  contactCount: number
}

export interface MoodRecord {
  id: string
  mood: MoodType
  label: string
  emoji: string
  color: string
  note: string
  createdAt: number
  date: string
}

export interface MoodDraft {
  mood: MoodType
  note: string
}

export const MOOD_OPTIONS: Array<{ mood: MoodType; label: string; emoji: string; color: string; prompt: string }> = [
  { mood: 'happy', label: '开心', emoji: '😊', color: 'rose', prompt: '是什么让你感到此刻的心情？' },
  { mood: 'calm', label: '还不错', emoji: '🙂', color: 'mint', prompt: '是什么让你感到此刻的心情？' },
  { mood: 'tired', label: '平常', emoji: '😌', color: 'blue', prompt: '是什么让你感到此刻的心情？' },
  { mood: 'stressed', label: '有点低落', emoji: '😕', color: 'amber', prompt: '是什么让你感到此刻的心情？' },
  { mood: 'sad', label: '难过', emoji: '😔', color: 'violet', prompt: '是什么让你感到此刻的心情？' },
]

const MAX_CONTACT_COUNT = 100
const MAX_GIFT_COUNT_PER_CONTACT = 200
const MAX_GIFT_EXCHANGE_CONTACT_COUNT = 100
const MAX_GIFT_EXCHANGE_RECORD_COUNT_PER_CONTACT = 300
const MAX_MIGRATED_GIFT_ID_COUNT = 1000
const MAX_DELETED_ENTRY_ID_COUNT = 2000
const MAX_MOOD_COUNT = 500

export function createEmptyGiftBook(): GiftBook {
  return {
    contacts: [],
    deletedGiftIds: [],
    updatedAt: Date.now(),
  }
}

export function loadGiftBook(): GiftBook {
  return normalizeGiftBook(wx.getStorageSync(GIFT_BOOK_STORAGE_KEY))
}

export function saveGiftBook(book: GiftBook): GiftBook {
  const normalized = normalizeGiftBook(book)
  wx.setStorageSync(GIFT_BOOK_STORAGE_KEY, normalized)
  scheduleUserDataCloudSync()
  return normalized
}

export function buildGiftBookSummary(book = loadGiftBook()): GiftBookSummary {
  const gifts = book.contacts.reduce<GiftRecord[]>((result, contact) => result.concat(contact.gifts), [])
  const sentGifts = gifts.filter((gift) => gift.direction === 'sent')
  const receivedGifts = gifts.filter((gift) => gift.direction === 'received')
  const sentAmount = sentGifts.reduce((sum, gift) => sum + gift.amount, 0)
  const receivedAmount = receivedGifts.reduce((sum, gift) => sum + gift.amount, 0)
  return {
    sentCount: sentGifts.length,
    receivedCount: receivedGifts.length,
    totalAmount: sentAmount + receivedAmount,
    sentAmount,
    receivedAmount,
    contactCount: book.contacts.length,
  }
}

export function buildGiftExchangeSummary(book = loadGiftExchangeBook()): GiftExchangeSummary {
  const records = book.contacts.reduce<GiftExchangeRecord[]>((result, contact) => result.concat(contact.records), [])
  const sentRecords = records.filter((record) => record.direction === 'sent')
  const receivedRecords = records.filter((record) => record.direction === 'received')
  const sentAmount = sentRecords.reduce((sum, record) => sum + (record.hasAmount ? record.amount : 0), 0)
  const receivedAmount = receivedRecords.reduce((sum, record) => sum + (record.hasAmount ? record.amount : 0), 0)

  return {
    sentCount: sentRecords.length,
    receivedCount: receivedRecords.length,
    totalCount: records.length,
    sentAmount,
    receivedAmount,
    totalAmount: sentAmount + receivedAmount,
    contactCount: book.contacts.length,
  }
}

export function createEmptyGiftExchangeBook(): GiftExchangeBook {
  return {
    contacts: [],
    migratedGiftIds: [],
    deletedRecordIds: [],
    updatedAt: Date.now(),
  }
}

/**
 * 读取双向往来账。
 *
 * 调用时机：记录页进入“往来记录”子模块、云端快照回填后刷新。
 * 注意：每次读取都会幂等补齐礼金账本镜像，历史送出和收到记录都以 sourceGiftId 去重。
 */
export function loadGiftExchangeBook(): GiftExchangeBook {
  const book = normalizeGiftExchangeBook(wx.getStorageSync(GIFT_EXCHANGE_STORAGE_KEY))
  return migrateGiftsToExchangeBook(book, loadGiftBook())
}

export function saveGiftExchangeBook(book: GiftExchangeBook): GiftExchangeBook {
  const normalized = normalizeGiftExchangeBook(book)
  wx.setStorageSync(GIFT_EXCHANGE_STORAGE_KEY, normalized)
  scheduleUserDataCloudSync()
  return normalized
}

export function addGiftExchangeContact(input: Partial<GiftExchangeContact>): GiftExchangeContact {
  const now = Date.now()
  const contact: GiftExchangeContact = {
    id: createLocalId('gift_exchange_contact', now),
    name: normalizeText(input.name, 20) || '未命名',
    relation: normalizeText(input.relation, 12),
    avatar: normalizeText(input.avatar, 2) || '🎁',
    records: [],
    createdAt: now,
    updatedAt: now,
  }
  const book = loadGiftExchangeBook()

  saveGiftExchangeBook({
    ...book,
    contacts: [contact].concat(book.contacts).slice(0, MAX_GIFT_EXCHANGE_CONTACT_COUNT),
    updatedAt: now,
  })
  return contact
}

/**
 * 给某个联系人新增一条往来记录。
 *
 * 参数 contactId 是联系人 id；entryKind 区分礼金和普通礼物。
 * 注意：普通礼物金额可不填；礼金建议填写金额，但仍允许用户稍后补录。
 */
export function addGiftExchangeRecord(contactId: string, input: Partial<GiftExchangeRecord>): GiftExchangeRecord | null {
  const now = Date.now()
  const book = loadGiftExchangeBook()
  const target = book.contacts.find((contact) => contact.id === contactId)

  if (!target) {
    return null
  }

  if (input.entryKind === 'cash' && !normalizeText(input.sourceGiftId, 100)) {
    // 从“往来记录”新增礼金时，礼金账本仍是唯一主数据源。
    // 先按姓名与关系找到（或创建）账本联系人，再由 addGiftRecord
    // 自动生成带 sourceGiftId 的时间线镜像，避免形成不可联动的现金孤立记录。
    const giftBook = loadGiftBook()
    const giftContact = giftBook.contacts.find(
      (contact) => contact.name === target.name && contact.relation === target.relation,
    ) || addGiftContact({
      name: target.name,
      relation: target.relation,
    })
    const gift = addGiftRecord(giftContact.id, {
      direction: input.direction === 'sent' ? 'sent' : 'received',
      title: normalizeText(input.giftName, 30) || '礼金',
      occasion: '往来',
      date: normalizeDate(input.date) || formatDate(),
      amount: normalizeAmount(input.amount),
      note: normalizeText(input.note, 200),
    })

    if (!gift) {
      return null
    }

    return loadGiftExchangeBook().contacts
      .reduce<GiftExchangeRecord[]>((result, contact) => result.concat(contact.records), [])
      .find((record) => record.sourceGiftId === gift.id) || null
  }

  const amount = normalizeAmount(input.amount)
  const hasAmount = typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0
  const record: GiftExchangeRecord = {
    id: createLocalId('gift_exchange', now),
    direction: input.direction === 'sent' ? 'sent' : 'received',
    entryKind: input.entryKind === 'cash' ? 'cash' : 'gift',
    giftName: normalizeText(input.giftName, 30) || (input.entryKind === 'cash' ? '礼金' : '一份礼物'),
    date: normalizeDate(input.date) || formatDate(),
    amount: hasAmount ? amount : 0,
    hasAmount,
    note: normalizeText(input.note, 200),
    sourceGiftId: normalizeText(input.sourceGiftId, 100),
    createdAt: now,
    updatedAt: now,
  }

  saveGiftExchangeBook({
    ...book,
    contacts: book.contacts.map((contact) =>
      contact.id === contactId
        ? {
            ...contact,
            records: [record].concat(contact.records).slice(0, MAX_GIFT_EXCHANGE_RECORD_COUNT_PER_CONTACT),
            updatedAt: now,
          }
        : contact,
    ),
    updatedAt: now,
  })
  return record
}

export function removeGiftExchangeRecord(recordId: string): boolean {
  const safeRecordId = normalizeText(recordId, 100)

  if (!safeRecordId) {
    return false
  }

  const now = Date.now()
  const book = loadGiftExchangeBook()
  const linkedRecord = book.contacts
    .reduce<GiftExchangeRecord[]>((result, contact) => result.concat(contact.records), [])
    .find((record) => record.id === safeRecordId)

  // 礼金镜像从往来时间线删除时，以礼金账本为主记录同步删除，避免下次读取再次导入。
  if (linkedRecord?.sourceGiftId) {
    return removeGiftRecord(linkedRecord.sourceGiftId)
  }

  let removed = false
  const contacts = book.contacts.map((contact) => {
    const records = contact.records.filter((record) => record.id !== safeRecordId)

    if (records.length === contact.records.length) {
      return contact
    }

    removed = true
    return {
      ...contact,
      records,
      updatedAt: now,
    }
  })

  if (!removed) {
    return false
  }

  saveGiftExchangeBook({
    ...book,
    contacts,
    deletedRecordIds: uniqueStrings(book.deletedRecordIds.concat(safeRecordId)).slice(-MAX_DELETED_ENTRY_ID_COUNT),
    updatedAt: now,
  })
  return true
}

/**
 * 新增礼簿联系人。
 *
 * 调用时机：记录页礼簿子标签的“添加联系人”表单提交后。
 * 注意：只写本地 storage，并通过 cloud-sync-service 标记 dirtyAt 走统一云同步。
 */
export function addGiftContact(input: Partial<GiftContact>): GiftContact {
  const now = Date.now()
  const contact: GiftContact = {
    id: createLocalId('gift_contact', now),
    name: normalizeText(input.name, 20) || '未命名',
    relation: normalizeText(input.relation, 12) || '联系人',
    avatar: normalizeText(input.avatar, 2) || '🎁',
    birthday: normalizeDate(input.birthday),
    wishes: normalizeWishList(input.wishes),
    note: normalizeText(input.note, 200),
    gifts: [],
    createdAt: now,
    updatedAt: now,
  }
  const book = loadGiftBook()
  saveGiftBook({
    ...book,
    contacts: [contact].concat(book.contacts).slice(0, MAX_CONTACT_COUNT),
    updatedAt: now,
  })
  return contact
}

/**
 * 给指定联系人新增送礼/收礼记录。
 *
 * 参数 contactId 是联系人 id；direction 只能是 sent 或 received。
 * 注意：金额只作为用户自填本地数据保存，不做支付或交易处理。
 */
export function addGiftRecord(contactId: string, input: Partial<GiftRecord>): GiftRecord | null {
  const now = Date.now()
  const book = loadGiftBook()
  const target = book.contacts.find((contact) => contact.id === contactId)

  if (!target) {
    return null
  }

  const gift: GiftRecord = {
    id: createLocalId('gift', now),
    direction: input.direction === 'received' ? 'received' : 'sent',
    title: normalizeText(input.title, 30) || '一份礼物',
    occasion: normalizeText(input.occasion, 20) || '日常',
    date: normalizeDate(input.date) || formatDate(),
    amount: normalizeAmount(input.amount),
    note: normalizeText(input.note, 200),
    createdAt: now,
    updatedAt: now,
  }

  const savedBook = saveGiftBook({
    ...book,
    contacts: book.contacts.map((contact) =>
      contact.id === contactId
        ? {
            ...contact,
            gifts: [gift].concat(contact.gifts).slice(0, MAX_GIFT_COUNT_PER_CONTACT),
            updatedAt: now,
          }
        : contact,
    ),
    updatedAt: now,
  })

  // 礼金账本是现金往来的主数据源。保存成功后立即生成对应往来镜像，
  // 这样其他页面或未来新增入口无需依赖“重新打开记录页”才能看到时间线。
  migrateGiftsToExchangeBook(
    normalizeGiftExchangeBook(wx.getStorageSync(GIFT_EXCHANGE_STORAGE_KEY)),
    savedBook,
  )
  return gift
}

/**
 * 修改一条礼金账本记录，并同步重建其联系人往来镜像。
 *
 * 参数 giftId 是原记录 id；targetContactId 是修改后所属联系人；input 是表单新值。
 * 注意：保留 id、createdAt 和 sourceGiftId 关联，避免编辑后在往来时间线中生成重复账目。
 */
export function updateGiftRecord(
  giftId: string,
  targetContactId: string,
  input: Partial<GiftRecord>,
): GiftRecord | null {
  const safeGiftId = normalizeText(giftId, 100)
  const safeContactId = normalizeText(targetContactId, 100)
  const book = loadGiftBook()
  const target = book.contacts.find((contact) => contact.id === safeContactId)
  // 不依赖 Array.prototype.flatMap，兼容基础库 2.21.0+ 的低版本 JS 运行环境。
  let original: GiftRecord | undefined
  let originalContactId = ''
  for (let contactIndex = 0; contactIndex < book.contacts.length && !original; contactIndex += 1) {
    const contact = book.contacts[contactIndex]
    original = contact.gifts.find((gift) => gift.id === safeGiftId)
    if (original) {
      originalContactId = contact.id
    }
  }

  if (!safeGiftId || !target || !original) {
    return null
  }

  const now = Date.now()
  const updatedGift: GiftRecord = {
    id: original.id,
    direction: input.direction === 'received' ? 'received' : 'sent',
    title: normalizeText(input.title, 30) || '一份礼物',
    occasion: normalizeText(input.occasion, 20) || '日常',
    date: normalizeDate(input.date) || formatDate(),
    amount: normalizeAmount(input.amount),
    note: normalizeText(input.note, 200),
    createdAt: original.createdAt,
    updatedAt: now,
  }

  const contacts = book.contacts.map((contact) => {
    const giftsWithoutOriginal = contact.gifts.filter((gift) => gift.id !== safeGiftId)
    const gifts = contact.id === safeContactId
      ? [updatedGift].concat(giftsWithoutOriginal).slice(0, MAX_GIFT_COUNT_PER_CONTACT)
      : giftsWithoutOriginal
    const changed = gifts.length !== contact.gifts.length
      || contact.id === safeContactId
      || contact.gifts.some((gift) => gift.id === safeGiftId)

    return changed ? { ...contact, gifts, updatedAt: now } : contact
  }).filter((contact) => {
    // 编辑联系人后，只清理被迁空的原联系人；其他已有空联系人保持不动，避免扩大修改范围。
    return contact.id !== originalContactId
      || contact.id === safeContactId
      || contact.gifts.length > 0
  })
  const savedBook = saveGiftBook({ ...book, contacts, updatedAt: now })

  // 先精确删除旧镜像及迁移标记，再由同一个迁移函数按新字段重建。
  removeGiftExchangeRecordsBySourceGiftId(safeGiftId)
  migrateGiftsToExchangeBook(
    normalizeGiftExchangeBook(wx.getStorageSync(GIFT_EXCHANGE_STORAGE_KEY)),
    savedBook,
  )
  return updatedGift
}

/**
 * 删除一条礼簿记录。
 *
 * 参数 giftId 是礼簿记录 id，不接收联系人 id，便于列表行直接删除。
 * 注意：删除后同步清理 sourceGiftId 精确关联的往来镜像；不删除无法确认来源的历史记录。
 */
export function removeGiftRecord(giftId: string): boolean {
  const safeGiftId = normalizeText(giftId, 100)

  if (!safeGiftId) {
    return false
  }

  const now = Date.now()
  const book = loadGiftBook()
  let removed = false
  const contacts = book.contacts.map((contact) => {
    const gifts = contact.gifts.filter((gift) => gift.id !== safeGiftId)

    if (gifts.length === contact.gifts.length) {
      return contact
    }

    removed = true
    return {
      ...contact,
      gifts,
      updatedAt: now,
    }
  })

  if (!removed) {
    return false
  }

  saveGiftBook({
    ...book,
    contacts,
    deletedGiftIds: uniqueStrings(book.deletedGiftIds.concat(safeGiftId)).slice(-MAX_DELETED_ENTRY_ID_COUNT),
    updatedAt: now,
  })
  removeGiftExchangeRecordsBySourceGiftId(safeGiftId)
  return true
}

/**
 * 删除某条礼金账本记录对应的往来镜像。
 *
 * 只匹配 sourceGiftId，避免误删同名、同金额或同一天的独立往来记录。
 */
function removeGiftExchangeRecordsBySourceGiftId(sourceGiftId: string): void {
  const storedBook = normalizeGiftExchangeBook(wx.getStorageSync(GIFT_EXCHANGE_STORAGE_KEY))
  let changed = false
  const now = Date.now()
  const deletedRecordIds: string[] = []
  const contacts = storedBook.contacts.map((contact) => {
    contact.records.forEach((record) => {
      if (record.sourceGiftId === sourceGiftId) deletedRecordIds.push(record.id)
    })
    const records = contact.records.filter((record) => record.sourceGiftId !== sourceGiftId)
    if (records.length === contact.records.length) {
      return contact
    }
    changed = true
    return {
      ...contact,
      records,
      updatedAt: now,
    }
  })

  if (!changed) {
    return
  }

  saveGiftExchangeBook({
    ...storedBook,
    contacts,
    migratedGiftIds: storedBook.migratedGiftIds.filter((id) => id !== sourceGiftId),
    deletedRecordIds: uniqueStrings(storedBook.deletedRecordIds.concat(deletedRecordIds)).slice(-MAX_DELETED_ENTRY_ID_COUNT),
    updatedAt: now,
  })
}

export function loadMoodRecords(): MoodRecord[] {
  return normalizeMoodRecords(wx.getStorageSync(MOOD_RECORD_STORAGE_KEY))
}

export function saveMoodRecords(records: MoodRecord[]): MoodRecord[] {
  const normalized = normalizeMoodRecords(records)
  wx.setStorageSync(MOOD_RECORD_STORAGE_KEY, normalized)
  scheduleUserDataCloudSync()
  return normalized
}

/**
 * 写入一条心情记录。
 *
 * 调用时机：记录页心情子标签“完成记录”后。
 * 注意：不读取用户隐私资料，只保存用户主动输入的情绪和文本。
 */
export function addMoodRecord(draft: MoodDraft): MoodRecord {
  const now = Date.now()
  const option = getMoodOption(draft.mood)
  const record: MoodRecord = {
    id: createLocalId('mood', now),
    mood: option.mood,
    label: option.label,
    emoji: option.emoji,
    color: option.color,
    note: normalizeText(draft.note, 300),
    createdAt: now,
    date: formatDate(new Date(now)),
  }
  saveMoodRecords([record].concat(loadMoodRecords()).slice(0, MAX_MOOD_COUNT))
  return record
}

export function getMoodOption(mood: MoodType) {
  return MOOD_OPTIONS.find((option) => option.mood === mood) || MOOD_OPTIONS[0]
}

export function normalizeGiftBook(rawBook: unknown): GiftBook {
  if (!rawBook || typeof rawBook !== 'object' || Array.isArray(rawBook)) {
    return createEmptyGiftBook()
  }

  const book = rawBook as Partial<GiftBook>
  const contacts = Array.isArray(book.contacts)
    ? book.contacts.map(normalizeGiftContact).filter((contact): contact is GiftContact => Boolean(contact))
    : []

  return {
    contacts: contacts.slice(0, MAX_CONTACT_COUNT),
    deletedGiftIds: normalizeStringList(book.deletedGiftIds, MAX_DELETED_ENTRY_ID_COUNT, 100),
    updatedAt: typeof book.updatedAt === 'number' && book.updatedAt > 0 ? book.updatedAt : Date.now(),
  }
}

export function normalizeGiftExchangeBook(rawBook: unknown): GiftExchangeBook {
  if (!rawBook || typeof rawBook !== 'object' || Array.isArray(rawBook)) {
    return createEmptyGiftExchangeBook()
  }

  const book = rawBook as Partial<GiftExchangeBook>
  const contacts = Array.isArray(book.contacts)
    ? book.contacts.map(normalizeGiftExchangeContact).filter((contact): contact is GiftExchangeContact => Boolean(contact))
    : []

  return {
    contacts: contacts.slice(0, MAX_GIFT_EXCHANGE_CONTACT_COUNT),
    migratedGiftIds: normalizeStringList(book.migratedGiftIds, MAX_MIGRATED_GIFT_ID_COUNT, 100),
    deletedRecordIds: normalizeStringList(book.deletedRecordIds, MAX_DELETED_ENTRY_ID_COUNT, 100),
    updatedAt: typeof book.updatedAt === 'number' && book.updatedAt > 0 ? book.updatedAt : Date.now(),
  }
}

export function normalizeMoodRecords(rawRecords: unknown): MoodRecord[] {
  if (!Array.isArray(rawRecords)) {
    return []
  }

  return rawRecords
    .map(normalizeMoodRecord)
    .filter((record): record is MoodRecord => Boolean(record))
    .sort((first, second) => second.createdAt - first.createdAt)
    .slice(0, MAX_MOOD_COUNT)
}

function normalizeGiftContact(rawContact: unknown): GiftContact | null {
  if (!rawContact || typeof rawContact !== 'object' || Array.isArray(rawContact)) {
    return null
  }

  const contact = rawContact as Partial<GiftContact>
  const name = normalizeText(contact.name, 20)
  const now = Date.now()

  if (!name) {
    return null
  }

  return {
    id: normalizeText(contact.id, 100) || createLocalId('gift_contact', now),
    name,
    relation: normalizeText(contact.relation, 12) || '联系人',
    avatar: normalizeText(contact.avatar, 2) || '🎁',
    birthday: normalizeDate(contact.birthday),
    wishes: normalizeWishList(contact.wishes),
    note: normalizeText(contact.note, 200),
    gifts: Array.isArray(contact.gifts)
      ? contact.gifts.map(normalizeGiftRecord).filter((gift): gift is GiftRecord => Boolean(gift)).slice(0, MAX_GIFT_COUNT_PER_CONTACT)
      : [],
    createdAt: typeof contact.createdAt === 'number' && contact.createdAt > 0 ? contact.createdAt : now,
    updatedAt: typeof contact.updatedAt === 'number' && contact.updatedAt > 0 ? contact.updatedAt : now,
  }
}

function normalizeGiftRecord(rawGift: unknown): GiftRecord | null {
  if (!rawGift || typeof rawGift !== 'object' || Array.isArray(rawGift)) {
    return null
  }

  const gift = rawGift as Partial<GiftRecord>
  const title = normalizeText(gift.title, 30)
  const now = Date.now()

  if (!title) {
    return null
  }

  return {
    id: normalizeText(gift.id, 100) || createLocalId('gift', now),
    direction: gift.direction === 'received' ? 'received' : 'sent',
    title,
    occasion: normalizeText(gift.occasion, 20) || '日常',
    date: normalizeDate(gift.date) || formatDate(),
    amount: normalizeAmount(gift.amount),
    note: normalizeText(gift.note, 200),
    createdAt: typeof gift.createdAt === 'number' && gift.createdAt > 0 ? gift.createdAt : now,
    updatedAt: typeof gift.updatedAt === 'number' && gift.updatedAt > 0
      ? gift.updatedAt
      : typeof gift.createdAt === 'number' && gift.createdAt > 0 ? gift.createdAt : now,
  }
}

function normalizeMoodRecord(rawRecord: unknown): MoodRecord | null {
  if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
    return null
  }

  const record = rawRecord as Partial<MoodRecord>
  const option = getMoodOption(record.mood || 'happy')
  const createdAt = typeof record.createdAt === 'number' && record.createdAt > 0 ? record.createdAt : Date.now()

  return {
    id: normalizeText(record.id, 100) || createLocalId('mood', createdAt),
    mood: option.mood,
    label: option.label,
    emoji: option.emoji,
    color: option.color,
    note: normalizeText(record.note, 300),
    createdAt,
    date: normalizeDate(record.date) || formatDate(new Date(createdAt)),
  }
}

function normalizeGiftExchangeContact(rawContact: unknown): GiftExchangeContact | null {
  if (!rawContact || typeof rawContact !== 'object' || Array.isArray(rawContact)) {
    return null
  }

  const contact = rawContact as Partial<GiftExchangeContact>
  const name = normalizeText(contact.name, 20)
  const now = Date.now()

  if (!name) {
    return null
  }

  return {
    id: normalizeText(contact.id, 100) || createLocalId('gift_exchange_contact', now),
    name,
    relation: normalizeText(contact.relation, 12),
    avatar: normalizeText(contact.avatar, 2) || '🎁',
    records: Array.isArray(contact.records)
      ? contact.records
          .map(normalizeGiftExchangeRecord)
          .filter((record): record is GiftExchangeRecord => Boolean(record))
          .sort((first, second) => getDateSortTime(second.date, second.createdAt) - getDateSortTime(first.date, first.createdAt))
          .slice(0, MAX_GIFT_EXCHANGE_RECORD_COUNT_PER_CONTACT)
      : [],
    createdAt: typeof contact.createdAt === 'number' && contact.createdAt > 0 ? contact.createdAt : now,
    updatedAt: typeof contact.updatedAt === 'number' && contact.updatedAt > 0 ? contact.updatedAt : now,
  }
}

function normalizeGiftExchangeRecord(rawRecord: unknown): GiftExchangeRecord | null {
  if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
    return null
  }

  const record = rawRecord as Partial<GiftExchangeRecord>
  const giftName = normalizeText(record.giftName, 30)
  const now = Date.now()

  if (!giftName) {
    return null
  }

  const amount = normalizeAmount(record.amount)
  const hasAmount = Boolean(record.hasAmount && amount > 0)

  return {
    id: normalizeText(record.id, 100) || createLocalId('gift_exchange', now),
    direction: record.direction === 'sent' ? 'sent' : 'received',
    entryKind: record.entryKind === 'cash' || Boolean(record.sourceGiftId) ? 'cash' : 'gift',
    giftName,
    date: normalizeDate(record.date) || formatDate(),
    amount: hasAmount ? amount : 0,
    hasAmount,
    note: normalizeText(record.note, 200),
    sourceGiftId: normalizeText(record.sourceGiftId, 100),
    createdAt: typeof record.createdAt === 'number' && record.createdAt > 0 ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'number' && record.updatedAt > 0
      ? record.updatedAt
      : typeof record.createdAt === 'number' && record.createdAt > 0 ? record.createdAt : now,
  }
}

function normalizeWishList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeStringList(value, 8, 20)
  }

  if (typeof value === 'string') {
    return value
      .split(/[，,、\n]/)
      .map((item) => normalizeText(item, 20))
      .filter(Boolean)
      .slice(0, 8)
  }

  return []
}

function migrateGiftsToExchangeBook(book: GiftExchangeBook, giftBook: GiftBook): GiftExchangeBook {
  let changed = false
  const contacts = book.contacts.map((contact) => ({
    ...contact,
    records: contact.records.slice(),
  }))
  const migratedGiftIds = book.migratedGiftIds.slice()

  giftBook.contacts.forEach((giftContact) => {
    giftContact.gifts
      .forEach((gift) => {
        if (!gift.id) {
          return
        }

        const alreadyMigrated = migratedGiftIds.includes(gift.id) || contacts.some((contact) =>
          contact.records.some((record) => record.sourceGiftId === gift.id),
        )

        if (alreadyMigrated) {
          if (!migratedGiftIds.includes(gift.id)) {
            migratedGiftIds.push(gift.id)
            changed = true
          }
          return
        }

        const now = Date.now()
        const contactIndex = findGiftExchangeContactIndex(contacts, giftContact.name, giftContact.relation)
        const nextRecord: GiftExchangeRecord = {
          id: `gift_exchange_${gift.id}`,
          direction: gift.direction,
          entryKind: 'cash',
          giftName: gift.title,
          date: gift.date,
          amount: gift.amount > 0 ? gift.amount : 0,
          hasAmount: gift.amount > 0,
          note: gift.note || gift.occasion,
          sourceGiftId: gift.id,
          createdAt: gift.createdAt || now,
          updatedAt: gift.updatedAt || gift.createdAt || now,
        }

        if (contactIndex >= 0) {
          const target = contacts[contactIndex]
          contacts[contactIndex] = {
            ...target,
            records: [nextRecord].concat(target.records).slice(0, MAX_GIFT_EXCHANGE_RECORD_COUNT_PER_CONTACT),
            updatedAt: now,
          }
        } else {
          contacts.unshift({
            id: `gift_exchange_contact_${giftContact.id}`,
            name: giftContact.name,
            relation: giftContact.relation,
            avatar: giftContact.avatar || '🎁',
            records: [nextRecord],
            createdAt: giftContact.createdAt || now,
            updatedAt: now,
          })
        }

        migratedGiftIds.push(gift.id)
        changed = true
      })
  })

  if (!changed) {
    return book
  }

  return saveGiftExchangeBook({
    ...book,
    contacts: contacts.slice(0, MAX_GIFT_EXCHANGE_CONTACT_COUNT),
    migratedGiftIds: uniqueStrings(migratedGiftIds).slice(0, MAX_MIGRATED_GIFT_ID_COUNT),
    updatedAt: Date.now(),
  })
}

function findGiftExchangeContactIndex(contacts: GiftExchangeContact[], name: string, relation: string): number {
  const normalizedName = normalizeText(name, 20)
  const normalizedRelation = normalizeText(relation, 12)
  const exactIndex = contacts.findIndex(
    (contact) => contact.name === normalizedName && contact.relation === normalizedRelation,
  )
  if (exactIndex >= 0) {
    return exactIndex
  }

  const sameNameIndexes = contacts.reduce<number[]>((result, contact, index) => {
    if (contact.name === normalizedName) {
      result.push(index)
    }
    return result
  }, [])

  // 同名仅有一个候选时可安全复用；多个同名联系人保持独立，避免错误串账。
  return sameNameIndexes.length === 1 ? sameNameIndexes[0] : -1
}

function normalizeStringList(value: unknown, maxCount: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return uniqueStrings(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => normalizeText(item, maxLength))
      .filter(Boolean),
  ).slice(0, maxCount)
}

function getDateSortTime(dateText: string, fallback: number): number {
  const parsedTime = new Date(dateText.replace(/-/g, '/')).getTime()
  return Number.isFinite(parsedTime) ? parsedTime : fallback || 0
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeDate(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function normalizeAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.min(Math.round(value * 100) / 100, 999999)
}

function createLocalId(prefix: string, timestamp: number): string {
  return `${prefix}_${timestamp}_${Math.floor(Math.random() * 100000).toString(36)}`
}

function formatDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}
