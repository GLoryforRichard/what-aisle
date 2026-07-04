/**
 * Minimal client-side i18n for Wherebear.
 *
 * Why hand-rolled: the user-facing UI is small (4 screens + the result card)
 * and the demo runs on a single device. Pulling in next-intl / react-intl for
 * ~150 strings would add bundle weight, a config layer, and a translation
 * file pipeline we don't need.
 *
 * How it works:
 * - Language is stored in localStorage under WHEREBEAR_LANG_KEY.
 * - `useTranslation()` subscribes via a 'storage' event + a custom
 *   'wherebear:langchange' event so multi-tab toggles also propagate.
 * - `t(key)` returns the active language's string, falling back to English
 *   if the key is missing in the active dict.
 * - Strings the LLM produces (search answers, agent messages) are NOT
 *   translated here — those are already bilingual via Agent B's answer_en
 *   + answer_zh fields.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';

export type Language = 'en' | 'zh';

const WHEREBEAR_LANG_KEY = 'wherebear:lang';
const LANG_CHANGE_EVENT = 'wherebear:langchange';

export const STRINGS = {
  en: {
    app_name: 'Wherebear',

    // Tab + nav
    home: 'Home',
    snap: 'Snap shelf',
    find: 'Find item',
    history: 'History',

    // HomeScreen
    home_tagline: 'Ask the bear. Find the aisle.',
    home_snap_desc: "Snap any shelf — it remembers what's there.",
    home_find_desc: 'Search by name, brand, or description in any language.',
    home_recent: 'Recent activity',
    home_no_activity: 'No activity yet. Snap a shelf to get started.',
    home_smarter: 'The more you snap, the smarter it gets.',
    home_stat_products: 'in memory',
    home_stat_today: 'helped today',
    home_stat_hit: 'found-it rate',
    home_stat_last: 'last found',

    // SnapScreen
    snap_back: 'Back',
    snap_location: 'Shelf location',
    snap_add_multi: 'Add multiple photos from gallery',
    snap_add_more: 'Add more photos',
    snap_photos: 'Photos',
    snap_reading: 'reading',
    snap_failed: 'failed',
    snap_detected: 'Found on the shelf',
    snap_unique: 'unique',
    snap_empty: 'Add one or more photos to detect products',
    snap_reading_n: (n: number) => `Bear is reading ${n} shelf photo${n === 1 ? '' : 's'}…`,
    snap_nothing: (n: number) => `Nothing detected across ${n} photo${n === 1 ? '' : 's'}. Try clearer shots.`,
    snap_save_n: (n: number, code: string) => `Save ${n} product${n === 1 ? '' : 's'} to ${code}`,
    snap_save_first: 'Add a photo first',
    snap_save_busy: (d: number, t: number) => `Reading shelf… (${d}/${t})`,
    snap_save_nothing: 'Nothing to save',
    snap_save_retry: 'Try a clearer photo',
    snap_tip: 'Tip: multi-select your whole aisle for one fast pass.',
    snap_showing_photo: (i: number, n: number, total: number) => `Showing photo ${i} of ${n} · merged total ${total}`,
    snap_show_all: 'Show all',
    snap_empty_photo: 'No items in this photo. Tap "Show all" to see other photos.',
    snap_choose_shelf: 'Tap to choose a shelf',
    snap_choose_first: 'Choose a shelf first, then take or upload photos.',

    // ProgressScreen
    progress_title: 'Building memory',
    progress_running: (n: number) => `Wherebear is processing ${n} items…`,
    progress_done: 'All set — memory saved.',
    progress_error: 'Something went wrong.',
    progress_saved_chat: 'Saved! 🐾',
    progress_running_chat: "I'm on it!",
    progress_btn_snap: 'Snap another shelf',
    progress_btn_find: 'Find',
    progress_btn_home: 'Home',

    // FindScreen
    find_back: 'Back',
    find_title: 'Find item',
    find_possible_matches: 'possible items',
    find_fb_prompt: 'Was this right?',
    find_fb_correct: 'This one',
    find_fb_none: 'None of these',
    find_fb_saved: 'Thanks — noted',
    find_tap_zoom: 'Tap to zoom',
    find_guess_title: 'Maybe nearby — a guess',
    find_guess_note: 'Not the exact item. These are same-brand or same-category — shown only as a rough location hint.',
    find_placeholder: 'What are they looking for?',
    find_suggestions: 'Try',
    find_recent: 'Recent',
    find_you_might_mean: 'You might mean',
    find_match: 'Match',
    find_seen: 'seen',
    find_aka: 'Also known as',
    find_search_again: 'Search again',
    find_no_record: 'No location record found yet.',
    find_try_other: 'Try another phrase, or snap the shelf where it lives.',
    find_seen_on_n: (n: number) => `seen on ${n} shelves`,
    find_likely: 'Likely',
    find_locating: 'finding the aisle…',
    find_loading: 'The bear is on it…',

    // Route split: customer home + staff workspace
    staff_entry: 'Staff workspace',
    cust_find_desc: 'Search by name, brand, or description — in any language.',
    admin_title: 'Staff workspace',
    admin_subtitle: 'Add shelves, manage saved products, try a search.',
    admin_manage_title: 'Shelf admin',
    admin_manage_desc: 'View, edit, or delete saved products.',
    admin_test_title: 'Try a search',
    admin_test_desc: 'Run a customer query to check results.',
    admin_debug_title: 'DB debug',
    admin_debug_desc: 'Raw database inspector.',
    admin_customer_view: 'Customer view',
    admin_dashboard: 'Dashboard',
    admin_searchlog: 'Search history',
    passcode_title: 'Staff access',
    passcode_hint: 'Enter passcode',
    passcode_cancel: 'Cancel',
    passcode_error: 'Wrong passcode — try again',
    passcode_rate_limited: 'Too many attempts. Wait a minute, then retry.',

    // Superadmin console (founder-only, PRD F-12)
    sa_title: 'Superadmin',
    sa_login_title: 'Founder console',
    sa_login_hint: 'Enter the superadmin token',
    sa_login_submit: 'Enter',
    sa_login_error: 'Wrong token',
    sa_login_rate_limited: 'Too many attempts. Wait a minute, then retry.',
    sa_stores: 'Stores',
    sa_col_store: 'Store',
    sa_col_status: 'Status',
    sa_col_products: 'Products',
    sa_col_updated: 'Updated',
    sa_col_video: 'Video',
    sa_col_actions: 'Actions',
    sa_no_stores: 'No stores yet.',
    sa_go_live: 'Go Live',
    sa_suspend: 'Suspend',
    sa_reactivate: 'Reactivate',
    sa_confirm_go_live: (slug: string) => `Set ${slug} LIVE?`,
    sa_confirm_suspend: (slug: string) => `Suspend ${slug}? Customers will see a "store paused" page.`,
    sa_confirm_reactivate: (slug: string) => `Reactivate ${slug}?`,
    sa_action_failed: 'Action failed',
    sa_open_store: 'Open store',
    sa_detail_back: 'All stores',
    sa_section_status: 'Status & billing',
    sa_section_shelves: 'Shelf taxonomy',
    sa_section_floorplan: 'Floorplan',
    sa_section_passcode: 'Staff passcode',
    sa_import_template: 'Import template',
    sa_save: 'Save',
    sa_saving: 'Saving…',
    sa_saved: 'Saved',
    sa_preview: 'Preview',
    sa_shelves_count: (n: number) => `${n} shelves`,
    sa_rects_count: (n: number) => `${n} rects`,
    sa_invalid_json: 'Invalid JSON',
    sa_reset_passcode: 'Reset passcode',
    sa_confirm_reset_passcode: 'Reset the staff passcode? Old sessions and the old code stop working immediately.',
    sa_new_passcode: 'New passcode (shown once — write it down):',
    sa_passcode_note: 'The passcode is stored as a bcrypt hash; it can only be reset, never read back.',
    sa_field_slug: 'Slug',
    sa_field_name: 'Name',
    sa_field_created: 'Created',
    sa_field_updated: 'Updated',
    sa_field_video: 'Walkthrough video',
    sa_field_portal_user: 'Portal user',
    sa_field_stripe_customer: 'Stripe customer',
    sa_field_subscription: 'Subscription',
    sa_none: 'none',
    sa_logout: 'Log out',

    // Voice search (push-to-talk)
    voice_hold: 'Hold to talk',
    voice_recording: 'Recording…',
    voice_transcribing: 'Recognizing…',
    voice_heard: 'Heard',
    voice_search_this: 'Search this',
    voice_retry: 'Retry',
    voice_mic_denied: 'Microphone blocked — allow mic access to use voice.',
    voice_unsupported: "Voice input isn't available on this device.",
    voice_error: "Didn't catch that — hold and try again.",
    voice_confirm_hint: 'Check with the customer this is the right item, then search.',

    // Photo identify
    photo_btn: 'Snap a photo',
    photo_identifying: 'Identifying…',
    photo_error: "Couldn't identify — try another photo.",

    // Search-result store map
    result_map_title: 'Where to find it',
    result_map_multi_hint: 'Stocked on several shelves — tap one to see it on the map.',

    // Agent panel — search steps (Agent B)
    step_find_intent: 'Understanding the request',
    step_find_search: "Searching the store's memory",
    step_find_category: 'Looking for similar items',
    step_find_log: 'Saving this search',
    step_find_finish: 'Preparing the answer',
    sum_intent: (lang: string, q: string) => `${lang} · "${q}"`,
    sum_search_hit: (name: string) => `Closest match: ${name}`,
    sum_search_none: 'No match yet',
    sum_category: (n: number) => `Similar items on ${n} shelf${n === 1 ? '' : 'es'}`,
    // Agent panel — snap/save steps
    step_snap_check: "Checking what's already known",
    step_snap_alias: 'Learning its names in every language',
    step_snap_save: "Saving to the store's memory",
    step_snap_evidence: 'Remembering this shelf',
    step_snap_finish: 'Done',
    sum_check: (known: number, neu: number) => `${known} known · ${neu} new`,
    sum_check_known: 'known',
    sum_check_new: 'new',
    sum_save: (added: number, updated: number) => `${added} added · ${updated} updated`,
    sum_save_one: (n: number) => `seen ${n}×`,
    sum_alias: (n: number) => `${n} names learned`,
    sum_alias_batch: (n: number) => `names for ${n} products`,
    sum_evidence: 'Shelf remembered',
    // Agent panel — chrome
    panel_find_title: (n: number) => `How it searched · ${n} step${n === 1 ? '' : 's'}`,
    panel_snap_title: (n: number) => `How it's remembering · ${n} step${n === 1 ? '' : 's'}`,
    panel_snap_waiting: 'Getting started…',
    panel_batch: (i: number, n: number) => `Part ${i} of ${n}`,
    panel_bg_alias: 'Learning more languages for the new items in the background…',
    // Result-card confidence (replaces the cold "Match 51%")
    conf_high: 'Very likely this',
    conf_mid: 'Close match',
    conf_low: 'Rough guess',
    // Progress saved detail (front-end generated so it's bilingual)
    progress_saved_detail: (added: number, updated: number) => `${added} new · ${updated} updated`,
    // Detected-language readable names
    lang_zh: 'Chinese', lang_en: 'English', lang_ja: 'Japanese', lang_ko: 'Korean',
    err_busy: 'Too busy right now — try again in a moment.',
    err_generic: 'Something went wrong — give it another try.',
    // Store config load failure (shelf pickers / store map)
    config_load_error: 'Store info failed to load.',
    config_retry: 'Retry',

    // Shelf admin — product write actions (task #9)
    shelf_admin_title: 'Shelf admin',
    shelf_admin_subtitle: 'Tap a shelf to view or edit its products.',
    shelf_admin_back_workspace: 'Workspace',
    shelf_admin_back_shelves: 'shelves',
    shelf_admin_add: 'add',
    shelf_admin_refresh: 'refresh',
    shelf_admin_edit: 'edit',
    shelf_admin_delete: 'delete',
    shelf_admin_clear: 'clear',
    shelf_admin_loading: 'Loading…',
    shelf_admin_empty: 'No products on this shelf yet.',
    shelf_admin_products_n: (n: number) => `${n} products`,
    shelf_admin_confirm_delete: (name: string) => `Delete "${name}"?`,
    shelf_admin_confirm_clear: (n: number, code: string) =>
      `Delete all ${n} product${n === 1 ? '' : 's'} on shelf ${code}?`,
    shelf_admin_clear_title: (n: number, code: string) =>
      `Delete all ${n} products on ${code}`,
    shelf_admin_edit_title: 'Edit product',
    shelf_admin_add_title: 'Add product',
    shelf_admin_cancel: 'Cancel',
    shelf_admin_save: 'Save',
    shelf_admin_saving: 'Saving…',
    shelf_admin_field_aliases: 'aliases (one per line)',
    shelf_admin_field_category_ph: 'e.g. noodle, sauce, snack',
    shelf_admin_err_write: 'Write failed — please try again.',
    shelf_admin_session_expired: 'Session expired — re-enter the passcode.',
    shelf_admin_reauth: 'Re-enter passcode',
  },
  zh: {
    app_name: '找货熊',

    home: '首页',
    snap: '扫货架',
    find: '找商品',
    history: '历史',

    home_tagline: '问问小熊，秒找货架。',
    home_snap_desc: '拍下任意货架，它就记住了。',
    home_find_desc: '任何语言的品名、品牌或描述都可以搜。',
    home_recent: '最近动作',
    home_no_activity: '还没扫过任何货架，先去拍一张吧。',
    home_smarter: '你拍得越多，它就越聪明。',
    home_stat_products: '件已记忆',
    home_stat_today: '今日帮忙',
    home_stat_hit: '找得准',
    home_stat_last: '最近找过',

    snap_back: '返回',
    snap_location: '货架位置',
    snap_add_multi: '从相册批量添加照片',
    snap_add_more: '继续添加照片',
    snap_photos: '照片',
    snap_reading: '识别中',
    snap_failed: '失败',
    snap_detected: '货架上找到的',
    snap_unique: '种',
    snap_empty: '添加一张或多张照片以识别商品',
    snap_reading_n: (n: number) => `小熊正在读 ${n} 张货架照片…`,
    snap_nothing: (n: number) => `${n} 张照片都没识别出商品，换个清晰点的角度试试。`,
    snap_save_n: (n: number, code: string) => `保存 ${n} 个商品到 ${code}`,
    snap_save_first: '先添加照片',
    snap_save_busy: (d: number, t: number) => `识别中… (${d}/${t})`,
    snap_save_nothing: '没有可保存的商品',
    snap_save_retry: '换张清晰点的照片',
    snap_tip: '小贴士：整行货架一次性多选，最快。',
    snap_showing_photo: (i: number, n: number, total: number) => `当前第 ${i}/${n} 张 · 全部合并共 ${total} 种`,
    snap_show_all: '显示全部',
    snap_empty_photo: '这张没识别到商品，点"显示全部"看其他照片。',
    snap_choose_shelf: '点这里选择货架',
    snap_choose_first: '请先选择货架，再拍照或上传照片。',

    progress_title: '建立记忆',
    progress_running: (n: number) => `小熊正在处理 ${n} 个商品…`,
    progress_done: '搞定 — 记忆已保存。',
    progress_error: '出错了。',
    progress_saved_chat: '保存好啦！🐾',
    progress_running_chat: '我在忙！',
    progress_btn_snap: '继续扫下一行',
    progress_btn_find: '搜索',
    progress_btn_home: '首页',

    find_back: '返回',
    find_title: '找商品',
    find_possible_matches: '个可能的商品',
    find_fb_prompt: '找对了吗？',
    find_fb_correct: '就是这个',
    find_fb_none: '都不对',
    find_fb_saved: '已记录',
    find_tap_zoom: '点击放大',
    find_guess_title: '可能在这附近（猜测）',
    find_guess_note: '不是你要找的商品 —— 这些是同品牌或同类的,只给个大概位置参考。',
    find_placeholder: '顾客在找什么？',
    find_suggestions: '试试',
    find_recent: '最近搜索',
    find_you_might_mean: '可能是',
    find_match: '匹配度',
    find_seen: '出现',
    find_aka: '别名',
    find_search_again: '重新搜索',
    find_no_record: '暂时没有该商品的位置记录。',
    find_try_other: '换个说法，或去对应货架扫一张照片。',
    find_seen_on_n: (n: number) => `在 ${n} 个货架都见过`,
    find_likely: '应该是',
    find_locating: '正在找货架…',
    find_loading: '小熊出动找货中…',

    // Route split: customer home + staff workspace
    staff_entry: '店员工作台',
    cust_find_desc: '用品名、品牌或描述搜索 —— 任何语言都行。',
    admin_title: '员工工作台',
    admin_subtitle: '添加货架、管理已存商品、试搜一下。',
    admin_manage_title: '货架管理',
    admin_manage_desc: '查看、编辑或删除已保存的商品。',
    admin_test_title: '试搜一下',
    admin_test_desc: '用顾客的说法搜一下，检查结果。',
    admin_debug_title: '数据库调试',
    admin_debug_desc: '原始数据库查看器。',
    admin_customer_view: '顾客视图',
    admin_dashboard: '操作统计',
    admin_searchlog: '搜索历史',
    passcode_title: '店员入口',
    passcode_hint: '请输入密码',
    passcode_cancel: '取消',
    passcode_error: '密码不对，再试一次',
    passcode_rate_limited: '尝试次数过多，请一分钟后再试。',

    // Superadmin console (founder-only, PRD F-12)
    sa_title: '超级管理',
    sa_login_title: '创始人控制台',
    sa_login_hint: '请输入 superadmin 令牌',
    sa_login_submit: '进入',
    sa_login_error: '令牌不正确',
    sa_login_rate_limited: '尝试次数过多，请一分钟后再试。',
    sa_stores: '店铺',
    sa_col_store: '店铺',
    sa_col_status: '状态',
    sa_col_products: '商品数',
    sa_col_updated: '更新时间',
    sa_col_video: '视频',
    sa_col_actions: '操作',
    sa_no_stores: '还没有店铺。',
    sa_go_live: '上线',
    sa_suspend: '暂停',
    sa_reactivate: '恢复上线',
    sa_confirm_go_live: (slug: string) => `确认让 ${slug} 上线？`,
    sa_confirm_suspend: (slug: string) => `确认暂停 ${slug}？顾客将看到“店铺已暂停”页面。`,
    sa_confirm_reactivate: (slug: string) => `确认恢复 ${slug}？`,
    sa_action_failed: '操作失败',
    sa_open_store: '打开店铺',
    sa_detail_back: '全部店铺',
    sa_section_status: '状态与账务',
    sa_section_shelves: '货架表',
    sa_section_floorplan: '平面图',
    sa_section_passcode: '店员密码',
    sa_import_template: '从模板导入',
    sa_save: '保存',
    sa_saving: '保存中…',
    sa_saved: '已保存',
    sa_preview: '预览',
    sa_shelves_count: (n: number) => `${n} 个货架`,
    sa_rects_count: (n: number) => `${n} 个区块`,
    sa_invalid_json: 'JSON 格式错误',
    sa_reset_passcode: '重置密码',
    sa_confirm_reset_passcode: '确认重置店员密码？旧密码和已登录的会话会立即失效。',
    sa_new_passcode: '新密码（仅显示一次，请记下）：',
    sa_passcode_note: '密码以 bcrypt 哈希存储，只能重置，无法查看。',
    sa_field_slug: 'Slug',
    sa_field_name: '店名',
    sa_field_created: '创建时间',
    sa_field_updated: '更新时间',
    sa_field_video: '布局视频',
    sa_field_portal_user: '门户用户',
    sa_field_stripe_customer: 'Stripe 客户',
    sa_field_subscription: '订阅',
    sa_none: '无',
    sa_logout: '退出',

    // Voice search (push-to-talk)
    voice_hold: '按住说话',
    voice_recording: '正在录音…',
    voice_transcribing: '识别中…',
    voice_heard: '识别到',
    voice_search_this: '就搜这个',
    voice_retry: '重说',
    voice_mic_denied: '麦克风被拦截，请允许麦克风权限。',
    voice_unsupported: '此设备不支持语音输入。',
    voice_error: '没听清，按住再说一次。',
    voice_confirm_hint: '和顾客确认是这个，再点搜索。',

    // Photo identify
    photo_btn: '拍照识别',
    photo_identifying: '识别中…',
    photo_error: '没认出来，换张照片试试。',

    // Search-result store map
    result_map_title: '货架位置',
    result_map_multi_hint: '多个货架都有，点一个在地图上看。',

    // Agent panel — search steps
    step_find_intent: '正在理解你的需求',
    step_find_search: '正在搜索店面记忆',
    step_find_category: '正在找相似商品',
    step_find_log: '正在记录这次搜索',
    step_find_finish: '正在准备答案',
    sum_intent: (lang: string, q: string) => `${lang} · 「${q}」`,
    sum_search_hit: (name: string) => `最接近:${name}`,
    sum_search_none: '暂时没找到',
    sum_category: (n: number) => `${n} 个货架有相似商品`,
    // Agent panel — snap/save steps
    step_snap_check: '正在核对已知商品',
    step_snap_alias: '正在学习多语言叫法',
    step_snap_save: '正在存入店面记忆',
    step_snap_evidence: '正在记住这个货架',
    step_snap_finish: '完成',
    sum_check: (known: number, neu: number) => `已知 ${known} 件 · 新商品 ${neu} 件`,
    sum_check_known: '已知',
    sum_check_new: '新商品',
    sum_save: (added: number, updated: number) => `新增 ${added} · 更新 ${updated}`,
    sum_save_one: (n: number) => `见过 ${n} 次`,
    sum_alias: (n: number) => `学会 ${n} 种叫法`,
    sum_alias_batch: (n: number) => `${n} 件商品的多语言叫法`,
    sum_evidence: '货架已记住',
    // Agent panel — chrome
    panel_find_title: (n: number) => `查找过程 · ${n} 步`,
    panel_snap_title: (n: number) => `记忆过程 · ${n} 步`,
    panel_snap_waiting: '正在准备…',
    panel_batch: (i: number, n: number) => `第 ${i} / ${n} 批`,
    panel_bg_alias: '正在后台为新商品补充多语言叫法…',
    // Result-card confidence
    conf_high: '很可能就是它',
    conf_mid: '比较接近',
    conf_low: '大概在这附近',
    // Progress saved detail
    progress_saved_detail: (added: number, updated: number) => `新增 ${added} · 更新 ${updated}`,
    // Detected-language readable names
    lang_zh: '中文', lang_en: 'English', lang_ja: '日本語', lang_ko: '한국어',
    err_busy: '现在有点忙，稍等片刻再试。',
    err_generic: '出了点小问题，再试一次吧。',
    // Store config load failure (shelf pickers / store map)
    config_load_error: '店铺信息加载失败。',
    config_retry: '重试',

    // Shelf admin — product write actions (task #9)
    shelf_admin_title: '货架管理',
    shelf_admin_subtitle: '点一个货架来查看或编辑它的商品。',
    shelf_admin_back_workspace: '工作台',
    shelf_admin_back_shelves: '货架',
    shelf_admin_add: '添加',
    shelf_admin_refresh: '刷新',
    shelf_admin_edit: '编辑',
    shelf_admin_delete: '删除',
    shelf_admin_clear: '清空',
    shelf_admin_loading: '加载中…',
    shelf_admin_empty: '这个货架还没有商品。',
    shelf_admin_products_n: (n: number) => `${n} 个商品`,
    shelf_admin_confirm_delete: (name: string) => `删除「${name}」？`,
    shelf_admin_confirm_clear: (n: number, code: string) =>
      `删除货架 ${code} 上的全部 ${n} 个商品？`,
    shelf_admin_clear_title: (n: number, code: string) =>
      `删除 ${code} 上的全部 ${n} 个商品`,
    shelf_admin_edit_title: '编辑商品',
    shelf_admin_add_title: '添加商品',
    shelf_admin_cancel: '取消',
    shelf_admin_save: '保存',
    shelf_admin_saving: '保存中…',
    shelf_admin_field_aliases: '别名（每行一个）',
    shelf_admin_field_category_ph: '例如：面、酱、零食',
    shelf_admin_err_write: '写入失败，请重试。',
    shelf_admin_session_expired: '会话已过期，请重新输入密码。',
    shelf_admin_reauth: '重新输入密码',
  },
} as const;

type StringKey = keyof typeof STRINGS.en;
type StringValue = (typeof STRINGS.en)[StringKey];

/**
 * Active language hook. Persists choice to localStorage. Listens on both
 * the native `storage` event (other tabs) and our `LANG_CHANGE_EVENT`
 * (same tab) so every consumer re-renders together.
 */
