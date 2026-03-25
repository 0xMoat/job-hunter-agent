export type Locale = 'zh-CN' | 'en'

type StringValue = string
type FnValue = (...args: never[]) => string

type Dict = Record<string, StringValue | FnValue>

const zh: Dict = {
  // Navbar
  tab_chat: '对话',
  tab_picks: '今日推荐',
  logout: '退出',
  lang_toggle: 'EN',
  // Chat panel
  chat_badge: 'AI Agent · 求职助手',
  chat_title: '与 Agent 对话',
  chat_subtitle: '求职专属助手 · 工具调用实时可见',
  chat_empty_heading: '你好，有什么可以帮你？',
  chat_empty_sub: '告诉我你的目标职位、城市和经验，\n我来帮你找机会。',
  chat_placeholder: '输入消息… (Enter 发送，Shift+Enter 换行)',
  chat_send: '发送',
  chat_sending: '…',
  chat_thinking: '正在思考…',
  quick_prompt_1: '帮我找上海的 Agent Engineer 岗位',
  quick_prompt_2: '分析这份 JD 和我的简历是否匹配',
  quick_prompt_3: '帮我制定本周的投递计划',
  // Tool call card
  tool_running: '运行中…',
  // Tracker
  tracker_loading: '加载中…',
  tracker_title: '投递记录',
  tracker_sub_n: (n: number) => `${n} 个进行中`,
  tracker_add: '+ 添加',
  tracker_save: '保存',
  tracker_cancel: '取消',
  tracker_empty_col: '暂无',
  col_applied: '已投递',
  col_interviewing: '面试中',
  col_offer: '已获 Offer',
  col_rejected: '已拒绝',
  status_applied: '已投递',
  status_interviewing: '面试中',
  status_offer: 'Offer 🎉',
  status_rejected: '已拒绝',
  form_company: '公司名称 *',
  form_title_field: '职位名称 *',
  form_url: '职位链接（可选）',
  delete: '删除',
  // Listings
  listings_title: '今日推荐',
  listings_sub_n: (n: number) => `${n} 个职位 · 每日自动更新`,
  listings_sub_empty: '每日 08:00 自动搜索并更新',
  listings_refresh: '刷新',
  listings_loading: '加载中…',
  listings_empty_title: '暂无推荐职位',
  listings_empty_sub: '告诉 Agent 你的每日搜索偏好：',
  listings_empty_hint: '"设置每日搜索：agent engineer，上海，fulltime"',
  // Login
  login_title: 'Job Hunter',
  login_sub: '求职专属 AI 助手',
  login_mode_login: '登录',
  login_mode_register: '注册',
  login_email: '邮箱',
  login_password: '密码',
  login_pw_placeholder_new: '≥8 位，含大小写字母、数字、特殊符号',
  login_pw_placeholder_existing: '请输入密码',
  login_submit_login: '登录',
  login_submit_register: '创建账号',
  login_loading: '请稍候…',
  // Sidebar
  sidebar_new_chat: '＋ 新建对话',
  sidebar_empty: '还没有对话记录',
  sidebar_today: '今天',
  sidebar_yesterday: '昨天',
}

const en: Dict = {
  // Navbar
  tab_chat: 'Chat',
  tab_picks: "Today's Picks",
  logout: 'Logout',
  lang_toggle: '中文',
  // Chat panel
  chat_badge: 'AI Agent · Job Hunter',
  chat_title: 'Agent Chat',
  chat_subtitle: 'Job-hunting specialist · tool calls shown inline',
  chat_empty_heading: 'How can I help you?',
  chat_empty_sub: "Tell me your target role, city, and experience.\nI'll find the right opportunities.",
  chat_placeholder: 'Type a message… (Enter to send, Shift+Enter for newline)',
  chat_send: 'Send',
  chat_sending: '…',
  chat_thinking: 'Thinking…',
  quick_prompt_1: 'Find Agent Engineer roles in Shanghai',
  quick_prompt_2: 'Does this JD match my resume?',
  quick_prompt_3: 'Help me plan my applications this week',
  // Tool call card
  tool_running: 'running…',
  // Tracker
  tracker_loading: 'Loading…',
  tracker_title: 'Applications',
  tracker_sub_n: (n: number) => `${n} tracked`,
  tracker_add: '+ Add',
  tracker_save: 'Save',
  tracker_cancel: 'Cancel',
  tracker_empty_col: 'None yet',
  col_applied: 'Applied',
  col_interviewing: 'Interviewing',
  col_offer: 'Offer',
  col_rejected: 'Rejected',
  status_applied: 'Applied',
  status_interviewing: 'Interviewing',
  status_offer: 'Offer 🎉',
  status_rejected: 'Rejected',
  form_company: 'Company name *',
  form_title_field: 'Job title *',
  form_url: 'URL (optional)',
  delete: 'Delete',
  // Listings
  listings_title: "Today's Picks",
  listings_sub_n: (n: number) => `${n} listings from daily search`,
  listings_sub_empty: 'Daily search results — updated every morning at 08:00',
  listings_refresh: 'Refresh',
  listings_loading: 'Loading listings…',
  listings_empty_title: 'No listings yet',
  listings_empty_sub: 'Tell the agent your daily search preferences:',
  listings_empty_hint: '"Set daily search: agent engineer, Shanghai, fulltime"',
  // Login
  login_title: 'Job Hunter',
  login_sub: 'AI-powered job hunting assistant',
  login_mode_login: 'Login',
  login_mode_register: 'Register',
  login_email: 'Email',
  login_password: 'Password',
  login_pw_placeholder_new: '≥8 chars, A-Z, a-z, 0-9, special (!@#…)',
  login_pw_placeholder_existing: 'Your password',
  login_submit_login: 'Login',
  login_submit_register: 'Create Account',
  login_loading: 'Please wait…',
  // Sidebar
  sidebar_new_chat: '+ New Chat',
  sidebar_empty: 'No conversations yet',
  sidebar_today: 'Today',
  sidebar_yesterday: 'Yesterday',
}

const dicts: Record<Locale, Dict> = { 'zh-CN': zh, en }

export function t(locale: Locale, key: string, ...args: unknown[]): string {
  const entry = dicts[locale]?.[key] ?? dicts['en'][key] ?? key
  if (typeof entry === 'function') return (entry as (...args: unknown[]) => string)(...args)
  return entry
}
