const assert = require('assert')
const { mergeUserDataSnapshots } = require('../miniprogram/services/cloud-sync-service.ts')

function createSnapshot(giftBook, giftExchanges) {
  return {
    schemaVersion: 7,
    records: [],
    categoryHistory: {},
    giftBook,
    giftExchanges,
    moodRecords: [],
    familyState: null,
    companionState: null,
    onboardingState: null,
    growthUnlockPromptAt: 0,
    legacyData: {},
  }
}

function gift(id, updatedAt, title = id) {
  return { id, title, createdAt: updatedAt, updatedAt }
}

function exchangeRecord(id, updatedAt) {
  return { id, giftName: id, createdAt: updatedAt, updatedAt }
}

const cloudSnapshot = createSnapshot(
  {
    contacts: [{ id: 'contact-1', name: '家人', gifts: [gift('gift-a', 200)], updatedAt: 200 }],
    deletedGiftIds: ['gift-deleted'],
    updatedAt: 200,
  },
  {
    contacts: [{ id: 'exchange-1', name: '朋友', records: [exchangeRecord('record-a', 200)], updatedAt: 200 }],
    migratedGiftIds: ['gift-a'],
    deletedRecordIds: ['record-deleted'],
    updatedAt: 200,
  },
)

const localSnapshot = createSnapshot(
  {
    contacts: [{
      id: 'contact-1',
      name: '家人',
      gifts: [gift('gift-b', 300), gift('gift-deleted', 300), gift('gift-a', 100, '旧版本')],
      updatedAt: 300,
    }],
    deletedGiftIds: [],
    updatedAt: 300,
  },
  {
    contacts: [{
      id: 'exchange-1',
      name: '朋友',
      records: [exchangeRecord('record-b', 300), exchangeRecord('record-deleted', 300)],
      updatedAt: 300,
    }],
    migratedGiftIds: ['gift-b'],
    deletedRecordIds: [],
    updatedAt: 300,
  },
)

const merged = mergeUserDataSnapshots(cloudSnapshot, localSnapshot)
const gifts = merged.giftBook.contacts[0].gifts
const records = merged.giftExchanges.contacts[0].records

assert.deepStrictEqual(gifts.map((item) => item.id).sort(), ['gift-a', 'gift-b'])
assert.strictEqual(gifts.find((item) => item.id === 'gift-a').title, 'gift-a')
assert.deepStrictEqual(merged.giftBook.deletedGiftIds, ['gift-deleted'])
assert.deepStrictEqual(records.map((item) => item.id).sort(), ['record-a', 'record-b'])
assert.deepStrictEqual(merged.giftExchanges.migratedGiftIds.sort(), ['gift-a', 'gift-b'])
assert.deepStrictEqual(merged.giftExchanges.deletedRecordIds, ['record-deleted'])

console.log('礼簿冲突合并专项检查通过：并发新增均保留、较新编辑胜出、删除条目不会复活。')
