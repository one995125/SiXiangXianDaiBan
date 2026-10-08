const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const COLLECTION_NAME = 'sixiang_users'
const LOG_TAG = '[sixiangGetProfile]'

/**
 * 读取当前用户昵称和头像。
 *
 * 调用时机：我的页加载时。
 * 安全边界：只按当前调用者 openid 读取自己的资料，不接受前端传入 openid。
 */
exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''

  console.info(`${LOG_TAG} request`, {
    hasOpenid: Boolean(openid),
    collection: COLLECTION_NAME,
  })

  if (!openid) {
    return createError('NO_OPENID', '无法获取用户 openid')
  }

  try {
    const result = await db.collection(COLLECTION_NAME).doc(openid).get()
    const data = result && result.data ? result.data : {}

    return {
      success: true,
      openid,
      nickName: typeof data.nickName === 'string' ? data.nickName : '',
      avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : '',
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    }
  } catch (error) {
    if (isDocumentNotFound(error)) {
      return {
        success: true,
        openid,
        nickName: '',
        avatarUrl: '',
        updatedAt: 0,
      }
    }

    if (isCollectionNotReady(error) && await ensureCollectionExists()) {
      return {
        success: true,
        openid,
        nickName: '',
        avatarUrl: '',
        updatedAt: 0,
      }
    }

    console.error(`${LOG_TAG} read failed`, createDatabaseLog(error))
    return createDatabaseError(error)
  }
}

async function ensureCollectionExists() {
  if (typeof db.createCollection !== 'function') {
    console.warn(`${LOG_TAG} createCollection unavailable`, {
      collection: COLLECTION_NAME,
    })
    return false
  }

  try {
    await db.createCollection(COLLECTION_NAME)
    console.info(`${LOG_TAG} collection created`, {
      collection: COLLECTION_NAME,
    })
    return true
  } catch (error) {
    if (isCollectionAlreadyExists(error)) {
      console.info(`${LOG_TAG} collection already exists`, {
        collection: COLLECTION_NAME,
      })
      return true
    }

    console.error(`${LOG_TAG} create collection failed`, createDatabaseLog(error))
    return false
  }
}

function createDatabaseError(error) {
  const text = getErrorText(error).toLowerCase()

  if (text.includes('permission') || text.includes('denied') || text.includes('权限')) {
    return createError(
      'COLLECTION_PERMISSION_DENIED',
      `云端集合 ${COLLECTION_NAME} 权限不允许当前云函数读取`,
      `确认 ${COLLECTION_NAME} 集合已创建，且安全规则允许云函数服务端读写；云函数日志搜索 ${LOG_TAG}。`,
    )
  }

  if (
    text.includes('collection') &&
    (text.includes('not found') || text.includes('not exist') || text.includes('does not exist') || text.includes('不存在'))
  ) {
    return createError(
      'COLLECTION_NOT_READY',
      `云端集合 ${COLLECTION_NAME} 未创建或不可访问`,
      `在云开发数据库创建 ${COLLECTION_NAME} 集合，规则可使用 cloudfunctions/database-rules/sixiang_users.json。`,
    )
  }

  return createError(
    'PROFILE_READ_FAILED',
    '读取用户资料失败',
    `微信开发者工具 Console 搜索 ${LOG_TAG}，再到云函数日志查看原始数据库错误。`,
  )
}

function createError(code, message, debug) {
  return {
    success: false,
    code,
    message,
    debug: debug || `确认 ${LOG_TAG} 由小程序端 wx.cloud.callFunction 调用，并检查 cloud.getWXContext().OPENID。`,
  }
}

function createDatabaseLog(error) {
  return {
    collection: COLLECTION_NAME,
    errMsg: getErrorText(error),
    errCode: error && error.errCode ? error.errCode : '',
  }
}

function getErrorText(error) {
  if (!error) {
    return ''
  }

  if (typeof error === 'string') {
    return error
  }

  return String(error.errMsg || error.message || JSON.stringify(error))
}

function isDocumentNotFound(error) {
  const message = getErrorText(error).toLowerCase()
  if (message.includes('collection')) {
    return false
  }

  return message.includes('does not exist') || message.includes('document.get:fail') || message.includes('not found')
}

function isCollectionNotReady(error) {
  const message = getErrorText(error).toLowerCase()
  return (
    message.includes('collection') &&
    (
      message.includes('not found') ||
      message.includes('not exist') ||
      message.includes('does not exist') ||
      message.includes('不存在') ||
      message.includes('未创建')
    )
  )
}

function isCollectionAlreadyExists(error) {
  const message = getErrorText(error).toLowerCase()
  return message.includes('collection') && (message.includes('already exist') || message.includes('exists') || message.includes('已存在'))
}
