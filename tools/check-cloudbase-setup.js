const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const cloudfunctionsRoot = path.join(root, 'cloudfunctions')
const projectConfigPath = path.join(root, 'project.config.json')
const cloudServicePath = path.join(root, 'miniprogram', 'services', 'cloud-service.ts')
const cloudSyncServicePath = path.join(root, 'miniprogram', 'services', 'cloud-sync-service.ts')
const syncFunctionPath = path.join(cloudfunctionsRoot, 'sixiangSyncUserData', 'index.js')
const appPath = path.join(root, 'miniprogram', 'app.ts')
const profileServicePath = path.join(root, 'miniprogram', 'services', 'profile-service.ts')

const requiredFunctions = [
  'sixiangLogin',
  'sixiangSyncUserData',
  'sixiangGetProfile',
  'sixiangUpdateProfile',
  'sixiangReminder',
  'sixiangSendReminders',
]

const optionalFunctions = [
  'sixiangAdminStats',
  'sixiangDecryptWeRunData',
]

const requiredRules = [
  'sixiang_user_data',
  'sixiang_users',
  'sixiang_reminder_jobs',
]

let hasError = false

function fail(message) {
  hasError = true
  console.error(`[FAIL] ${message}`)
}

function pass(message) {
  console.log(`[ OK ] ${message}`)
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`${path.relative(root, filePath)} 不是合法 JSON: ${error.message}`)
    return null
  }
}

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`缺少 ${path.relative(root, filePath)}`)
    return false
  }

  pass(`存在 ${path.relative(root, filePath)}`)
  return true
}

function checkProjectConfig() {
  const projectConfig = readJson(projectConfigPath)
  if (!projectConfig) {
    return
  }

  if (projectConfig.cloudfunctionRoot !== 'cloudfunctions/') {
    fail(`project.config.json 的 cloudfunctionRoot 应为 cloudfunctions/，当前为 ${projectConfig.cloudfunctionRoot || '(空)'}`)
    return
  }

  pass('project.config.json 已指向 cloudfunctions/')
}

function checkCloudEnv() {
  if (!assertFile(cloudServicePath)) {
    return
  }

  const source = fs.readFileSync(cloudServicePath, 'utf8')
  const match = source.match(/CLOUD_ENV_ID\s*=\s*'([^']+)'/)

  if (!match || !match[1]) {
    fail('miniprogram/services/cloud-service.ts 未找到 CLOUD_ENV_ID')
    return
  }

  pass(`CLOUD_ENV_ID = ${match[1]}`)
}

function checkUserDataClosedLoop() {
  const requiredFiles = [cloudSyncServicePath, syncFunctionPath, appPath, profileServicePath]
  if (!requiredFiles.every(assertFile)) {
    return
  }

  const clientSource = fs.readFileSync(cloudSyncServicePath, 'utf8')
  const serverSource = fs.readFileSync(syncFunctionPath, 'utf8')
  const appSource = fs.readFileSync(appPath, 'utf8')
  const profileSource = fs.readFileSync(profileServicePath, 'utf8')
  const snapshotFields = [
    'records',
    'categoryHistory',
    'giftBook',
    'giftExchanges',
    'moodRecords',
    'familyState',
    'companionState',
    'onboardingState',
    'growthUnlockPromptAt',
    'legacyData',
  ]

  snapshotFields.forEach((field) => {
    if (!clientSource.includes(`${field}:`) || !serverSource.includes(`${field}:`)) {
      fail(`用户数据字段 ${field} 未同时接入客户端快照和云函数`)
      return
    }
    pass(`用户数据字段 ${field} 已接入上传与拉取链路`)
  })

  if (!clientSource.includes('cloudBaselineReady') || !clientSource.includes('BASELINE_NOT_READY')) {
    fail('云同步缺少“成功拉取基线后才允许上传”的防覆盖保护')
  } else {
    pass('云同步已启用拉取基线防覆盖保护')
  }

  if (!clientSource.includes('meta.schemaVersion < 7')) {
    fail('客户端缺少快照版本升级时重新合并本地历史数据的迁移条件')
  } else {
    pass('老设备升级快照版本时会先合并本地历史数据再上传')
  }

  if (/启动云同步失败[\s\S]{0,300}ensureFirstUseMockDataReady\(\)/.test(appSource)) {
    fail('启动拉云失败分支仍会生成示例数据，存在覆盖旧云快照风险')
  } else {
    pass('启动拉云失败时不会生成并上传示例数据')
  }

  if (!profileSource.includes('pendingSync') || !profileSource.includes('PROFILE_STORAGE_KEY')) {
    fail('用户资料缺少本地待上传副本，断网退出页面可能丢失')
  } else {
    pass('用户资料已具备本地待上传副本与云端补传链路')
  }

  if (!serverSource.includes("['do-now', 'schedule', 'quick', 'avoid']")) {
    fail('云函数四象限白名单与客户端 TodoQuadrantId 不一致')
  } else {
    pass('云函数四象限白名单与客户端一致')
  }

  if (!clientSource.includes('sanitizeLocalWeRunStateForCloud') || !serverSource.includes('sanitizeLegacyWeRunState')) {
    fail('微信运动历史数据缺少客户端与云函数双重敏感字段过滤')
  } else {
    pass('微信运动只同步可展示结果，临时加密凭证已双重过滤')
  }

  if (!serverSource.includes('providedFields') || !serverSource.includes('SYNC_DATA_FIELDS')) {
    fail('云函数缺少旧客户端未提供新增字段时的保留保护')
  } else {
    pass('云函数可防止旧客户端上传时清空新增云端字段')
  }

  if (
    !clientSource.includes('baseRevision') ||
    !clientSource.includes('SYNC_CONFLICT') ||
    !clientSource.includes('SYNC_PROTOCOL_NOT_READY') ||
    !clientSource.includes('hasCloudRevision') ||
    clientSource.includes('cloudBaselineRevision || meta.lastRevision') ||
    !serverSource.includes('db.runTransaction') ||
    !serverSource.includes('rawBaseRevision !== currentRevision')
  ) {
    fail('云同步缺少 revision 乐观锁、事务校验或客户端冲突重试')
  } else {
    pass('云同步已启用 revision 乐观锁、事务校验与客户端冲突重试')
  }

  if (
    !clientSource.includes('mergeGiftBook') ||
    !clientSource.includes('deletedGiftIds') ||
    !clientSource.includes('deletedRecordIds') ||
    !serverSource.includes('MAX_DELETED_ENTRY_ID_COUNT')
  ) {
    fail('礼簿并发合并缺少条目级时间戳或删除凭证保护')
  } else {
    pass('礼簿并发合并已启用条目级时间戳与删除凭证保护')
  }
}

