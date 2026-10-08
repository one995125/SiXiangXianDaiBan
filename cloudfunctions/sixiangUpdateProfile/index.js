const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const db = cloud.database()
const COLLECTION_NAME = 'sixiang_users'
const LOG_TAG = '[sixiangUpdateProfile]'

/**
 * 同步用户主动授权/填写的头像昵称。
 *
 * 参数：
 * - nickName：nickname 输入框得到的昵称
 * - avatarUrl：chooseAvatar 头像上传云存储后的 cloud fileID
 *
 * 注意：
 * - 只写当前调用者 openid 对应的文档，避免跨用户覆盖。
 * - 不保存 chooseAvatar 的本机临时路径，头像必须先上传到当前用户自己的云存储目录。
 */
exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const nickName = typeof event.nickName === 'string' ? event.nickName.trim().slice(0, 32) : ''
  const hasAvatarUrlInput = typeof event.avatarUrl === 'string'
  const now = Date.now()

  console.info(`${LOG_TAG} request`, {
    hasOpenid: Boolean(openid),
    collection: COLLECTION_NAME,
    hasNickName: Boolean(nickName),
    hasAvatarUrl: hasAvatarUrlInput && Boolean(event.avatarUrl),
  })

  if (!openid) {
    return createError('NO_OPENID', '无法获取用户 openid')
  }

  const avatarUrl = hasAvatarUrlInput ? normalizeAvatarUrl(event.avatarUrl, openid) : ''

  if (hasAvatarUrlInput && event.avatarUrl.trim() && !avatarUrl) {
    return createError(
      'INVALID_AVATAR_URL',
      '头像文件地址无效',
      `头像必须先上传到 sixiang/users/${openid}/avatar/ 目录，并把云文件 ID 传给 ${LOG_TAG}。`,
    )
  }

  const profileData = {
    nickName,
    updatedAt: now,
  }

  if (hasAvatarUrlInput) {
    profileData.avatarUrl = avatarUrl
  }

  try {
    await writeProfile(openid, profileData)

    return {
      success: true,
      openid,
      avatarUrl,
      updatedAt: now,
    }
  } catch (error) {
    if (isCollectionNotReady(error) && await ensureCollectionExists()) {
      try {
        await writeProfile(openid, profileData)

        return {
          success: true,
          openid,
          avatarUrl,
          updatedAt: now,
        }
      } catch (retryError) {
        console.error(`${LOG_TAG} write retry failed`, createDatabaseLog(retryError))
        return createDatabaseError(retryError)
      }
    }

    console.error(`${LOG_TAG} write failed`, createDatabaseLog(error))
    return createDatabaseError(error)
  }
}

async function writeProfile(openid, profileData) {
  try {
    await db.collection(COLLECTION_NAME).doc(openid).update({
      data: profileData,
    })
  } catch (error) {
    if (!isDocumentNotFound(error)) {
      throw error
    }

    await db.collection(COLLECTION_NAME).doc(openid).set({
      data: {
        openid,
        ...profileData,
      },
    })
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
      `云端集合 ${COLLECTION_NAME} 权限不允许当前云函数写入`,
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
    'PROFILE_SYNC_FAILED',
    '同步用户资料失败',
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

function isDocumentNotFound(error) {
  const message = getErrorText(error).toLowerCase()
  if (message.includes('collection')) {
    return false
  }

  return message.includes('does not exist') || message.includes('document.update:fail') || message.includes('not found')
}

function isCollectionAlreadyExists(error) {
  const message = getErrorText(error).toLowerCase()
  return message.includes('collection') && (message.includes('already exist') || message.includes('exists') || message.includes('已存在'))
}

function normalizeAvatarUrl(value, openid) {
  const avatarUrl = typeof value === 'string' ? value.trim().slice(0, 500) : ''

  if (!avatarUrl) {
    return ''
  }

  if (!avatarUrl.startsWith('cloud://')) {
    return ''
  }

  if (!avatarUrl.includes(`sixiang/users/${openid}/avatar/`)) {
    return ''
  }

  return avatarUrl
}
