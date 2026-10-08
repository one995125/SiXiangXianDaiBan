import {
  FAMILY_SPACE_FEATURE_ENABLED,
  FamilyState,
  RememberStorageSummary,
  clearAllRememberUserData,
  createLocalFamilyState,
  loadFamilyState,
  loadRememberStorageSummary,
} from '../../services/record-service'
import { loadUserLoginState, loginWithWechat } from '../../services/user-service'
import {
  UserProfileState,
  fetchUserProfileFromCloud,
  loadUserProfile,
  resolveUserAvatarDisplayUrl,
  saveUserProfile,
  syncUserProfileToCloud,
  uploadUserAvatarToCloud,
} from '../../services/profile-service'
import {
  UserDataCloudSyncStatus,
  flushUserDataCloudSync,
  loadUserDataCloudSyncStatus,
  retryUserDataCloudSync,
} from '../../services/cloud-sync-service'
import { refreshContentTopPadding } from '../../utils/safe-area'
import { buildShareAppMessage, buildShareTimeline, enableAppShareMenu } from '../../utils/share'
import { cancelAllWechatReminders } from '../../services/reminder-service'
import { clearCompanionState } from '../../services/companion-service'

interface MineMetric {
  label: string
  value: string
  hint: string
  tone: string
}

interface InfoRow {
  label: string
  value: string
}

interface CloudSyncStatusView {
  badgeText: string
  tone: string
  summaryText: string
  detailText: string
  lastSyncedText: string
  pendingText: string
  failureText: string
  healthText: string
  debugText: string
  showDetails: boolean
  showDebug: boolean
  actionText: string
  actionDisabled: boolean
}

interface FamilyStateView {
  statusText: string
  descText: string
  actionText: string
}

function createEmptySummary(): RememberStorageSummary {
  return {
    todayDate: '',
    todayLabel: '',
    allCount: 0,
    pendingCount: 0,
    completedCount: 0,
    todayCount: 0,
    recurringCount: 0,
    hasData: false,
  }
}

function buildMetrics(summary: RememberStorageSummary): MineMetric[] {
  return [
    {
      label: '全部记录',
      value: String(summary.allCount),
      hint: `${summary.pendingCount} 条待处理`,
      tone: 'violet',
    },
    {
      label: '今日',
      value: String(summary.todayCount),
      hint: summary.todayLabel || '今天',
      tone: 'mint',
    },
    {
      label: '计划',
      value: String(summary.recurringCount),
      hint: `${summary.completedCount} 条已完成`,
      tone: 'amber',
    },
  ]
}

function buildInfoRows(summary: RememberStorageSummary): InfoRow[] {
  return [
    {
      label: '待处理',
      value: `${summary.pendingCount} 条`,
    },
    {
      label: '已完成',
      value: `${summary.completedCount} 条`,
    },
    {
      label: '计划',
      value: `${summary.recurringCount} 项`,
    },
    {
      label: '今天',
      value: summary.todayDate || '-',
    },
  ]
}

function buildFamilyStateView(familyState: FamilyState | null): FamilyStateView {
  if (familyState) {
    return {
      statusText: '已开启',
      descText: `${familyState.displayName}可用于记录的“家庭可见”范围；当前版本暂不做成员和邀请管理。`,
      actionText: '已开启',
    }
  }

  return {
    statusText: '未开启',
    descText: '开启后，创建记录时可以选择“家庭可见”。当前版本仅保存可见范围，不做跨账号共享。',
    actionText: '开启',
  }
}

