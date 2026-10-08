const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
})

/**
 * 获取当前微信用户身份。
 *
 * 调用时机：小程序启动后，由前端 loginWithWechat 调用。
 * 返回值：
 * - openid：当前用户在本小程序下的唯一标识
 * - appid：当前小程序 appid
 * - unionid：满足微信开放平台绑定条件时才可能存在
 *
 * 注意：不要把其他用户数据直接返回给前端；后续云数据库读写都应按 openid 做隔离。
 */
exports.main = async () => {
  const wxContext = cloud.getWXContext()

  return {
    success: true,
    openid: wxContext.OPENID || '',
    appid: wxContext.APPID || '',
    unionid: wxContext.UNIONID || '',
    env: wxContext.ENV || '',
    serverTime: Date.now(),
  }
}
