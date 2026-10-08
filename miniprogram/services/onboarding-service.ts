import {
  GIFT_BOOK_STORAGE_KEY,
  GIFT_EXCHANGE_STORAGE_KEY,
  MOOD_RECORD_STORAGE_KEY,
  ONBOARDING_MOCK_STORAGE_KEY,
  RECORD_STORAGE_KEY,
} from '../constants/remember'
import type { RememberRecord } from './record-service'
import type { GiftBook, GiftExchangeBook } from './gift-mood-service'

interface OnboardingMockMeta {
  initializedAt: number
  seeded: boolean
  skippedBecauseUserHadData: boolean
}

interface TextReplaceResult {
  value: unknown
  changed: boolean
}

const MOCK_NOTE = '示例，可直接删除。'
const EXAMPLE_TEXT = '示例'
const LEGACY_EXAMPLE_TEXT = `新手${EXAMPLE_TEXT}`

/**
 * 首次使用时写入可删除的示例。
 *
 * 调用时机：启动云同步完成或失败后，由 app.ts 调用一次。
 * 注意：如果用户本地或云端已有业务数据，只写入“已检查”标记，不插入示例；
 * 用户删除示例后不会再次生成，除非手动清空小程序全部 storage。
 */
export function ensureFirstUseMockData(): boolean {
  const normalizedExistingCopy = normalizeLegacyExampleCopy()

  if (hasOnboardingMockMeta()) {
    return normalizedExistingCopy
  }

  if (hasAnyUserBusinessData()) {
    saveOnboardingMockMeta(false, true)
    return normalizedExistingCopy
  }

  const now = Date.now()
  wx.setStorageSync(RECORD_STORAGE_KEY, createMockRecords(now))
  wx.setStorageSync(GIFT_BOOK_STORAGE_KEY, createMockGiftBook(now))
  wx.setStorageSync(GIFT_EXCHANGE_STORAGE_KEY, createMockGiftExchangeBook(now))
  saveOnboardingMockMeta(true, false)
  return true
}

/**
 * 兼容已生成过的旧示例文案。
 *
 * 调用时机：启动后、云端快照回填后。
 * 注意：只扫描本应用的业务缓存键，避免影响微信登录态、系统日志等无关 storage。
 */
function normalizeLegacyExampleCopy(): boolean {
  let changed = false
  const storageKeys = [
    RECORD_STORAGE_KEY,
    GIFT_BOOK_STORAGE_KEY,
    GIFT_EXCHANGE_STORAGE_KEY,
    MOOD_RECORD_STORAGE_KEY,
  ]

  storageKeys.forEach((storageKey) => {
    changed = normalizeStorageExampleCopy(storageKey) || changed
  })

  return changed
}

function normalizeStorageExampleCopy(storageKey: string): boolean {
  const result = replaceLegacyExampleText(wx.getStorageSync(storageKey))

  if (result.changed) {
    wx.setStorageSync(storageKey, result.value)
  }

  return result.changed
}

function replaceLegacyExampleText(value: unknown): TextReplaceResult {
  if (typeof value === 'string') {
    const nextValue = value.replace(new RegExp(LEGACY_EXAMPLE_TEXT, 'g'), EXAMPLE_TEXT)
    return {
      value: nextValue,
      changed: nextValue !== value,
    }
  }

  if (Array.isArray(value)) {
    let changed = false
    const nextValue = value.map((item) => {
      const result = replaceLegacyExampleText(item)
      changed = changed || result.changed
      return result.value
    })
    return {
      value: nextValue,
      changed,
    }
  }

  if (value && typeof value === 'object') {
    let changed = false
    const source = value as Record<string, unknown>
    const nextValue: Record<string, unknown> = {}

    Object.keys(source).forEach((key) => {
      const result = replaceLegacyExampleText(source[key])
      changed = changed || result.changed
      nextValue[key] = result.value
    })

    return {
      value: changed ? nextValue : value,
      changed,
    }
  }

  return {
    value,
    changed: false,
  }
}

function hasOnboardingMockMeta(): boolean {
  const rawMeta = wx.getStorageSync(ONBOARDING_MOCK_STORAGE_KEY) as unknown
  return Boolean(rawMeta && typeof rawMeta === 'object')
}

function saveOnboardingMockMeta(seeded: boolean, skippedBecauseUserHadData: boolean): void {
  const meta: OnboardingMockMeta = {
    initializedAt: Date.now(),
    seeded,
    skippedBecauseUserHadData,
  }
  wx.setStorageSync(ONBOARDING_MOCK_STORAGE_KEY, meta)
}

function hasAnyUserBusinessData(): boolean {
  return (
    readArrayStorage(RECORD_STORAGE_KEY).length > 0 ||
    hasGiftBookData(wx.getStorageSync(GIFT_BOOK_STORAGE_KEY)) ||
    hasGiftExchangeData(wx.getStorageSync(GIFT_EXCHANGE_STORAGE_KEY)) ||
    readArrayStorage(MOOD_RECORD_STORAGE_KEY).length > 0
  )
}

