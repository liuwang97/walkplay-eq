/**
 * zh-CN resource bundle.
 *
 * Mirrors the original Walkplay PEQ web app (Vue3 + Element Plus) Chinese UI.
 * Strings were cross-checked against the obfuscated source bundle so wording
 * matches the shipping product where possible.
 *
 * Keep the nested shape in sync with `en.ts` and the `K` map in `../keys.ts`.
 * The `eq.*` and `preset.*` shapes are coordinated with the eq-ui / presets
 * agents (they reference these exact keys).
 */

export const zh = {
  common: {
    appName: "Walkplay EQ",
    ok: "确定",
    cancel: "取消",
    confirm: "确定",
    save: "保存",
    delete: "删除",
    close: "关闭",
    refresh: "刷新",
    retry: "重试",
    loading: "加载中",
    success: "成功",
    failed: "失败",
    error: "错误",
    tip: "提示",
    notice: "通知",
    empty: "暂无内容",
    comingSoon: "敬请期待",
    yes: "是",
    no: "否",
    back: "返回",
    settings: "设置",
    language: "选择语言",
    languageZh: "中文",
    languageEn: "English",
    unknown: "未知",
  },

  tray: {
    open: "打开 EQ 编辑器",
    show: "显示窗口",
    hide: "隐藏窗口",
    connect: "连接设备",
    disconnect: "断开连接",
    autostart: "开机自启动",
    autostartOn: "已开启开机自启动",
    autostartOff: "已关闭开机自启动",
    quit: "退出",
    tooltip: "Walkplay EQ - 音频均衡器",
  },

  connection: {
    status: "连接状态",
    connected: "已连接",
    disconnected: "未连接",
    connecting: "连接中",
    reconnecting: "重新连接中",
    connect: "连接",
    disconnect: "断开",
    connectDevice: "连接设备",
    noDevice: "未检测到设备",
    selectDevice: "请选择设备",
    deviceLost: "设备连接已断开",
    deviceInitFailed: "设备初始化失败",
    initializing: "初始化中",
    initSuccess: "初始化成功",
    initFailed: "初始化失败",
    pleaseConnectFirst: "请先连接设备",
    handshakeFailed: "握手失败",
    unknownResponse: "未知响应",
  },

  eq: {
    title: "EQ 音效",
    soundEffect: "音效",
    multiEffect: "多功能音效",
    digitalFilter: "数字滤波器",
    microphone: "麦克风",
    micMonitor: "耳返",
    micMonitorOn: "耳返开启",
    micMonitorOff: "耳返停用",
    micUnavailable: "无法访问麦克风",
    micCloseBrowser: "请关闭浏览器麦克风后才能使用该功能",
    volume: "音量",
    channelAngle: "声道角度",

    preamp: "前置增益",
    preGain: "全局增益",
    band: "频段",
    frequency: "频率",
    gain: "增益",
    q: "Q 值",
    type: "类型",

    // Per-band controls (eq-ui agent)
    bandShort: "频段 {{n}}",
    bandsBadge: "{{count}} 个频段",
    enableBand: "启用该频段",
    freqHz: "频率 (Hz)",
    gainDb: "增益 (dB)",

    // Band / filter types (referenced as eq.bandType.<PK|LS|HS>)
    bandType: {
      PK: "峰值 (PK)",
      LS: "低架 (LS)",
      HS: "高架 (HS)",
      LP: "低通",
      HP: "高通",
      BP: "带通",
      NOTCH: "陷波",
      LOWDELAY: "低延迟滤波器",
      PHASECOMP: "相位补偿滤波器",
      STEEP: "陡降",
      GENTLE: "缓降",
    },

    // Action buttons (referenced as eq.actions.*)
    actions: {
      apply: "使用",
      audition: "试听",
      clear: "清除调整",
      clearHint: "清除当前所有频段调整",
      factoryReset: "恢复出厂",
      factoryResetHint: "将设备恢复到出厂默认设置",
      disconnect: "断开",
      saveCustom: "保存为自定义EQ",
      updateCustom: "更新自定义EQ",
      share: "分享EQ",
    },

    // Transient toast / notification messages (referenced as eq.toast.*)
    toast: {
      cleared: "已清除调整",
      factoryReset: "已恢复出厂设置",
      factoryResetFailed: "恢复出厂失败",
      savePending: "正在保存自定义EQ…",
      updatePending: "正在更新自定义EQ…",
      sharePending: "正在分享EQ…",
      writeSuccess: "写入成功",
      writeFailed: "写入设备失败",
      saveSuccess: "保存成功",
      deleteSuccess: "删除成功",
    },

    writeToDevice: "写入设备",
    readDevice: "读取设备",
    reread: "重新读取",
    paramsIncomplete: "参数不完整",
    unstableFilter: "滤波器不稳定",
    deviceUnsupported: "设备暂不支持",
    chipUnsupported: "芯片不支持",
    selectPresetFirst: "请先选择右边的一个预设后再进行操作",
  },

  // Flat namespace consumed by the presets agent via K.presets.* and
  // raw "presets.<x>" lookups. Labels for tabs / row actions.
  presets: {
    title: "预设",
    preset: "预设",
    custom: "自定义",
    online: "在线",
    myShares: "我的分享",
    use: "使用",
    audition: "试听",
    stop: "停止",
    like: "点赞",
    retry: "重试",
  },

  // Nested namespace consumed by the presets agent via raw "preset.<x>.<y>"
  // lookups. Holds tab/action/empty/error/toast detail strings.
  preset: {
    title: "预设",
    loading: "加载中",
    tab: {
      builtin: "预设",
      custom: "自定义",
      online: "在线",
      shared: "我的分享",
    },
    action: {
      use: "使用",
      audition: "试听",
      stop: "停止",
      like: "点赞",
      retry: "重试",
      rename: "重命名",
      delete: "删除",
      more: "更多",
    },
    rename: {
      title: "重命名预设",
      placeholder: "输入预设名称",
      confirm: "确定",
      cancel: "取消",
    },
    remove: {
      title: "删除预设",
      description: "确定要删除该自定义预设吗？此操作不可撤销。",
      confirm: "删除",
      cancel: "取消",
    },
    toastRenamed: "已重命名为「{{name}}」",
    toastDeleted: "已删除「{{name}}」",
    empty: {
      custom: "暂无自定义预设",
      online: "暂无在线预设",
      shared: "暂无分享内容",
    },
    error: {
      load: "加载失败",
    },
    toast: {
      applied: "已应用预设",
    },
    default: "默认",
    collected: "收藏",
    sortByDate: "日期时间",
    sortByLikes: "点赞倒序",
    sortByCollect: "收藏倒序",
    sortByViews: "浏览数倒序",
    collect: "收藏",
    uncollect: "取消收藏",
    enterShareTitle: "请输入分享标题",
    shareTitle: "标题",
    enterNickname: "请输入昵称",
  },

  firmware: {
    title: "固件升级",
    upgrade: "固件升级",
    startUpgrade: "开始升级",
    upgrading: "升级中",
    upgradeComplete: "升级完成",
    checkVersion: "检查版本",
    checkFirmwareVersion: "检查固件版本",
    currentVersion: "当前设备版本",
    latestVersion: "最新版本",
    firmwareName: "固件名称",
    loadingFirmware: "正在加载固件",
    loadFirmware: "加载固件",
    firmwareNotDownloaded: "固件未下载",
    download: "下载",
    burning: "烧录中",
    burnReady: "烧录状态就绪",
    burnComplete: "固件烧录完成",
    flashComplete: "固件烧录完成",
    autoUpgrade: "自动开始升级",
    cannotAutoUpgrade: "无法自动升级",
    rescueMode: "救砖模式",
    deviceType: "设备类型",
    deviceTypeUnknown: "设备类型未知",
    checksumMissing: "校验码不存在",
    getInfoFailed: "获取升级信息失败",
    pleaseWait: "请稍候",
    doNotDisconnect: "升级过程中请不要断开设备连接",
    plugInstruction: "请将您的音频设备通过 USB 接口或者转接口插入到您的计算机",
    selectInPopup: "请在选择弹窗中的设备",
    clickConnect: "点击连接按钮进入升级模式",
    step: "步骤 {{n}}",
    backToHome: "回到官网首页",
  },

  auth: {
    login: "登录",
    logout: "退出登录",
    register: "注册",
    registerNew: "注册新账号",
    loginTo: "登录到",
    wechatLogin: "使用微信登录",
    wechatScanTip: "请使用微信扫一扫登录",
    emailLogin: "使用邮箱",
    vcodeLogin: "手机验证码登录",
    passwordLogin: "使用账号密码登录",
    account: "账号",
    enterAccount: "请输入账号",
    email: "邮箱",
    enterEmail: "请输入邮箱",
    password: "密码",
    enterPassword: "请输入密码",
    vcode: "验证码",
    enterVcode: "请输入验证码",
    getVcode: "获取验证码",
    sendVcode: "发送验证码",
    vcodeSent: "发送成功",
    vcodeError: "验证码错误",
    resendAfter: "{{seconds}} 秒后重新获取",
    rememberAccount: "记住账号",
    forgotPassword: "忘记密码",
    hasAccount: "已有账号",
    noAccount: "没有账号吗",
    agreePrefix: "我已阅读并同意",
    userAgreement: "用户协议",
    and: "和",
    privacyPolicy: "隐私条款",
    nickname: "昵称",
    enterNickname: "请输入昵称",
    changeEmail: "修改绑定",
    userNotExist: "用户信息不存在",
    passwordTooShort: "密码不能少于 {{count}} 位",
    confirmGetVcode: "您确定获取验证码吗",
    bestExperienceTip: "为了获得最佳体验，我们建议您使用谷歌浏览器",
  },

  share: {
    share: "分享",
    shareEq: "分享EQ",
    title: "标题",
    enterTitle: "请输入分享标题",
    upload: "上传",
    uploadSuccess: "分享成功",
    auditing: "审核中",
    auditRejected: "审核不通过",
    views: "浏览数",
    likes: "点赞",
    collects: "收藏",
  },

  comment: {
    comment: "评论",
    comments: "评论",
    submit: "提交",
    enterComment: "请输入评论内容",
    list: "评论列表",
    like: "点赞",
    report: "举报",
    reportSuccess: "举报成功",
    enterReport: "请输入举报内容",
    empty: "暂无评论",
  },

  errors: {
    serverError: "服务器错误",
    requestError: "请求错误",
    networkError: "网络错误",
    notSupported: "当前浏览器不支持",
    cannotEmpty: "不能为空",
    checkAndRetry: "请检查后再试",
    confirmContinue: "您确认要继续操作吗",
  },
} as const;

/**
 * Deeply widen all string-literal leaves to `string` so the en bundle can be
 * typed against the same structural shape without being forced to repeat the
 * Chinese literals. Nested objects are preserved so the key paths stay exact.
 */
type DeepWiden<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepWiden<T[K]>;
};

/** Structural shape shared by every locale bundle. */
export type LocaleResources = DeepWiden<typeof zh>;

/** Back-compat alias used by keys.ts / index.ts. */
export type ZhResources = LocaleResources;

export default zh;