function checkCloudFunction(functionName) {
  const functionDir = path.join(cloudfunctionsRoot, functionName)
  const indexPath = path.join(functionDir, 'index.js')
  const packagePath = path.join(functionDir, 'package.json')
  const configPath = path.join(functionDir, 'config.json')

  if (!assertFile(indexPath) || !assertFile(packagePath) || !assertFile(configPath)) {
    return
  }

  const pkg = readJson(packagePath)
  const config = readJson(configPath)

  if (pkg) {
    if (pkg.main !== 'index.js') {
      fail(`${functionName}/package.json 的 main 应为 index.js`)
    }

    if (!pkg.dependencies || !pkg.dependencies['wx-server-sdk']) {
      fail(`${functionName}/package.json 缺少 wx-server-sdk 依赖`)
    } else {
      pass(`${functionName} 已声明 wx-server-sdk`)
    }
  }

  if (config && (!config.permissions || !Array.isArray(config.permissions.openapi))) {
    fail(`${functionName}/config.json 缺少 permissions.openapi 数组`)
  }

  if (config && functionName === 'sixiangSendReminders') {
    if (!config.permissions.openapi.includes('subscribeMessage.send')) {
      fail('sixiangSendReminders/config.json 缺少 subscribeMessage.send 云调用权限')
    } else {
      pass('sixiangSendReminders 已声明 subscribeMessage.send 权限')
    }

    if (!Array.isArray(config.triggers) || !config.triggers.some((trigger) => trigger && trigger.type === 'timer')) {
      fail('sixiangSendReminders/config.json 缺少定时触发器')
    } else {
      pass('sixiangSendReminders 已配置定时触发器')
    }
  }

  const checkResult = spawnSync(process.execPath, ['--check', indexPath], {
    cwd: root,
    encoding: 'utf8',
  })

  if (checkResult.status !== 0) {
    fail(`${functionName}/index.js 语法检查失败\n${checkResult.stderr || checkResult.stdout}`)
  } else {
    pass(`${functionName}/index.js 语法检查通过`)
  }
}

function checkDatabaseRule(collectionName) {
  const rulePath = path.join(cloudfunctionsRoot, 'database-rules', `${collectionName}.json`)
  if (!assertFile(rulePath)) {
    return
  }

  const rule = readJson(rulePath)
  if (!rule) {
    return
  }

  if (rule.read !== false || rule.write !== false) {
    fail(`${collectionName} 建议规则为 {"read": false, "write": false}，前端不要直连读写用户数据`)
    return
  }

  pass(`${collectionName} 规则阻止前端直连读写`)
}

console.log('检查微信登录、用户数据云同步与订阅提醒本地配置...')
checkProjectConfig()
checkCloudEnv()
checkUserDataClosedLoop()
requiredFunctions.forEach(checkCloudFunction)
optionalFunctions.forEach((functionName) => {
  const functionDir = path.join(cloudfunctionsRoot, functionName)

  if (fs.existsSync(functionDir)) {
    checkCloudFunction(functionName)
  }
})
requiredRules.forEach(checkDatabaseRule)

console.log('')
console.log('本地检查不会验证云端是否已经部署。若小程序仍提示 CLOUD_FUNCTION_NOT_DEPLOYED，请在微信开发者工具中部署上述云函数。')

if (hasError) {
  process.exit(1)
}
