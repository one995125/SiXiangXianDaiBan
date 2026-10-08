import { CLOUD_ENV_ID, callCloudFunction } from './cloud-service'

export interface UserProfileState {
  nickName: string
  avatarUrl: string
  updatedAt: number
}

interface ProfileCloudResult {
  success: boolean
  code?: string
  message?: string
  openid?: string
  nickName?: string
  avatarUrl?: string
  updatedAt?: number
}

interface CloudUploadResult {
  fileID?: string
}

interface CloudTempFileResult {
  fileList?: Array<{
    fileID?: string
    tempFileURL?: string
    status?: number
    errMsg?: string
  }>
}

interface StoredUserProfile extends UserProfileState {
  pendingSync: boolean
}

const PROFILE_STORAGE_KEY = 'sixiang_user_profile_v1'

export function loadUserProfile(): UserProfileState {
  return loadStoredUserProfile()
}

/**
 * 从云端读取用户昵称和头像。
 *
 * 调用时机：我的页加载时。
 * 注意：用户资料不再写入本地 storage；云函数按 openid 读取 sixiang_users。
 */
export async function fetchUserProfileFromCloud(): Promise<UserProfileState> {
  const localProfile = loadStoredUserProfile()

  // 上次编辑若因断网未上传，优先补传，避免随后用较旧云资料覆盖用户刚输入的昵称。
  if (localProfile.pendingSync) {
    try {
      return await syncUserProfileToCloud(localProfile)
    } catch (error) {
      console.warn('待上传用户资料仍未同步，继续显示本地副本', error)
      return toPublicProfile(localProfile)
    }
  }

  const result = await callCloudFunction<ProfileCloudResult>('sixiangGetProfile')

  if (!result || !result.success) {
    throw new Error(result && result.message ? result.message : '读取用户资料失败')
  }

  const profile: UserProfileState = {
    nickName: typeof result.nickName === 'string' ? result.nickName : '',
    avatarUrl: typeof result.avatarUrl === 'string' ? result.avatarUrl : '',
    updatedAt: typeof result.updatedAt === 'number' ? result.updatedAt : 0,
  }
  saveStoredUserProfile(profile, false)
  return profile
}

/**
 * 整理用户在当前页面输入的昵称和头像。
 *
 * 先写本地待同步副本，再由页面调用 syncUserProfileToCloud；断网退出页面后也不会丢失用户输入。
 */
export function saveUserProfile(profile: Partial<UserProfileState>): UserProfileState {
  const normalized: UserProfileState = {
    nickName: typeof profile.nickName === 'string' ? profile.nickName.trim() : '',
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.trim() : '',
    updatedAt: Date.now(),
  }
  saveStoredUserProfile(normalized, true)
  return normalized
}

export async function syncUserProfileToCloud(profile: UserProfileState): Promise<UserProfileState> {
  const payload: Record<string, unknown> = {
    nickName: profile.nickName,
  }

  if (profile.avatarUrl) {
    payload.avatarUrl = profile.avatarUrl
  }

  const result = await callCloudFunction<ProfileCloudResult>('sixiangUpdateProfile', payload)

  if (!result || !result.success) {
    throw new Error(result && result.message ? result.message : '同步用户资料失败')
  }

  const syncedProfile: UserProfileState = {
    nickName: profile.nickName,
    avatarUrl: typeof result.avatarUrl === 'string' ? result.avatarUrl : profile.avatarUrl,
    updatedAt: typeof result.updatedAt === 'number' ? result.updatedAt : Date.now(),
  }
  saveStoredUserProfile(syncedProfile, false)
  return syncedProfile
}

/**
 * 上传用户主动选择的头像到云存储。
 *
 * 参数 filePath 来自 chooseAvatar 的临时路径；参数 openid 只用于隔离云存储目录。
 * 注意：不要把 chooseAvatar 返回的临时路径直接写入资料，否则换设备或重启后无法稳定显示。
 */