export function useLanguage(): [Language, (l: Language) => void] {
  const [lang, setLangState] = useState<Language>('en');

  useEffect(() => {
    const stored = (typeof window !== 'undefined' && localStorage.getItem(WHEREBEAR_LANG_KEY)) as Language | null;
    if (stored === 'en' || stored === 'zh') setLangState(stored);

    const onChange = () => {
      const next = localStorage.getItem(WHEREBEAR_LANG_KEY) as Language | null;
      if (next === 'en' || next === 'zh') setLangState(next);
    };
    window.addEventListener('storage', onChange);
    window.addEventListener(LANG_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(LANG_CHANGE_EVENT, onChange);
    };
  }, []);

  const setLang = useCallback((l: Language) => {
    localStorage.setItem(WHEREBEAR_LANG_KEY, l);
    setLangState(l);
    window.dispatchEvent(new CustomEvent(LANG_CHANGE_EVENT));
  }, []);

  return [lang, setLang];
}

/** Hook returning a `t(key)` function bound to the current language. */
export function useTranslation() {
  const [lang, setLang] = useLanguage();

  const t = useCallback(<K extends StringKey>(
    key: K,
    ...args: (typeof STRINGS.en)[K] extends (...a: infer A) => string ? A : never[]
  ): string => {
    const dict = STRINGS[lang] ?? STRINGS.en;
    const value: StringValue = (dict[key] ?? STRINGS.en[key]) as StringValue;
    if (typeof value === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (value as (...a: unknown[]) => string)(...(args as any[]));
    }
    return value as string;
  }, [lang]);

  return { t, lang, setLang };
}