function buildCloudSyncStatusView(status: UserDataCloudSyncStatus, syncingCloudData: boolean): CloudSyncStatusView {
  const isSyncing = syncingCloudData || status.syncing
  const hasFailure = Boolean(status.lastErrorMessage)
  const tone = isSyncing ? 'is-syncing' : status.hasPendingChanges ? 'has-pending' : hasFailure ? 'has-error' : 'is-synced'
  const failureCodeText = status.lastErrorCode ? `【${status.lastErrorCode}】` : ''
  const lastSyncedFallback = hasFailure ? '尚未成功同步' : '暂无云端更新时间'
  const lastSyncedText = isSyncing ? '正在同步，请稍候' : formatCloudSyncTime(status.lastSyncedAt, lastSyncedFallback)
  const pendingText = status.hasPendingChanges
    ? `有，${formatCloudSyncTime(status.dirtyAt, '刚刚')} 后的改动待上传`
    : '没有待上传改动'
  const failureText = status.lastErrorMessage
    ? `${failureCodeText}${status.lastErrorMessage}，${formatCloudSyncTime(status.lastFailedAt, '时间未知')}`
    : '暂无失败记录'
  const snapshotKb = Math.max(0, Math.round(status.snapshotBytes / 1024))
  const healthText = status.consecutiveFailures > 0
    ? `快照约 ${snapshotKb}KB · 已连续失败 ${status.consecutiveFailures} 次`
    : `快照约 ${snapshotKb}KB · 连续失败 0 次`
  const summaryText = isSyncing
    ? '正在同步'
    : status.hasPendingChanges
      ? '有改动待上传'
      : hasFailure
        ? '同步需要处理'
        : status.lastSyncedAt
          ? '云端同步正常'
          : '等待首次同步'
  const detailText = isSyncing
    ? '正在更新云端备份'
    : status.hasPendingChanges
      ? '本地已保存，可手动重试上传'
      : hasFailure
        ? '本地数据已保留，可重新检查'
        : status.lastSyncedAt
          ? `最近同步 ${lastSyncedText}`
          : '新增或修改记录后会自动备份'

  return {
    badgeText: isSyncing ? '同步中' : status.hasPendingChanges ? '待上传' : hasFailure ? '上次失败' : '已同步',
    tone,
    summaryText,
    detailText,
    lastSyncedText,
    pendingText,
    failureText,
    healthText,
    debugText: status.lastDebugHint || '在微信开发者工具 Console 搜索 [sixiangSyncUserData]，再查看同名云函数日志。',
    showDetails: status.hasPendingChanges || hasFailure,
    showDebug: hasFailure,
    actionText: isSyncing ? '同步中' : status.hasPendingChanges ? '重试上传' : hasFailure ? '重新检查' : '检查同步',
    actionDisabled: isSyncing,
  }
}

/**
 * 格式化同步元数据时间戳。
 *
 * 参数 fallback 用于没有成功同步、没有失败时间等空状态，避免页面展示 1970 年。
 */
function formatCloudSyncTime(timestamp: number, fallback: string): string {
  if (!timestamp) {
    return fallback
  }

  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')

  return `${month}月${day}日 ${hour}:${minute}`
}

function getCloudSyncToastError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const rawError = error as { message?: unknown; errMsg?: unknown }

    if (typeof rawError.message === 'string' && rawError.message.trim()) {
      return rawError.message.trim()
    }

    if (typeof rawError.errMsg === 'string' && rawError.errMsg.trim()) {
      return rawError.errMsg.trim()
    }
  }

  return '同步失败，请稍后重试'
}

