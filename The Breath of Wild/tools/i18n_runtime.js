/*!
 * Breath of the Wild fan remake — i18n runtime (zh-CN / en / ja / zh-TW)
 * Loaded as a classic script before the game module so it also works from file://.
 * The dictionary is embedded; no network request is required.
 */
(function () {
  'use strict';
  const DATA = __DATA__;
  const LANGS = [
    { id: 'zh-CN', name: '简体中文', nativeName: '简体中文' },
    { id: 'zh-TW', name: '繁體中文', nativeName: '繁體中文' },
    { id: 'en', name: 'English', nativeName: 'English' },
    { id: 'ja', name: '日本語', nativeName: '日本語' }
  ];
  const LS_KEY = 'botw_language';
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
  const CJK_ALL = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  // UI strings added after the original extraction (language/quality/net HUD).
  const UI_EXTRA = {
    en: {
      '语言': 'Language', '画质': 'Graphics', '自动': 'Auto', '高': 'High', '中': 'Medium', '低': 'Low',
      '本地存档模式': 'Local save mode', '云端已同步': 'Cloud synced', '云端已连接': 'Cloud connected', '离线模式': 'Offline mode',
      '旅人': 'Traveler', '开始游戏': 'Start Game', '按任意键开始': 'Press any key', '游戏暂停': 'Paused',
      '已暂停': 'Paused', '恢复': 'Resume', '设置': 'Settings', '返回标题': 'Return to title',
      '键位说明': 'Controls', '关闭': 'Close', '开启': 'On', '关': 'Off',
      '未连接服务器': 'Server offline', '连接中…': 'Connecting…', '云存档': 'Cloud Save',
      '读取云端存档': 'Load cloud save', '上传存档': 'Upload save', '排行榜': 'Leaderboard',
      '最高记录': 'Best record', '同步成功': 'Synced', '同步失败': 'Sync failed',
      '已存档（本地）': 'Saved (local)', '已存档（云端）': 'Saved (cloud)', '读取失败': 'Load failed',
      '正在生成海拉鲁大陆': 'Generating Hyrule', '生成海拉鲁地形': 'Shaping the land',
      '唤醒勇者': 'Awakening the hero', '生成村落、神庙与植被': 'Raising villages and forests',
      '魔物正在苏醒': 'Monsters are waking', '绘制海拉鲁地图': 'Drawing the map of Hyrule',
      '准备就绪': 'Ready', '完成': 'Ready',
      '无法启动': 'Unable to start', '新游戏': 'New Game', '继续游戏': 'Continue',
      '语言切换：L 键': 'Language: press L',
      '关节调试：J 键': 'Joint debug: press J', '性能信息：P 键': 'Performance: press P',
      '脱离卡住：U 键': 'Unstuck: press U',
      '帧率': 'FPS', '画质已切换': 'Graphics preset changed',
      '已装备': 'Equipped', '已换上': 'Equipped',
      '火': 'Fire', '冰': 'Ice', '雷': 'Thunder', '光': 'Light',
      '水之神兽': 'Water Divine Beast', '风之神兽': 'Wind Divine Beast',
      '火之神兽': 'Fire Divine Beast', '雷之神兽': 'Thunder Divine Beast',
      '神兽': 'Divine Beast', '四大神兽': 'the four Divine Beasts',
      '平原': 'Plains', '森林': 'Forest', '沙漠': 'Desert', '雪山': 'Snowfield',
      '火山': 'Volcano', '湖泊': 'Lake', '遗迹': 'Ruins', '神庙': 'Shrine',
      '村庄': 'Village', '驿站': 'Stable', '塔': 'Tower', '城堡': 'Castle',
      '东': 'East', '南': 'South', '西': 'West', '北': 'North',
      '距离': 'Distance', '耐久': 'Durability', '攻击力': 'Attack', '防御力': 'Defense',
      '神庙': 'Shrines', '希卡塔': 'Sheikah Tower', '城镇': 'Town', '当前位置': 'Current position',
      '尚未激活': 'Not activated', '已脱离卡住': 'Unstuck', '云端存档已同步': 'Cloud save synced', '盖侬': 'Ganon',
      '没有存档': 'No save data', '没有存档 · 正在读取云端…': 'No save data · reading cloud…',
      '完美闪避 · 突击': 'Perfect Dodge · Flurry Rush',
      '血月升起…魔物复活了': 'The Blood Moon rises… monsters have revived',
      '达尔克尔的守护 · 三层护盾': "Daruk's Protection · 3 charges",
      '拖动平移 · 滚轮缩放 · 点击青色神庙传送 · 灰色尚未激活 · M / ESC 关闭':
        'Drag to pan · Wheel to zoom · Click a cyan Shrine to travel · Gray means not activated · M/ESC to close',
      '点击青色传送点传送 · 灰色尚未激活 · M / ESC 关闭':
        'Click a cyan travel point · Gray means not activated · M/ESC to close',
      '关节调试 J · 性能信息 P · 脱离卡住 U · 切换语言 L':
        'Joint debug J · Performance P · Unstuck U · Language L',
      'F1 关闭帮助 · F2 切换画质': 'F1 close help · F2 graphics preset',
      '帮助': 'Help',
      '克洛格森林': 'Korok Forest', '卡卡利科': 'Kakariko', '海利亚湖': 'Lake Hylia',
      '死亡之山': 'Death Mountain', '哈特诺': 'Hateno', '哈特尔': 'Necluda',
      '中央海拉鲁': 'Central Hyrule', '海拉鲁城堡': 'Hyrule Castle', '灾厄盖侬': 'Calamity Ganon'
    },
    ja: {
      '语言': '言語', '画质': '画質', '自动': '自動', '高': '高', '中': '中', '低': '低',
      '本地存档模式': 'ローカルセーブ', '云端已同步': 'クラウド同期済み', '云端已连接': 'クラウド接続済み', '离线模式': 'オフライン',
      '旅人': '旅人', '开始游戏': 'ゲーム開始', '按任意键开始': 'キーを押してください', '游戏暂停': 'ポーズ',
      '已暂停': '一時停止中', '恢复': '再開', '设置': '設定', '返回标题': 'タイトルへ',
      '键位说明': '操作説明', '关闭': '閉じる', '开启': 'オン', '关': 'オフ',
      '未连接服务器': 'サーバー未接続', '连接中…': '接続中…', '云存档': 'クラウドセーブ',
      '读取云端存档': 'クラウドを読み込む', '上传存档': 'アップロード', '排行榜': 'ランキング',
      '最高记录': 'ベスト記録', '同步成功': '同期完了', '同步失败': '同期失敗',
      '已存档（本地）': 'セーブしました（ローカル）', '已存档（云端）': 'セーブしました（クラウド）', '读取失败': '読み込み失敗',
      '正在生成海拉鲁大陆': 'ハイラル大陸を生成中', '生成海拉鲁地形': '地形を生成中',
      '唤醒勇者': '勇者を目覚めさせる', '生成村落、神庙与植被': '村・祠・森を生成中',
      '魔物正在苏醒': '魔物が目覚める', '绘制海拉鲁地图': 'ハイラル地図を描画中',
      '准备就绪': '準備完了', '完成': '完了',
      '无法启动': '起動できません', '新游戏': '新しいゲーム', '继续游戏': '続きから',
      '语言切换：L 键': '言語切替：Lキー',
      '关节调试：J 键': '関節デバッグ：Jキー', '性能信息：P 键': 'パフォーマンス：Pキー',
      '脱离卡住：U 键': 'スタック解除：Uキー',
      '帧率': 'FPS', '画质已切换': '画質を変更しました',
      '已装备': '装備しました', '已换上': '着替えました',
      '火': '火', '冰': '氷', '雷': '雷', '光': '光',
      '水之神兽': '水の神獣', '风之神兽': '風の神獣', '火之神兽': '火の神獣', '雷之神兽': '雷の神獣',
      '神兽': '神獣', '四大神兽': '四神獣',
      '平原': '平原', '森林': '森', '沙漠': '砂漠', '雪山': '雪山',
      '火山': '火山', '湖泊': '湖', '遗迹': '遺跡', '神庙': '祠',
      '村庄': '村', '驿站': '馬宿', '塔': '塔', '城堡': '城',
      '东': '東', '南': '南', '西': '西', '北': '北',
      '距离': '距離', '耐久': '耐久', '攻击力': '攻撃力', '防御力': '防御力',
      '神庙': '祠', '希卡塔': 'シーカータワー', '城镇': '町', '当前位置': '現在地',
      '尚未激活': '未起動', '已脱离卡住': 'スタック解除', '云端存档已同步': 'クラウドセーブを同期しました', '盖侬': 'ガノン',
      '没有存档': 'セーブデータがありません', '没有存档 · 正在读取云端…': 'セーブがありません · クラウドを読み込み中…',
      '完美闪避 · 突击': 'ジャスト回避 · 乱れ斬り',
      '血月升起…魔物复活了': '血の月が昇る…魔物が復活した',
      '达尔克尔的守护 · 三层护盾': 'ダルケルの守り · 3回分',
      '拖动平移 · 滚轮缩放 · 点击青色神庙传送 · 灰色尚未激活 · M / ESC 关闭':
        'ドラッグで移動 · ホイールで拡大 · 水色の祠をクリックで転移 · 灰色は未起動 · M/ESCで閉じる',
      '点击青色传送点传送 · 灰色尚未激活 · M / ESC 关闭':
        '水色の転移点をクリックで転移 · 灰色は未起動 · M/ESCで閉じる',
      '关节调试 J · 性能信息 P · 脱离卡住 U · 切换语言 L':
        '関節デバッグ J · パフォーマンス P · スタック解除 U · 言語 L',
      'F1 关闭帮助 · F2 切换画质': 'F1 ヘルプを閉じる · F2 画質切替',
      '帮助': 'ヘルプ',
      '克洛格森林': 'コログの森', '卡卡利科': 'カカリコ', '海利亚湖': 'ハイリア湖',
      '死亡之山': '死の山', '哈特诺': 'ハテノ', '哈特尔': 'ネクルダ',
      '中央海拉鲁': 'ハイラル平原', '海拉鲁城堡': 'ハイラル城', '灾厄盖侬': '厄災ガノン'
    },
    'zh-TW': {
      '语言': '語言', '画质': '畫質', '自动': '自動', '高': '高', '中': '中', '低': '低',
      '本地存档模式': '本地存檔模式', '云端已同步': '雲端已同步', '云端已连接': '雲端已連接', '离线模式': '離線模式',
      '旅人': '旅人', '开始游戏': '開始遊戲', '按任意键开始': '按任意鍵開始', '游戏暂停': '遊戲暫停',
      '已暂停': '已暫停', '恢复': '恢復', '设置': '設定', '返回标题': '返回標題',
      '键位说明': '按鍵說明', '关闭': '關閉', '开启': '開啟', '关': '關',
      '未连接服务器': '未連接伺服器', '连接中…': '連接中…', '云存档': '雲端存檔',
      '读取云端存档': '讀取雲端存檔', '上传存档': '上傳存檔', '排行榜': '排行榜',
      '最高记录': '最高紀錄', '同步成功': '同步成功', '同步失败': '同步失敗',
      '已存档（本地）': '已存檔（本地）', '已存档（云端）': '已存檔（雲端）', '读取失败': '讀取失敗',
      '正在生成海拉鲁大陆': '正在生成海拉魯大陸', '生成海拉鲁地形': '生成海拉魯地形',
      '唤醒勇者': '喚醒勇者', '生成村落、神庙与植被': '生成村落、神廟與植被',
      '魔物正在苏醒': '魔物正在甦醒', '绘制海拉鲁地图': '繪製海拉魯地圖',
      '准备就绪': '準備就緒', '完成': '完成',
      '无法启动': '無法啟動', '新游戏': '新遊戲', '继续游戏': '繼續遊戲',
      '语言切换：L 键': '語言切換：L 鍵',
      '关节调试：J 键': '關節除錯：J 鍵', '性能信息：P 键': '效能資訊：P 鍵',
      '脱离卡住：U 键': '脫離卡住：U 鍵',
      '帧率': 'FPS', '画质已切换': '畫質已切換',
      '已装备': '已裝備', '已换上': '已換上',
      '火': '火', '冰': '冰', '雷': '雷', '光': '光',
      '水之神兽': '水之神獸', '风之神兽': '風之神獸', '火之神兽': '火之神獸', '雷之神兽': '雷之神獸',
      '神兽': '神獸', '四大神兽': '四大神獸',
      '平原': '平原', '森林': '森林', '沙漠': '沙漠', '雪山': '雪山',
      '火山': '火山', '湖泊': '湖泊', '遗迹': '遺跡', '神庙': '神廟',
      '村庄': '村莊', '驿站': '驛站', '塔': '塔', '城堡': '城堡',
      '东': '東', '南': '南', '西': '西', '北': '北',
      '距离': '距離', '耐久': '耐久', '攻击力': '攻擊力', '防御力': '防禦力',
      '神庙': '神廟', '希卡塔': '希卡塔', '城镇': '城鎮', '当前位置': '目前位置',
      '尚未激活': '尚未啟動', '已脱离卡住': '已脫離卡住', '云端存档已同步': '雲端存檔已同步', '盖侬': '蓋儂',
      '没有存档': '沒有存檔', '没有存档 · 正在读取云端…': '沒有存檔 · 正在讀取雲端…',
      '完美闪避 · 突击': '完美閃避 · 突擊',
      '血月升起…魔物复活了': '血月升起…魔物復活了',
      '达尔克尔的守护 · 三层护盾': '達爾克爾的守護 · 三層護盾',
      '拖动平移 · 滚轮缩放 · 点击青色神庙传送 · 灰色尚未激活 · M / ESC 关闭':
        '拖動平移 · 滾輪縮放 · 點擊青色神廟傳送 · 灰色尚未啟動 · M / ESC 關閉',
      '点击青色传送点传送 · 灰色尚未激活 · M / ESC 关闭':
        '點擊青色傳送點傳送 · 灰色尚未啟動 · M / ESC 關閉',
      '关节调试 J · 性能信息 P · 脱离卡住 U · 切换语言 L':
        '關節除錯 J · 效能資訊 P · 脫離卡住 U · 語言切換 L',
      'F1 关闭帮助 · F2 切换画质': 'F1 關閉說明 · F2 切換畫質',
      '帮助': '說明',
      '克洛格森林': '克洛格森林', '卡卡利科': '卡卡利科', '海利亚湖': '海利亞湖',
      '死亡之山': '死亡之山', '哈特诺': '哈特諾', '哈特尔': '哈特爾',
      '中央海拉鲁': '中央海拉魯', '海拉鲁城堡': '海拉魯城堡', '灾厄盖侬': '災厄蓋儂'
    },
    'zh-CN': {}
  };

  // {n} captures digits, {name} captures a short name; templates use $1..$n.
  const PAT = [
    [/^已解放 (\d+)\/4 神兽$/, '已解放 $1/4 神兽', 'Liberated $1/4 Divine Beasts', '神獣を $1/4 体解放', '已解放 $1/4 神獸'],
    [/^克洛格种子 (\d+)$/, '克洛格种子 $1', 'Korok Seeds $1', 'コログの実 $1', '克洛格種子 $1'],
    [/^试炼通过证 (\d+)$/, '试炼通过证 $1', 'Spirit Orbs $1', '試練の証 $1', '試煉通過證 $1'],
    [/^回忆 (\d+)\/(\d+)$/, '回忆 $1/$2', 'Memories $1/$2', '思い出 $1/$2', '回憶 $1/$2'],
    [/^英杰之诗 阶段(\d+)$/, '英杰之诗 阶段$1', "Champions' Ballad · Stage $1", '英傑の詩 第$1章', '英傑之詩 階段$1'],
    [/^心之容器：(\d+)\/(\d+)$/, '心之容器：$1/$2', 'Heart Containers: $1/$2', '心の器：$1/$2', '心之容器：$1/$2'],
    [/^防御 (\d+)$/, '防御 $1', 'Defense $1', '防御力 $1', '防禦 $1'],
    [/^攻击 (\d+)$/, '攻击 $1', 'Attack $1', '攻撃力 $1', '攻擊 $1'],
    [/^耐久 (.+)$/, '耐久 $1', 'Durability $1', '耐久値 $1', '耐久 $1'],
    [/^速度 (\d+) · 羁绊 (\d+)%$/, '速度 $1 · 羁绊 $2%', 'Speed $1 · Bond $2%', '速度 $1 · 絆 $2%', '速度 $1 · 羈絆 $2%'],
    [/^已换上 · (.+)$/, '已换上 · $1', 'Equipped · $1', '着替えました · $1', '已換上 · $1'],
    [/^切换盾牌 · (.+)$/, '切换盾牌 · $1', 'Shield switched · $1', '盾を切り替え · $1', '切換盾牌 · $1'],
    [/^已装备 (.+)$/, '已装备 $1', 'Equipped $1', '装備しました $1', '已裝備 $1'],
    [/^获得英杰技能 · (.+)$/, '获得英杰技能 · $1', 'Champion Ability Acquired · $1', '英傑スキル獲得 · $1', '獲得英傑技能 · $1'],
    [/^传送点已注册 · (.+)$/, '传送点已注册 · $1', 'Travel Point registered · $1', '転移点を登録しました · $1', '傳送點已註冊 · $1'],
    [/^与(.+)对话$/, '与$1对话', 'Talk to $1', '$1と話す', '與$1對話'],
    [/^试炼 · (.+)$/, '试炼 · $1', 'Trial · $1', '試練 · $1', '試煉 · $1'],
    [/^解放 (.+)$/, '解放 $1', 'Free the $1', '$1を解放', '解放 $1'],
    [/^前往(.+)$/, '前往$1', 'Head to $1', '$1へ向かう', '前往$1'],
    [/^食用「(.+)」$/, '食用「$1」', 'You ate 「$1」', '「$1」を食べた', '食用「$1」'],
    [/^在「(.+)」复活$/, '在「$1」复活', 'Revived at 「$1」', '「$1」で復活', '在「$1」復活'],
    [/^将在「(.+)」复活$/, '将在「$1」复活', 'You will revive at 「$1」', '「$1」で復活します', '將在「$1」復活'],
    [/^已?获得「(.+)」$/, '获得「$1」', 'Obtained 「$1」', '「$1」を手に入れた', '獲得「$1」'],
    [/^「(.+)」已加入你的装备。$/, '「$1」已加入你的装备。', '「$1」 has been added to your equipment.', '「$1」を装備に追加しました。', '「$1」已加入你的裝備。'],
    [/^盾牌：(.+)$/, '盾牌：$1', 'Shield: $1', '盾：$1', '盾牌：$1'],
    [/^(.+)（防(\d+)）$/, '$1（防$2）', '$1 (Def $2)', '$1（防御$2）', '$1（防$2）'],
    [/^(.+) \(防(\d+)\)$/, '$1（防$2）', '$1 (Def $2)', '$1（防御$2）', '$1（防$2）'],
    [/^(.+) \[(火|冰|雷|光)\]$/, '$1 [$2]', '$1 [$2]', '$1 [$2]', '$1 [$2]'],
    [/^额外黄心 \+(\d+)$/, '额外黄心 +$1', 'Extra Hearts +$1', '追加の黄色ハート +$1', '額外黃心 +$1'],
    [/^回复 (\d+) 心$/, '回复 $1 心', 'Restores $1 hearts', 'ハート$1個回復', '回復 $1 心'],
    [/^精力 \+(\d+)圈$/, '精力 +$1圈', 'Stamina +$1 wheel(s)', 'スタミナ +$1周', '精力 +$1圈'],
    [/^(\d+)分(\d+)秒$/, '$1分$2秒', '$1 min $2 sec', '$1分$2秒', '$1分$2秒'],
    [/^已解锁 (.+)$/, '已解锁 $1', 'Unlocked $1', '$1を解放', '已解鎖 $1'],
    [/^解锁 (.+)$/, '解锁 $1', 'Unlocked $1', '$1を解放', '解鎖 $1'],
    [/^距离 (\d+)m$/, '距离 $1m', 'Distance $1m', '距離 $1m', '距離 $1m'],
    [/^Lv(\d+)$/, 'Lv$1', 'Lv$1', 'Lv$1', 'Lv$1'],
    [/^神庙 (\d+)\/(\d+)$/, '神庙 $1/$2', 'Shrines $1/$2', '祠 $1/$2', '神廟 $1/$2'],
    [/^希卡塔 (\d+)\/(\d+)$/, '希卡塔 $1/$2', 'Sheikah Towers $1/$2', 'シーカータワー $1/$2', '希卡塔 $1/$2'],
    [/^达尔克尔的守护 · (\d+)$/, '达尔克尔的守护 · $1', "Daruk's Protection · $1", 'ダルケルの守り · $1', '達爾克爾的守護 · $1'],
    [/^血月升起…(\d+) 只魔物复活了$/, '血月升起…$1 只魔物复活了', 'The Blood Moon rises… $1 monsters revived', '血の月が昇る…魔物$1体が復活した', '血月升起…$1 隻魔物復活了']
  ].map(function (p) {
    let idx = 1;
    return { re: p[0], zh: p[1], en: p[2], ja: p[3], tw: p[4] };
  });

  function detect() {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (q && LANGS.some(l => l.id === q)) return q;
      if (window.BOTW_LANG && LANGS.some(l => l.id === window.BOTW_LANG)) return window.BOTW_LANG;
      const saved = localStorage.getItem(LS_KEY);
      if (saved && LANGS.some(l => l.id === saved)) return saved;
    } catch (e) {}
    const n = (navigator.language || 'zh-CN').toLowerCase();
    if (n.indexOf('ja') === 0) return 'ja';
    if (n.indexOf('zh') === 0) return (n.indexOf('tw') >= 0 || n.indexOf('hk') >= 0 || n.indexOf('mo') >= 0) ? 'zh-TW' : 'zh-CN';
    if (n.indexOf('en') === 0) return 'en';
    return 'zh-CN';
  }

  let current = detect();
  let cache = new Map();
  let sortedKeys = [];

  function buildKeys() {
    const d = DATA.dict[current] || {};
    const e = UI_EXTRA[current] || {};
    sortedKeys = Object.keys(d).concat(Object.keys(e)).filter(k => k && k.length >= 2).sort((a, b) => b.length - a.length);
    cache = new Map();
  }

  function lookup(s) {
    if (current === 'zh-CN') return undefined;
    const d = DATA.dict[current];
    if (d && Object.prototype.hasOwnProperty.call(d, s)) return d[s];
    const e = UI_EXTRA[current];
    if (e && Object.prototype.hasOwnProperty.call(e, s)) return e[s];
    return undefined;
  }

  function translateName(name) {
    const raw = String(name == null ? '' : name);
    const core = raw.trim();
    if (!core) return raw;
    if (!CJK.test(core)) return raw;
    const direct = lookup(core);
    if (direct !== undefined) return raw.replace(core, direct);
    const t = translateCore(core, 2);
    return raw.replace(core, t);
  }

  function applyPattern(core) {
    if (current === 'zh-CN') return null;
    for (let i = 0; i < PAT.length; i++) {
      const p = PAT[i];
      const m = core.match(p.re);
      if (!m) continue;
      let tpl = current === 'en' ? p.en : current === 'ja' ? p.ja : current === 'zh-TW' ? p.tw : p.zh;
      return tpl.replace(/\$(\d+)/g, function (_, n) {
        const cap = m[Number(n)];
        return cap === undefined ? '' : translateName(cap);
      });
    }
    return null;
  }

  function translateCore(core, depth) {
    if (depth <= 0) return core;
    if (!CJK.test(core)) return core;
    const direct = lookup(core);
    if (direct !== undefined) return direct;
    const pat = applyPattern(core);
    if (pat !== null) return pat;

    // split on separators, translate each side
    const parts = core.split(/(\s*[·：，。！？、；]\s*)/);
    if (parts.length > 1) {
      let changed = false;
      const out = parts.map(function (p) {
        if (!p) return p;
        if (!CJK.test(p)) return p;
        const t = translateCore(p.trim(), depth - 1);
        if (t !== p.trim()) { changed = true; return p.replace(p.trim(), t); }
        return p;
      });
      if (changed) return out.join('');
    }

    // number + known unit / prefix + name
    for (let i = 0; i < sortedKeys.length; i++) {
      const k = sortedKeys[i];
      if (k.length < 2 || CJK.test(k[0]) === false) continue;
      if (core.indexOf(k) === 0) {
        const rest = core.slice(k.length);
        if (!rest) return lookup(k);
        // avoid translating just a common single-character verb inside a longer word
        let rt = rest;
        if (/^\s*[\d.,%+\-]/.test(rest) || /^[a-zA-Z]/.test(rest)) {
          rt = translateCore(rest.trim(), depth - 1);
          return lookup(k) + rest.replace(rest.trim(), rt);
        }
      }
    }
    return core;
  }

  function translateWhole(text) {
    if (current === 'zh-CN') return text;
    if (text == null) return text;
    const str = String(text);
    if (!CJK.test(str)) return str;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str);
    const lead = m[1], core = m[2], trail = m[3];
    if (!core) return str;
    let out;
    if (cache.has(core)) out = cache.get(core);
    else { out = translateCore(core, 3); cache.set(core, out); }
    return lead + out + trail;
  }

  // ---------- DOM translation ----------
  const nodeState = new WeakMap();
  // Intercept textContent writes so per-frame HUD updates are translated
  // immediately instead of flickering between languages.
  (function patchTextContent() {
    const td = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (!td || !td.set) return;
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: true,
      enumerable: td.enumerable,
      get: td.get,
      set: function (v) {
        if (v == null) { td.set.call(this, v); return; }
        const s = String(v);
        if (current !== 'zh-CN' && CJK.test(s)) {
          const out = translateWhole(s);
          if (out !== s) {
            td.set.call(this, out);
            const tc = this.firstChild;
            if (tc && tc.nodeType === 3) nodeState.set(tc, { orig: s, out: out });
            return;
          }
        }
        td.set.call(this, s);
      }
    });
  })();
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, svg: 1 };
  function shouldSkip(node) {
    let el = node.parentNode;
    let guard = 0;
    while (el && guard++ < 8) {
      if (el.nodeType === 1) {
        if (SKIP_TAGS[el.tagName] || el.classList && el.classList.contains('no-i18n')) return true;
      }
      el = el.parentNode;
    }
    return false;
  }
  function translateTextNode(node) {
    if (shouldSkip(node)) return;
    const cur = node.nodeValue;
    if (!cur) return;
    let st = nodeState.get(node);
    if (current === 'zh-CN') {
      if (st && st.orig && cur === st.out && cur !== st.orig) node.nodeValue = st.orig;
      return;
    }
    if (!CJK.test(cur)) return;
    if (st) {
      if (cur === st.out) return;              // already translated
      if (cur !== st.orig) { st.orig = cur; }  // game changed the text
      else if (cur === st.orig && st.out && st.out !== cur) {
        const fresh = translateWhole(cur);
        if (fresh !== cur) { node.nodeValue = fresh; st.out = fresh; }
        return;
      }
    }
    const out = translateWhole(cur);
    if (out !== cur) {
      nodeState.set(node, { orig: cur, out: out });
      node.nodeValue = out;
    } else {
      nodeState.set(node, { orig: cur, out: cur });
    }
  }
  function restoreDOM(root) {
    if (!root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) {
      const st = nodeState.get(n);
      if (st && st.orig && n.nodeValue === st.out) n.nodeValue = st.orig;
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(function (el) {
        const st = nodeState.get(el);
        if (!st) return;
        if (st.titleOut !== undefined && el.title === st.titleOut && st.titleOrig !== undefined) el.title = st.titleOrig;
        if (st.phOut !== undefined && el.placeholder === st.phOut && st.phOrig !== undefined) el.placeholder = st.phOrig;
        if (st.ariaOut !== undefined && el.getAttribute('aria-label') === st.ariaOut && st.ariaOrig !== undefined) el.setAttribute('aria-label', st.ariaOrig);
      });
    }
  }
  function translateDOM(root) {
    if (!root) return;
    if (current === 'zh-CN') { restoreDOM(root); return; }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    if (root.querySelectorAll) {
      root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(function (el) {
        const st = nodeState.get(el) || {};
        ['title', 'placeholder', 'aria-label'].forEach(function (attr) {
          const v = el.getAttribute(attr);
          if (!v || !CJK.test(v)) return;
          const key = attr === 'title' ? 'titleOrig' : attr === 'placeholder' ? 'phOrig' : 'ariaOrig';
          const outKey = attr === 'title' ? 'titleOut' : attr === 'placeholder' ? 'phOut' : 'ariaOut';
          if (st[key] === undefined) st[key] = v;
          const out = translateWhole(v);
          if (out !== v) { el.setAttribute(attr, out); st[outKey] = out; }
        });
        nodeState.set(el, st);
      });
    }
  }

  function setLang(id, silent) {
    if (!LANGS.some(l => l.id === id)) return;
    if (id === current) { if (!silent) window.dispatchEvent(new CustomEvent('botw:lang', { detail: { lang: id } })); return; }
    restoreDOM(document.body);
    current = id;
    buildKeys();
    document.documentElement.lang = id;
    translateDOM(document.body);
    applyDocumentTitle();
    try { localStorage.setItem(LS_KEY, id); } catch (e) {}
    if (!silent) window.dispatchEvent(new CustomEvent('botw:lang', { detail: { lang: id } }));
  }
  function applyDocumentTitle() {
    try { document.title = translateWhole('旷野之息 · 程序化原型 · 全服装骑马版'); } catch (e) {}
  }

  function cycleLang() {
    const i = LANGS.findIndex(l => l.id === current);
    setLang(LANGS[(i + 1) % LANGS.length].id);
  }

  const api = {
    version: '1.0.0',
    langs: LANGS,
    get current() { return current; },
    get lang() { return current; },
    get isZh() { return current === 'zh-CN'; },
    setLang: setLang,
    cycle: cycleLang,
    t: translateWhole,
    tr: translateWhole,
    name: translateName,
    translateDOM: translateDOM,
    apply: function () { translateDOM(document.body); },
    tOr: function (text, fallback) { const r = translateWhole(text); return r === text ? (fallback || text) : r; }
  };
  window.BOTW_I18N = api;

  // Initialise
  buildKeys();
  document.documentElement.lang = current;
  applyDocumentTitle();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { translateDOM(document.body); });
  } else {
    translateDOM(document.body);
  }
  // Periodic DOM pass catches HUD/toast text written after the last frame.
  setInterval(function () { translateDOM(document.body); }, 420);
  window.addEventListener('botw:lang', function (e) {
    translateDOM(document.body);
  });
})();
