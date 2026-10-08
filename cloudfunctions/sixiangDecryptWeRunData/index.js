const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

const STEP_TARGET = 6000

function formatDate(timestamp) {
  // 微信运动时间戳需要按中国用户常用时区归属日期，避免云函数默认时区导致当天步数取成 0。
  const date = new Date(timestamp + 8 * 60 * 60 * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getTodayStep(stepInfoList, todayDate) {
  if (!Array.isArray(stepInfoList)) {
    return 0
  }

  const normalizedList = stepInfoList
    .filter((item) => item && typeof item.timestamp === 'number')
    .sort((a, b) => b.timestamp - a.timestamp)
  const todayStepInfo = normalizedList.find((item) => formatDate(item.timestamp * 1000) === todayDate)

  if (!todayStepInfo || typeof todayStepInfo.step !== 'number') {
    return 0
  }

  return todayStepInfo.step
}

/**
 * 解密微信运动数据。
 *
 * 参数：
 * - cloudID：wx.getWeRunData 返回的 cloudID，优先使用，云函数可直接通过 cloud.getOpenData 解密。
 * - targetSteps：每日目标步数，默认 6000。
 * - todayDate：前端当前日期，格式 YYYY-MM-DD，用于从 stepInfoList 中取当天步数。
 *
 * 注意：
 * - encryptedData/iv 不能在前端解密，也不要把 session_key 下发到前端。
 * - 当前函数只返回调用者自己的微信运动数据，不访问其他用户数据。
 */
exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const cloudID = typeof event.cloudID === 'string' ? event.cloudID : ''
  const targetSteps = typeof event.targetSteps === 'number' && event.targetSteps > 0 ? event.targetSteps : STEP_TARGET
  const todayDate = typeof event.todayDate === 'string' ? event.todayDate : formatDate(Date.now())

  if (!cloudID) {
    return {
      success: false,
      code: 'MISSING_CLOUD_ID',
      message: '缺少微信运动 cloudID，请先在前端调用 wx.getWeRunData。',
      openid: wxContext.OPENID || '',
    }
  }

  try {
    const openDataResult = await cloud.getOpenData({
      list: [cloudID],
    })
    const firstData = Array.isArray(openDataResult.list) ? openDataResult.list[0] : null
    const openData =
      firstData && typeof firstData.data === 'string'
        ? JSON.parse(firstData.data)
        : firstData && firstData.data
          ? firstData.data
          : {}
    const stepInfoList = Array.isArray(openData.stepInfoList) ? openData.stepInfoList : []
    const stepCount = getTodayStep(stepInfoList, todayDate)

    return {
      success: true,
      openid: wxContext.OPENID || '',
      todayDate,
      stepCount,
      targetSteps,
      reachedTarget: stepCount >= targetSteps,
      stepInfoList,
      stepDates: stepInfoList.map((item) => ({
        date: formatDate(item.timestamp * 1000),
        step: item.step,
      })),
      serverTime: Date.now(),
    }
  } catch (error) {
    console.error('解密微信运动数据失败', error)

    return {
      success: false,
      code: 'DECRYPT_FAILED',
      message: '解密微信运动数据失败',
      openid: wxContext.OPENID || '',
    }
  }
}
