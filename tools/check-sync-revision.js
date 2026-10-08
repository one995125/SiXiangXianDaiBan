const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const functionPath = path.join(root, 'cloudfunctions', 'sixiangSyncUserData', 'index.js')
const documents = new Map()
let currentOpenid = 'revision-user'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function createNotFoundError() {
  const error = new Error('document.get:fail document does not exist')
  error.errMsg = error.message
  return error
}

function createDocumentReference(id) {
  return {
    async get() {
      if (!documents.has(id)) throw createNotFoundError()
      return { data: clone(documents.get(id)) }
    },
    async set({ data }) {
      documents.set(id, clone(data))
      return { stats: { updated: 1 } }
    },
    async update({ data }) {
      if (!documents.has(id)) throw createNotFoundError()
      documents.set(id, { ...documents.get(id), ...clone(data) })
      return { stats: { updated: 1 } }
    },
  }
}

const database = {
  collection() {
    return {
      doc(id) {
        return createDocumentReference(id)
      },
    }
  },
  async createCollection() {
    return {}
  },
  async runTransaction(callback) {
    return callback(database)
  },
}

const cloudMock = {
  DYNAMIC_CURRENT_ENV: 'dynamic',
  init() {},
  database() {
    return database
  },
  getWXContext() {
    return { OPENID: currentOpenid }
  },
}

function loadCloudFunction() {
  const source = fs.readFileSync(functionPath, 'utf8')
  const moduleObject = { exports: {} }
  const sandbox = {
    Buffer,
    Date,
    Math,
    Set,
    JSON,
    console,
    module: moduleObject,
    exports: moduleObject.exports,
    require(name) {
      if (name === 'wx-server-sdk') return cloudMock
      throw new Error(`测试环境不允许加载依赖：${name}`)
    },
  }
  vm.runInNewContext(source, sandbox, { filename: functionPath })
  return moduleObject.exports.main
}

function createSnapshot(title) {
  const now = Date.now()
  return {
    schemaVersion: 7,
    records: [{
      id: 'record-1',
      type: 'todo',
      title,
      date: '2026-09-23',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }],
    categoryHistory: {},
    giftBook: { contacts: [], updatedAt: now },
    giftExchanges: { contacts: [], migratedGiftIds: [], updatedAt: now },
    moodRecords: [],
    familyState: null,
    companionState: null,
    onboardingState: null,
    growthUnlockPromptAt: 0,
    legacyData: {},
  }
}

async function run() {
  const main = loadCloudFunction()

  const firstPull = await main({ action: 'pull', bootstrap: { hasLegacyEvidence: false } })
  assert.strictEqual(firstPull.success, true)
  assert.strictEqual(firstPull.revision, 1)

  const firstPush = await main({ action: 'push', baseRevision: 1, data: createSnapshot('设备A修改') })
  assert.strictEqual(firstPush.success, true)
  assert.strictEqual(firstPush.revision, 2)
  assert.strictEqual(firstPush.legacyPush, undefined)

  const stalePush = await main({ action: 'push', baseRevision: 1, data: createSnapshot('设备B旧基线修改') })
  assert.strictEqual(stalePush.success, false)
  assert.strictEqual(stalePush.code, 'SYNC_CONFLICT')
  assert.strictEqual(stalePush.revision, 2)

  const conflictPull = await main({ action: 'pull' })
  assert.strictEqual(conflictPull.data.records[0].title, '设备A修改')
  assert.strictEqual(conflictPull.revision, 2)

  const rebasedPush = await main({ action: 'push', baseRevision: 2, data: createSnapshot('合并后修改') })
  assert.strictEqual(rebasedPush.success, true)
  assert.strictEqual(rebasedPush.revision, 3)

  const legacyPush = await main({ action: 'push', data: createSnapshot('旧客户端无版本上传') })
  assert.strictEqual(legacyPush.success, true)
  assert.strictEqual(legacyPush.legacyPush, true)
  assert.strictEqual(legacyPush.revision, 4)

  const legacyPull = await main({ action: 'pull' })
  assert.strictEqual(legacyPull.data.records[0].title, '旧客户端无版本上传')
  assert.strictEqual(legacyPull.revision, 4)

  currentOpenid = 'legacy-no-revision-user'
  const oldDocument = createSnapshot('无 revision 的云端旧文档')
  oldDocument.openid = currentOpenid
  oldDocument.schemaVersion = 6
  oldDocument.createdAt = Date.now() - 1000
  oldDocument.updatedAt = Date.now() - 1000
  oldDocument.companionState = { nickname: '云端保留字段' }
  delete oldDocument.revision
  documents.set(currentOpenid, oldDocument)

  const legacySnapshotWithoutNewField = createSnapshot('旧文档兼容写入')
  delete legacySnapshotWithoutNewField.companionState
  const noRevisionLegacyPush = await main({
    action: 'push',
    data: legacySnapshotWithoutNewField,
  })
  assert.strictEqual(noRevisionLegacyPush.success, true)
  assert.strictEqual(noRevisionLegacyPush.legacyPush, true)
  assert.strictEqual(noRevisionLegacyPush.revision, 2)
  assert.strictEqual(documents.get(currentOpenid).schemaVersion, 7)
  assert.strictEqual(documents.get(currentOpenid).revision, 2)
  assert.deepStrictEqual(documents.get(currentOpenid).companionState, { nickname: '云端保留字段' })

  currentOpenid = 'growth-user'
  const growthPull = await main({ action: 'pull', bootstrap: { hasLegacyEvidence: false } })
  const growthCheckin = await main({ action: 'growthCheckin' })
  assert.strictEqual(growthPull.revision, 1)
  assert.strictEqual(growthCheckin.revision, 2)

  console.log('云同步 revision 专项检查通过：旧协议无 baseRevision 可兼容写入；合法基线正常递增；无 revision 旧文档按 1 起算。')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