Component({
  data: {
    contentTopPadding: 14,
    summary: createEmptySummary(),
    metrics: buildMetrics(createEmptySummary()),
    loginState: loadUserLoginState(),
    userProfile: loadUserProfile(),
    profileAvatarDisplayUrl: '',
    updatingAvatar: false,
    infoRows: buildInfoRows(createEmptySummary()),
    familyFeatureEnabled: FAMILY_SPACE_FEATURE_ENABLED,
    familyState: null as FamilyState | null,
    familyStateView: buildFamilyStateView(null),
    syncingCloudData: false,
    clearingAllData: false,
    cloudSyncStatusView: buildCloudSyncStatusView(loadUserDataCloudSyncStatus(), false),
  },

  lifetimes: {
    attached() {
      this.initViewportPadding()
      this.enableShareMenu()
      this.loadMineData()
    },
  },

  pageLifetimes: {
    show() {
      this.loadMineData()
    },
  },

  methods: {
    enableShareMenu() {
      enableAppShareMenu()
    },

    onShareAppMessage() {
      return buildShareAppMessage('mine')
    },

    onShareTimeline() {
      return buildShareTimeline('mine')
    },

    /**
     * 自定义导航栏模式下，页面需要自己避开状态栏和胶囊按钮区域。
     *
     * 调用时机：组件 attached。
     * 注意：只使用 wx.getSystemInfoSync，不依赖浏览器 DOM/BOM。
     */
    initViewportPadding() {
      refreshContentTopPadding(this, { extraTop: 26 })
    },

    /**
     * 读取“我的”页所需的业务摘要、登录状态和云同步状态。
     *
     * 调用时机：页面显示、云同步回填、手动清空数据后。
     * 注意：这里不直接查询数据库，云端资料通过 profile-service 的云函数按 openid 读取。
     */
    loadMineData() {
      try {
        const summary = loadRememberStorageSummary()
        const loginState = loadUserLoginState()
        const userProfile = loadUserProfile()
        const familyState = FAMILY_SPACE_FEATURE_ENABLED ? loadFamilyState() : null
        const cloudSyncStatusView = buildCloudSyncStatusView(
          loadUserDataCloudSyncStatus(),
          Boolean(this.data.syncingCloudData),
        )

        this.setData({
          summary,
          metrics: buildMetrics(summary),
          loginState,
          userProfile,
          infoRows: buildInfoRows(summary),
          familyState,
          familyStateView: buildFamilyStateView(familyState),
          cloudSyncStatusView,
        })
        this.loadCloudUserProfile()
      } catch (error) {
        console.error('读取我的页数据失败', error)
        wx.showToast({
          title: '读取数据失败',
          icon: 'none',
        })
      }
    },

    onCloudUserDataReady() {
      this.loadMineData()
    },

    onCloudSyncStatusChanged() {
      this.refreshCloudSyncStatus()
    },

    /**
     * 只刷新云同步状态卡。
     *
     * 调用时机：后台自动同步开始/结束、用户手动点击同步、页面显示时批量刷新。
     */
    refreshCloudSyncStatus() {
      this.setData({
        cloudSyncStatusView: buildCloudSyncStatusView(
          loadUserDataCloudSyncStatus(),
          Boolean(this.data.syncingCloudData),
        ),
      })
    },

    /**
     * 开启最小本地家庭空间。
     *
     * 调用时机：用户在“我的”页设置区点击家庭空间入口时。
     * 注意事项：当前版本只生成 familyId 供记录可见范围绑定，不做成员邀请、跨账号查询或权限共享。
     */
    onCreateFamilySpace() {
      if (!FAMILY_SPACE_FEATURE_ENABLED) {
        wx.showToast({
          title: '家庭空间开发中',
          icon: 'none',
        })
        return
      }

      const existingFamilyState = loadFamilyState()

      if (existingFamilyState) {
        this.setData({
          familyState: existingFamilyState,
          familyStateView: buildFamilyStateView(existingFamilyState),
        })
        wx.showToast({
          title: '家庭空间已开启',
          icon: 'none',
        })
        return
      }

      wx.showModal({
        title: '开启家庭空间',
        content: '开启后，记录表单可以选择“家庭可见”。当前版本仅保存可见范围，不做成员邀请和跨账号共享。',
        confirmText: '开启',
        success: (result) => {
          if (!result.confirm) {
            return
          }

          const familyState = createLocalFamilyState()
          this.setData({
            familyState,
            familyStateView: buildFamilyStateView(familyState),
          })
          this.refreshCloudSyncStatus()
          wx.showToast({
            title: '已开启家庭空间',
            icon: 'none',
          })
        },
      })
    },

    /**
     * 用户手动触发云同步重试/检查。
     *
     * 调用时机：云同步状态卡按钮点击后。
     * 注意：有 dirtyAt 时会上传本地快照；没有 dirtyAt 时会重新拉取云端，用于验证云函数、集合权限和 openid 状态。
     */
    onRetryCloudSync() {
      if (this.data.syncingCloudData) {
        return
      }

      const currentStatus = loadUserDataCloudSyncStatus()

      console.info('[sixiangSyncUserData] 我的页手动触发云同步检查', {
        hasPendingChanges: currentStatus.hasPendingChanges,
        lastErrorCode: currentStatus.lastErrorCode || '',
      })

      this.setData({ syncingCloudData: true })
      this.refreshCloudSyncStatus()

      retryUserDataCloudSync()
        .then((result) => {
          this.setData({ syncingCloudData: false })
          this.loadMineData()
          wx.showToast({
            title: result ? (currentStatus.hasPendingChanges ? '云同步完成' : '云同步检查完成') : '当前没有待上传改动',
            icon: 'none',
          })
        })
        .catch((error) => {
          console.error('[sixiangSyncUserData] 手动云同步失败', error)
          this.setData({ syncingCloudData: false })
          this.refreshCloudSyncStatus()
          wx.showToast({
            title: getCloudSyncToastError(error),
            icon: 'none',
          })
        })
    },

    loadCloudUserProfile() {
      fetchUserProfileFromCloud()
        .then((userProfile) => {
          this.applyUserProfile(userProfile)
        })
        .catch((error) => {
          console.warn('读取云端用户资料失败', error)
        })
    },

    /**
     * 清空新版本地业务数据，并立即尝试上传空快照覆盖云端。
     *
     * 调用时机：用户点击“清空本地与云端数据”并完成二次确认后。
     * 注意：昵称、头像和登录态不清空；如果云端上传失败，dirtyAt 会保留，用户可在云同步卡片重试。
     */
    clearAllData() {
      if (this.data.clearingAllData) {
        return
      }

      wx.showModal({
        title: '清空本地与云端数据',
        content: '会删除记录库、礼簿、心情记录和本地分类历史，并上传空快照覆盖云端业务数据。昵称、头像和登录状态不会删除。',
        confirmText: '清空',
        confirmColor: '#d45b52',
        success: (result) => {
          if (!result.confirm) {
            return
          }
          wx.showModal({
            title: '是否同时清空小暖？',
            content: '小暖的等级、经验和陪伴天数可以单独保留。清空后无法恢复。',
            confirmText: '一起清空',
            cancelText: '保留小暖',
            confirmColor: '#d45b52',
            success: ({ confirm }) => this.performClearAllData(confirm),
          })
        },
      })
    },

    /** 执行业务数据清空；小暖仅在用户二次确认后单独清除。 */
    performClearAllData(clearCompanion: boolean) {
      try {
        clearAllRememberUserData()
        if (clearCompanion) clearCompanionState()
      } catch (error) {
        console.error('清空记得本地数据失败', error)
        wx.showToast({ title: '清空失败，请稍后重试', icon: 'none' })
        return
      }

      this.setData({ clearingAllData: true, syncingCloudData: true })
      this.loadMineData()
      this.refreshCloudSyncStatus()

      Promise.all([flushUserDataCloudSync(), cancelAllWechatReminders()])
        .then(() => {
          this.setData({ clearingAllData: false, syncingCloudData: false })
          this.loadMineData()
          wx.showToast({ title: clearCompanion ? '数据与小暖已清空' : '数据已清空，小暖已保留', icon: 'none' })
        })
        .catch((error) => {
          console.error('[sixiangSyncUserData] 清空后上传空快照失败', error)
          this.setData({ clearingAllData: false, syncingCloudData: false })
          this.refreshCloudSyncStatus()
          wx.showToast({ title: '本地已清空，云端待重试', icon: 'none' })
        })
    },

    onNicknameInput(event: WechatMiniprogram.Input) {
      const nickName = typeof event.detail.value === 'string' ? event.detail.value.trim() : ''

      this.setData({
        userProfile: {
          ...(this.data.userProfile as UserProfileState),
          nickName,
        },
      })
    },

    onNicknameBlur(event: WechatMiniprogram.Input) {
      const nickName = typeof event.detail.value === 'string' ? event.detail.value.trim() : ''

      this.setData({
        userProfile: saveUserProfile({
          ...(this.data.userProfile as UserProfileState),
          nickName,
        }),
      })
      this.syncProfileToCloud()
    },

    /**
     * 用户选择微信头像后上传到云存储，再把云文件 ID 写入用户资料集合。
     *
     * 调用时机：点击头像按钮并完成 chooseAvatar 选择后。
     * 注意：chooseAvatar 返回的是本机临时路径，必须先上传云存储，不能直接作为跨设备头像保存。
     */
    async onChooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
      const tempAvatarUrl = event && event.detail && typeof event.detail.avatarUrl === 'string'
        ? event.detail.avatarUrl.trim()
        : ''

      if (!tempAvatarUrl || this.data.updatingAvatar) {
        return
      }

      this.setData({
        updatingAvatar: true,
        profileAvatarDisplayUrl: tempAvatarUrl,
      })

      try {
        let loginState = loadUserLoginState()

        if (!loginState.backendLinked || !loginState.openid) {
          loginState = await loginWithWechat()
        }

        if (!loginState.backendLinked || !loginState.openid) {
          throw new Error('云登录未完成，无法同步头像')
        }

        const avatarUrl = await uploadUserAvatarToCloud(tempAvatarUrl, loginState.openid)
        const nextProfile = saveUserProfile({
          ...(this.data.userProfile as UserProfileState),
          avatarUrl,
        })

        this.setData({
          loginState,
          userProfile: nextProfile,
        })

        const syncedProfile = await syncUserProfileToCloud(nextProfile)
        this.applyUserProfile(syncedProfile)
        wx.showToast({
          title: '头像已同步',
          icon: 'none',
        })
      } catch (error) {
        console.warn('用户头像云同步失败', error)
        wx.showToast({
          title: '头像同步失败',
          icon: 'none',
        })
      } finally {
        this.setData({
          updatingAvatar: false,
        })
      }
    },

    /**
     * 统一写入页面用户资料，并解析云头像 fileID 的临时显示地址。
     *
     * 调用时机：云端资料读取成功、资料同步成功后。
     */
    applyUserProfile(userProfile: UserProfileState) {
      this.setData({ userProfile })

      const avatarUrl = userProfile.avatarUrl
      resolveUserAvatarDisplayUrl(avatarUrl)
        .then((profileAvatarDisplayUrl) => {
          const currentProfile = this.data.userProfile as UserProfileState

          if (currentProfile.avatarUrl !== avatarUrl) {
            return
          }

          this.setData({
            profileAvatarDisplayUrl,
          })
        })
        .catch(() => {
          this.setData({
            profileAvatarDisplayUrl: '',
          })
        })
    },

    /**
     * 将昵称和头像写入云端用户资料集合。
     *
     * 调用时机：昵称输入框失焦、头像上传成功后。
     * 注意：云函数按 openid 写入 sixiang_users，前端不保存 openid，也不直接写数据库。
     */
    syncProfileToCloud() {
      syncUserProfileToCloud(this.data.userProfile as UserProfileState)
        .then((userProfile) => {
          this.applyUserProfile(userProfile)
        })
        .catch((error) => {
          console.warn('用户资料云同步失败，已保留当前页面资料', error)
        })
    },
  },
})
