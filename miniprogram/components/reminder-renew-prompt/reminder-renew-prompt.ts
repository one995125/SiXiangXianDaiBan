Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '',
    },
    busy: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    confirm() {
      if (!this.data.busy) {
        this.triggerEvent('confirm')
      }
    },
    dismiss() {
      if (!this.data.busy) {
        this.triggerEvent('dismiss')
      }
    },
  },
})