export function uploadUserAvatarToCloud(filePath: string, openid: string): Promise<string> {
  const safeFilePath = typeof filePath === 'string' ? filePath.trim() : ''
  const safeOpenid = typeof openid === 'string' ? openid.replace(/[^a-zA-Z0-9_-]/g, '') : ''

  if (!safeFilePath) {
    return Promise.reject(new Error('未选择头像文件'))
  }

  if (!safeOpenid) {
    return Promise.reject(new Error('云登录未完成，无法同步头像'))
  }

  if (!(wx as any).cloud) {
    return Promise.reject(new Error('当前环境不支持 wx.cloud'))
  }

  const extension = getAvatarFileExtension(safeFilePath)
  const cloudPath = `sixiang/users/${safeOpenid}/avatar/avatar-${Date.now()}.${extension}`

  return new Promise((resolve, reject) => {
    ;(wx as any).cloud.uploadFile({
      cloudPath,
      filePath: safeFilePath,
      config: {
        env: CLOUD_ENV_ID,
      },
      success: (result: CloudUploadResult) => {
        if (result && result.fileID) {
          resolve(result.fileID)
          return
        }

        reject(new Error('云存储未返回头像 fileID'))
      },
      fail: reject,
    })
  })
}

/**
 * 将云文件 ID 转换为 image 可稳定显示的临时 URL。
 *
 * 调用时机：我的页读取云端资料后。
 * 注意：只影响页面展示，不改变保存到云端的头像 fileID。
 */
export function resolveUserAvatarDisplayUrl(avatarUrl: string): Promise<string> {
  const safeAvatarUrl = typeof avatarUrl === 'string' ? avatarUrl.trim() : ''

  if (!safeAvatarUrl) {
    return Promise.resolve('')
  }

  if (!isCloudFileID(safeAvatarUrl)) {
    return Promise.resolve(safeAvatarUrl)
  }

  if (!(wx as any).cloud) {
    return Promise.resolve('')
  }

  return new Promise((resolve) => {
    ;(wx as any).cloud.getTempFileURL({
      fileList: [safeAvatarUrl],
      config: {
        env: CLOUD_ENV_ID,
      },
      success: (result: CloudTempFileResult) => {
        const firstFile = Array.isArray(result.fileList) ? result.fileList[0] : null

        if (firstFile && firstFile.status === 0 && firstFile.tempFileURL) {
          resolve(firstFile.tempFileURL)
          return
        }

        resolve('')
      },
      fail: () => {
        resolve('')
      },
    })
  })
}

export function clearUserProfile() {
  // 用户资料保存在独立云集合；清空业务数据时仅移除本地副本，下次进入“我的”页会重新拉取。
  wx.removeStorageSync(PROFILE_STORAGE_KEY)
}

function createEmptyProfile(): UserProfileState {
  return {
    nickName: '',
    avatarUrl: '',
    updatedAt: 0,
  }
}

function loadStoredUserProfile(): StoredUserProfile {
  const raw = wx.getStorageSync(PROFILE_STORAGE_KEY) as Partial<StoredUserProfile> | undefined
  if (!raw || typeof raw !== 'object') {
    return { ...createEmptyProfile(), pendingSync: false }
  }

  return {
    nickName: typeof raw.nickName === 'string' ? raw.nickName.trim() : '',
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl.trim() : '',
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    pendingSync: Boolean(raw.pendingSync),
  }
}

function saveStoredUserProfile(profile: UserProfileState, pendingSync: boolean): void {
  wx.setStorageSync(PROFILE_STORAGE_KEY, {
    ...profile,
    pendingSync,
  } as StoredUserProfile)
}

function toPublicProfile(profile: StoredUserProfile): UserProfileState {
  return {
    nickName: profile.nickName,
    avatarUrl: profile.avatarUrl,
    updatedAt: profile.updatedAt,
  }
}

function isCloudFileID(value: string): boolean {
  return value.indexOf('cloud://') === 0
}

function getAvatarFileExtension(filePath: string): string {
  const matched = filePath.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/)
  const extension = matched ? matched[1].toLowerCase() : ''

  if (extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'webp') {
    return extension === 'jpeg' ? 'jpg' : extension
  }

  return 'jpg'
}