function createMockRecords(now: number): RememberRecord[] {
  const today = new Date(now)
  const todayText = formatDate(today)

  return [
    createMockRecord(now, {
      id: 'demo_record_today_call',
      type: 'todo',
      title: '示例：给妈妈打电话',
      category: '生活待办',
      date: todayText,
      note: '这是普通待办示例，点进详情可以删除。',
    }),
    createMockRecord(now + 1, {
      id: 'demo_record_daily_water',
      type: 'todo',
      title: '示例：每天喝水',
      category: '健康习惯',
      date: todayText,
      recurrenceType: 'daily',
      targetCount: 1,
      targetUnit: '次',
      note: '这是每日计划示例，完成或删除都可以。',
    }),
    createMockRecord(now + 2, {
      id: 'demo_record_anniversary',
      type: 'anniversary',
      title: '示例：爸爸生日',
      category: '生日',
      anniversaryMode: 'countdown',
      date: formatDate(addDays(today, 14)),
      repeatRule: 'yearly',
      note: '这是纪念日示例。',
    }),
    createMockRecord(now + 3, {
      id: 'demo_record_expiry',
      type: 'expiry',
      title: '示例：护照到期',
      category: '证件到期',
      date: formatDate(addDays(today, 30)),
      remindBeforeMinutes: 10080,
      note: '这是临近效期示例。',
    }),
  ]
}

function createMockRecord(timestamp: number, input: Partial<RememberRecord>): RememberRecord {
  const recurrenceType = input.recurrenceType || 'none'

  return {
    id: input.id || `demo_record_${timestamp}`,
    type: input.type || 'todo',
    title: input.title || '示例',
    category: input.category || '生活待办',
    quadrant: input.quadrant || 'schedule',
    quadrantOrder: input.quadrantOrder || timestamp,
    typeOrder: input.typeOrder || 0,
    anniversaryMode: input.anniversaryMode || 'elapsed',
    date: input.date || formatDate(),
    time: '',
    isAllDay: true,
    remindAt: 0,
    remindBeforeMinutes: typeof input.remindBeforeMinutes === 'number' ? input.remindBeforeMinutes : 0,
    repeatRule: input.repeatRule || 'none',
    recurrenceType,
    weeklyDays: [],
    targetCount: recurrenceType === 'none' ? 0 : input.targetCount || 1,
    targetUnit: recurrenceType === 'none' ? '' : input.targetUnit || '次',
    noteKind: input.noteKind || 'long_term',
    scheduleVersion: 2,
    checkinHistory: {},
    status: 'pending',
    note: input.note || MOCK_NOTE,
    visibility: 'private',
    familyId: '',
    pinnedAt: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

function createMockGiftBook(now: number): GiftBook {
  return {
    contacts: [
      {
        id: 'demo_gift_contact_wang',
        name: '王伟',
        relation: '同事',
        avatar: '🎁',
        birthday: '',
        wishes: [],
        note: MOCK_NOTE,
        gifts: [
          {
            id: 'demo_gift_happy_wedding',
            direction: 'sent',
            title: '婚礼',
            occasion: '喜事',
            date: formatDate(addDays(new Date(now), -10)),
            amount: 600,
            note: MOCK_NOTE,
            createdAt: now + 10,
            updatedAt: now + 10,
          },
        ],
        createdAt: now + 10,
        updatedAt: now + 10,
      },
      {
        id: 'demo_gift_contact_uncle',
        name: '外公家',
        relation: '亲戚',
        avatar: '🎁',
        birthday: '',
        wishes: [],
        note: MOCK_NOTE,
        gifts: [
          {
            id: 'demo_gift_sad_memorial',
            direction: 'sent',
            title: '追悼',
            occasion: '憾事',
            date: formatDate(addDays(new Date(now), -20)),
            amount: 200,
            note: MOCK_NOTE,
            createdAt: now + 11,
            updatedAt: now + 11,
          },
        ],
        createdAt: now + 11,
        updatedAt: now + 11,
      },
    ],
    deletedGiftIds: [],
    updatedAt: now,
  }
}

function createMockGiftExchangeBook(now: number): GiftExchangeBook {
  const today = new Date(now)

  return {
    contacts: [
      {
        id: 'demo_exchange_contact_partner',
        name: '另一半',
        relation: '亲密关系',
        avatar: '🎁',
        records: [
          {
            id: 'demo_exchange_partner_coffee',
            direction: 'received',
            giftName: '咖啡',
            date: formatDate(today),
            amount: 0,
            hasAmount: false,
            note: MOCK_NOTE,
            sourceGiftId: '',
            createdAt: now + 20,
            updatedAt: now + 20,
          },
          {
            id: 'demo_exchange_partner_flower',
            direction: 'sent',
            giftName: '花束',
            date: formatDate(addDays(today, -5)),
            amount: 0,
            hasAmount: false,
            note: MOCK_NOTE,
            sourceGiftId: '',
            createdAt: now + 19,
            updatedAt: now + 19,
          },
        ],
        createdAt: now + 20,
        updatedAt: now + 20,
      },
      {
        id: 'demo_exchange_contact_dad',
        name: '爸爸',
        relation: '家人',
        avatar: '🎁',
        records: [
          {
            id: 'demo_exchange_dad_tea',
            direction: 'received',
            giftName: '家乡茶叶',
            date: formatDate(addDays(today, -3)),
            amount: 0,
            hasAmount: false,
            note: MOCK_NOTE,
            sourceGiftId: '',
            createdAt: now + 21,
            updatedAt: now + 21,
          },
        ],
        createdAt: now + 21,
        updatedAt: now + 21,
      },
    ],
    migratedGiftIds: [],
    deletedRecordIds: [],
    updatedAt: now,
  }
}

function readArrayStorage(key: string): unknown[] {
  const value = wx.getStorageSync(key)
  return Array.isArray(value) ? value : []
}

function hasGiftBookData(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as GiftBook).contacts) &&
      (value as GiftBook).contacts.some((contact) => Array.isArray(contact.gifts) && contact.gifts.length > 0),
  )
}

function hasGiftExchangeData(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as GiftExchangeBook).contacts) &&
      (value as GiftExchangeBook).contacts.some((contact) => Array.isArray(contact.records) && contact.records.length > 0),
  )
}

function addDays(date: Date, dayCount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayCount)
}

function formatDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
