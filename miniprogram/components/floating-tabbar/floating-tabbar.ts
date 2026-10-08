type MainTabKey = 'today' | 'checkins' | 'records' | 'calendar' | 'mine'

const ROUTES: Record<MainTabKey, string> = {
  today: '/pages/today/today',
  checkins: '/pages/checkins/checkins',
  records: '/pages/records/records',
  calendar: '/pages/calendar/calendar',
  mine: '/pages/mine/mine',
}

Component({
  properties: {
    active: {
      type: String,
      value: 'today',
    },
    // 个别业务页可接管悬浮加号；默认仍打开统一记录表单，保证其他页面行为不变。
    customCreate: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    tabs: [
      { key: 'today', label: '今日' },
      { key: 'checkins', label: '计划' },
      { key: 'records', label: '记录' },
      { key: 'calendar', label: '总览' },
      { key: 'mine', label: '我的' },
    ],
  },

  methods: {
    /**
     * 跳转主导航页面。
     *
     * 参数：data-key 来自五个固定主 tab。
     * 注意：主页面之间使用 redirectTo，避免页面栈被重复堆叠。
     */
    onTabTap(event: WechatMiniprogram.BaseEvent) {
      const key = String(event.currentTarget.dataset.key || '') as MainTabKey

      if (!ROUTES[key] || key === this.data.active) {
        return
      }

      wx.redirectTo({ url: ROUTES[key] })
    },

    /**
     * 统一新增入口。
     *
     * 调用时机：用户点击右下角紫色 FAB。
     * 注意：只打开记录表单，不直接创建数据；保存后仍由 record-service 统一处理云同步。
     * 计划页使用每日计划作为默认草稿，其他主页面保存后回到当前页面语境。
     */
    onCreateTap() {
      if (this.data.customCreate) {
        this.triggerEvent('create')
        return
      }

      const active = String(this.data.active || 'today') as MainTabKey
      const source = ROUTES[active] ? active : 'today'
      const query = source === 'checkins'
        ? 'source=checkins&type=todo&recurrence=daily'
        : `source=${source}`

      wx.navigateTo({ url: `/pages/record-form/record-form?${query}` })
    },
  },
})
