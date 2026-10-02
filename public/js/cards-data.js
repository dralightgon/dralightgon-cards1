/* =========================================================
 * 卡牌对决 - 卡牌数据定义(以《我的卡牌》规则文档为准)
 * 五阵营: 主世界 / 地狱 / 终界 / 虫族 / 创世神
 * ========================================================= */
(function (global) {
  'use strict';

  const FACTIONS = {
    overworld: {
      id: 'overworld',
      name: '主世界',
      short: '虚空国',
      color: '#58b368',
      dark: '#2f7d46',
      img: 'assets/主世界卡背.jpg',
      back: 'assets/主世界卡背.jpg',
      energyPerTurn: 3,
      refreshEnergy: true,      // 每回合刷新体力
      elecCap: 3,               // 电最高3级(无法叠至4级)
      desc: '均衡守城,修复与核打击'
    },
    nether: {
      id: 'nether',
      name: '地狱',
      short: '地狱堡垒',
      color: '#e2574c',
      dark: '#9c2f28',
      img: 'assets/地狱卡背.jpg',
      back: 'assets/地狱卡背.jpg',
      energyPerTurn: 3,
      refreshEnergy: true,
      elecCap: 4,
      desc: '高血量本体,火与凋零压制'
    },
    end: {
      id: 'end',
      name: '终界',
      short: '终界城',
      color: '#4a90d9',
      dark: '#2f6ba8',
      img: 'assets/终界卡背.jpg',
      back: 'assets/终界卡背.jpg',
      energyPerTurn: 3,
      refreshEnergy: true,
      elecCap: 2,               // 电最高2级(无法叠至3级)
      desc: '护盾保本体,吸血与安息'
    },
    zerg: {
      id: 'zerg',
      name: '虫族',
      short: '虫群',
      color: '#a9825c',
      dark: '#7a5a38',
      img: 'assets/虫族卡背.jpg',
      back: 'assets/虫族卡背.jpg',
      energyPerTurn: 3,
      refreshEnergy: true,
      elecCap: 4,
      desc: '建筑增益叠加,增生强化'
    },
    craft: {
      id: 'craft',
      name: '创世神',
      short: 'MINECRAFT',
      color: '#e8d24a',
      dark: '#a88f1f',
      img: 'assets/创世神卡背.png',
      back: 'assets/创世神卡背.png',
      energyPerTurn: 3,
      refreshEnergy: false,     // 体力可继承(每回合+3)
      elecCap: 4,
      desc: '二阶段本体,乱码与湮灭'
    }
  };

  /* ---------------- 建筑卡 ---------------- */
  // count:场上数量上限;startOnField:开局直接上场(文档无权重=无法抽取=开局拥有)
  const BUILDINGS = {
    // ===== 主世界 =====
    ow_main: { id:'ow_main', type:'building', faction:'overworld', name:'虚空国主城', hp:1000, main:true, count:1, startOnField:true,
      desc:'本体。每回合获得3体力。敌方电无法叠至4级。' },
    ow_wall: { id:'ow_wall', type:'building', faction:'overworld', name:'虚空国城墙', hp:800, priority:1, count:1, startOnField:true,
      desc:'优先受伤。' },
    // ===== 地狱 =====
    ne_main: { id:'ne_main', type:'building', faction:'nether', name:'地狱堡垒', hp:1200, main:true, count:1, startOnField:true,
      desc:'本体。免疫火,受10×冰等级无视护甲伤害。每回合获得3体力。' },
    ne_wall: { id:'ne_wall', type:'building', faction:'nether', name:'地狱城墙', hp:900, priority:1, count:1, startOnField:true,
      desc:'优先受伤。' },
    ne_out: { id:'ne_out', type:'building', faction:'nether', name:'地狱外城', hp:600, priority:2, count:1, startOnField:true,
      desc:'更优先受伤。' },
    // ===== 终界 =====
    en_main: { id:'en_main', type:'building', faction:'end', name:'终界城', hp:1000, main:true, count:1, startOnField:true,
      desc:'本体。免疫冰,敌方电无法叠至3级。每回合获得3体力。' },
    en_shield: { id:'en_shield', type:'building', faction:'end', name:'护盾', hp:250, priority:1, count:2, weight:2,
      desc:'优先受伤。存在时本体免伤(无法免疫强制伤害)。' },
    // ===== 虫族 =====
    zg_main: { id:'zg_main', type:'building', faction:'zerg', name:'母体', hp:800, main:true, count:1, startOnField:true,
      desc:'本体。受2倍火伤,对辐射50%减伤,每回合回血20(有凋零时无法回血)。每回合获得3体力。' },
    zg_node: { id:'zg_node', type:'building', faction:'zerg', name:'节点', hp:30, count:2, weight:2,
      desc:'全体建筑20%减伤(可叠加)。每回合提供1体力。' },
    zg_colony: { id:'zg_colony', type:'building', faction:'zerg', name:'群落', hp:50, count:2, weight:2,
      desc:'每回合回复本体20血,增加本体50血量上限(可叠加)。每回合提供1体力。' },
    // ===== 创世神 =====
    cr_main: { id:'cr_main', type:'building', faction:'craft', name:'MINECRAFT', hp:400, maxHp2:800, main:true, phase:1, count:1, startOnField:true,
      desc:'一阶段400/二阶段800。只受一半状态伤害。自身乱码=对方总和一半。开局100%减伤每回合降8%。每回合获得3体力。' },
    cr_crystal: { id:'cr_crystal', type:'building', faction:'craft', name:'乱码水晶', hp:60, count:3, weight:3,
      desc:'本体15%减伤,每回合恢复本体20血,提供1体力。' }
  };

  /* ---------------- 技能卡 ---------------- */
  const SKILLS = {
    // ===== 主世界 =====
    ow_cannon: { id:'ow_cannon', type:'skill', faction:'overworld', name:'炮击', cost:1, weight:4,
      desc:'造成30点伤害。',
      effects:[{ op:'damage', targets:'priority', dmg:30 }] },
    ow_bomb: { id:'ow_bomb', type:'skill', faction:'overworld', name:'轰炸', cost:1, weight:4,
      desc:'造成50点伤害,同时攻击本体和其他建筑。',
      effects:[{ op:'damage', targets:'all', dmg:50 }] },
    ow_railgun: { id:'ow_railgun', type:'skill', faction:'overworld', name:'电磁炮', cost:1, weight:2,
      desc:'强制对对方所有建筑造成伤害:第一个目标150,其余50。',
      effects:[{ op:'damage', targets:'all', dmgFirst:150, dmgRest:50, forced:true }] },
    ow_fortify: { id:'ow_fortify', type:'skill', faction:'overworld', name:'设防', cost:2, weight:4,
      desc:'为所有建筑提供80%减伤和10点伤害减免(本回合)。',
      effects:[{ op:'shield', pct:80, flat:10, turn:1 }] },
    ow_watch: { id:'ow_watch', type:'skill', faction:'overworld', name:'警戒', cost:0, weight:3,
      desc:'本回合增加1体力。',
      effects:[{ op:'energy', n:1, thisTurn:true }] },
    ow_rad: { id:'ow_rad', type:'skill', faction:'overworld', name:'辐射', cost:1, weight:2,
      desc:'给对方叠加4级辐射。',
      effects:[{ op:'status', targets:'enemy', status:'rad', level:4 }] },
    ow_repair: { id:'ow_repair', type:'skill', faction:'overworld', name:'修复', cost:1, weight:4,
      desc:'回复主城100血。',
      effects:[{ op:'heal', targets:'main', amount:100 }] },
    ow_reload: { id:'ow_reload', type:'skill', faction:'overworld', name:'重装', cost:1, weight:2,
      desc:'回复主城200血,城墙100血。本回合使用该牌后不能使用其他卡牌。',
      effects:[{ op:'heal', targets:'main', amount:200 },{ op:'heal', targets:'ow_wall', amount:100 },{ op:'noMoreCards' }] },
    ow_cultivate: { id:'ow_cultivate', type:'skill', faction:'overworld', name:'修养', cost:1, weight:3,
      desc:'再次抽取3张牌,清除自身所有状态效果。本回合使用该牌后不能使用其他卡牌。',
      effects:[{ op:'draw', n:3 },{ op:'clearStatus', targets:'self' },{ op:'noMoreCards' }] },
    ow_storm: { id:'ow_storm', type:'skill', faction:'overworld', name:'雷暴雪', cost:2, weight:1,
      desc:'造成20点伤害,给对方叠电2级、冰2级。',
      effects:[{ op:'damage', targets:'priority', dmg:20 },{ op:'status', targets:'enemy', status:'elec', level:2 },{ op:'status', targets:'enemy', status:'ice', level:2 }] },
    ow_nuke: { id:'ow_nuke', type:'skill', faction:'overworld', name:'核打击', cost:3, weight:1,
      desc:'对对方所有建筑造成血量上限30%伤害(保底280),再造成20%伤害(无视减伤,保底120),叠辐射8级。',
      effects:[{ op:'nuke' }] },

    // ===== 地狱 =====
    ne_cannon: { id:'ne_cannon', type:'skill', faction:'nether', name:'炮击', cost:1, weight:4,
      desc:'造成40点伤害。',
      effects:[{ op:'damage', targets:'priority', dmg:40 }] },
    ne_fireball: { id:'ne_fireball', type:'skill', faction:'nether', name:'火球', cost:1, weight:4,
      desc:'造成20点伤害,给对方叠火1级。',
      effects:[{ op:'damage', targets:'priority', dmg:20, fireType:true },{ op:'status', targets:'enemy', status:'fire', level:1 }] },
    ne_volcano: { id:'ne_volcano', type:'skill', faction:'nether', name:'火山', cost:1, weight:2,
      desc:'造成50点伤害,给对方叠火2级。',
      effects:[{ op:'damage', targets:'priority', dmg:50, fireType:true },{ op:'status', targets:'enemy', status:'fire', level:2 }] },
    ne_deathfog: { id:'ne_deathfog', type:'skill', faction:'nether', name:'死雾', cost:1, weight:2,
      desc:'无直接伤害,给对方叠凋零1级、毒1级。',
      effects:[{ op:'status', targets:'enemy', status:'wither', level:1 },{ op:'status', targets:'enemy', status:'poison', level:1 }] },
    ne_withertear: { id:'ne_withertear', type:'skill', faction:'nether', name:'凋灵泪', cost:1, weight:2,
      desc:'造成30点伤害(同时攻击本体和其他建筑),给对方叠凋零1级。',
      effects:[{ op:'damage', targets:'all', dmg:30 },{ op:'status', targets:'enemy', status:'wither', level:1 }] },
    ne_guard: { id:'ne_guard', type:'skill', faction:'nether', name:'额外城防', cost:2, weight:3,
      desc:'所有建筑获得一回合80%减伤、50%反伤,回复所有建筑20血。',
      effects:[{ op:'shield', pct:80, reflect:50, turn:1 },{ op:'heal', targets:'allBuildings', amount:20 }] },
    ne_soulsuck: { id:'ne_soulsuck', type:'skill', faction:'nether', name:'吸魂', cost:0, weight:3,
      desc:'减少对方下回合1体力,本回合增加1体力。',
      effects:[{ op:'energy', n:1, thisTurn:true },{ op:'energyPenalty', n:1 }] },
    ne_counter: { id:'ne_counter', type:'skill', faction:'nether', name:'破招', cost:1, weight:2,
      desc:'将对方的一张卡牌放回牌堆。',
      effects:[{ op:'returnCard' }] },
    ne_cultivate: { id:'ne_cultivate', type:'skill', faction:'nether', name:'修养', cost:1, weight:4,
      desc:'回复本体100血。',
      effects:[{ op:'heal', targets:'main', amount:100 }] },
    ne_sacrifice: { id:'ne_sacrifice', type:'skill', faction:'nether', name:'献祭', cost:1, weight:2,
      desc:'丢弃1张卡牌,再次抽取3张卡牌。',
      effects:[{ op:'discard', n:1 },{ op:'draw', n:3 }] },
    ne_overload: { id:'ne_overload', type:'skill', faction:'nether', name:'过载', cost:0, weight:1,
      desc:'本回合增加4体力。',
      effects:[{ op:'energy', n:4, thisTurn:true }] },

    // ===== 终界 =====
    en_cannon: { id:'en_cannon', type:'skill', faction:'end', name:'炮击', cost:1, weight:4,
      desc:'造成20点伤害,可以对所有建筑造成伤害。',
      effects:[{ op:'damage', targets:'all', dmg:20 }] },
    en_plasma: { id:'en_plasma', type:'skill', faction:'end', name:'电浆', cost:1, weight:3,
      desc:'造成20点伤害,给对方叠电1级。',
      effects:[{ op:'damage', targets:'priority', dmg:20 },{ op:'status', targets:'enemy', status:'elec', level:1 }] },
    en_vampire: { id:'en_vampire', type:'skill', faction:'end', name:'吸血', cost:1, weight:2,
      desc:'造成30点伤害(无视护甲、强制伤害,只能攻击对方主城),回复主城60血。',
      effects:[{ op:'damage', targets:'main', dmg:30, ignoreArmor:true, forced:true },{ op:'heal', targets:'main', amount:60 }] },
    en_laser: { id:'en_laser', type:'skill', faction:'end', name:'激光', cost:1, weight:3,
      desc:'造成30点伤害,叠火1级,无视护甲。',
      effects:[{ op:'damage', targets:'priority', dmg:30, ignoreArmor:true },{ op:'status', targets:'enemy', status:'fire', level:1 }] },
    en_missile: { id:'en_missile', type:'skill', faction:'end', name:'导弹', cost:1, weight:4,
      desc:'造成80点伤害。',
      effects:[{ op:'damage', targets:'priority', dmg:80 }] },
    en_grid: { id:'en_grid', type:'skill', faction:'end', name:'电网', cost:2, weight:4,
      desc:'所有建筑获得一回合60%减伤、40%反伤,受伤时给对方叠电1级。',
      effects:[{ op:'shield', pct:60, reflect:40, elecOnHit:1, turn:1 }] },
    en_link: { id:'en_link', type:'skill', faction:'end', name:'连心', cost:1, weight:2,
      desc:'将自身的状态效果施加到对方。',
      effects:[{ op:'copyStatus' }] },
    en_rest: { id:'en_rest', type:'skill', faction:'end', name:'安息', cost:1, weight:2,
      desc:'下一回合跳过对方。',
      effects:[{ op:'skipTurn' }] },
    en_fastfix: { id:'en_fastfix', type:'skill', faction:'end', name:'速修', cost:0, weight:4,
      desc:'回复主城80血。',
      effects:[{ op:'heal', targets:'main', amount:80 }] },
    en_rebuild: { id:'en_rebuild', type:'skill', faction:'end', name:'重建', cost:2, weight:2,
      desc:'回复主城200血,去除所有状态效果。',
      effects:[{ op:'heal', targets:'main', amount:200 },{ op:'clearStatus', targets:'self' }] },
    en_skygun: { id:'en_skygun', type:'skill', faction:'end', name:'天基炮', cost:3, weight:1,
      desc:'造成200点伤害,给对方叠电4级、火3级。',
      effects:[{ op:'damage', targets:'priority', dmg:200 },{ op:'status', targets:'enemy', status:'elec', level:4 },{ op:'status', targets:'enemy', status:'fire', level:3 }] },

    // ===== 虫族 =====
    zg_blast: { id:'zg_blast', type:'skill', faction:'zerg', name:'爆囊', cost:1, weight:3,
      desc:'造成60点伤害。',
      effects:[{ op:'damage', targets:'priority', dmg:60 }] },
    zg_bomb: { id:'zg_bomb', type:'skill', faction:'zerg', name:'轰炸', cost:1, weight:4,
      desc:'造成40点伤害,同时攻击所有建筑。',
      effects:[{ op:'damage', targets:'all', dmg:40 }] },
    zg_acid: { id:'zg_acid', type:'skill', faction:'zerg', name:'酸弹', cost:1, weight:3,
      desc:'对对方本体造成30点伤害,对其他建筑造成80点伤害。',
      effects:[{ op:'damage', targets:'main', dmg:30 },{ op:'damage', targets:'others', dmg:80 }] },
    zg_dome: { id:'zg_dome', type:'skill', faction:'zerg', name:'穹顶', cost:2, weight:2,
      desc:'所有建筑获得一回合80%减伤、20点伤害减免。',
      effects:[{ op:'shield', pct:80, flat:20, turn:1 }] },
    zg_gas: { id:'zg_gas', type:'skill', faction:'zerg', name:'毒气', cost:1, weight:4,
      desc:'造成20点伤害,给对方叠毒1级。',
      effects:[{ op:'damage', targets:'priority', dmg:20 },{ op:'status', targets:'enemy', status:'poison', level:1 }] },
    zg_erode: { id:'zg_erode', type:'skill', faction:'zerg', name:'侵蚀', cost:1, weight:2,
      desc:'给对方叠虚弱1级。',
      effects:[{ op:'status', targets:'enemy', status:'weak', level:1 }] },
    zg_heal: { id:'zg_heal', type:'skill', faction:'zerg', name:'愈伤', cost:1, weight:4,
      desc:'回复本体100血。',
      effects:[{ op:'heal', targets:'main', amount:100 }] },
    zg_grow: { id:'zg_grow', type:'skill', faction:'zerg', name:'增生', cost:2, weight:2,
      desc:'回复所有建筑50血,增加本体20血量上限。',
      effects:[{ op:'heal', targets:'allBuildings', amount:50 },{ op:'maxHpUp', amount:20 }] },
    zg_newblood: { id:'zg_newblood', type:'skill', faction:'zerg', name:'新血', cost:2, weight:2,
      desc:'再次抽取3张牌,去除自身所有状态效果。本回合使用该牌后不能使用其他卡牌。',
      effects:[{ op:'draw', n:3 },{ op:'clearStatus', targets:'self' },{ op:'noMoreCards' }] },
    zg_mimic: { id:'zg_mimic', type:'skill', faction:'zerg', name:'拟态', cost:1, weight:1,
      desc:'学习对方的一张卡牌。',
      effects:[{ op:'learnCard' }] },

    // ===== 创世神 =====
    cr_thunder: { id:'cr_thunder', type:'skill', faction:'craft', name:'风起云涌之雷', cost:3, weight:3,
      desc:'一阶段:20点伤害(无视减伤),叠电2级、冰2级。二阶段:40点伤害,叠电3级、冰2级。',
      effects:[{ op:'damage', targets:'priority', dmg:[20,40], ignoreArmor:true },{ op:'status', targets:'enemy', status:'elec', level:[2,3] },{ op:'status', targets:'enemy', status:'ice', level:[2,2] }] },
    cr_fire: { id:'cr_fire', type:'skill', faction:'craft', name:'焚烬世间之火', cost:3, weight:3,
      desc:'一阶段:30点伤害,叠火2级。二阶段:60点伤害,叠火4级。',
      effects:[{ op:'damage', targets:'priority', dmg:[30,60], fireType:true },{ op:'status', targets:'enemy', status:'fire', level:[2,4] }] },
    cr_poison: { id:'cr_poison', type:'skill', faction:'craft', name:'生命凋谢之毒', cost:3, weight:3,
      desc:'一阶段:叠毒1级、凋零2级、辐射3级。二阶段:10点伤害,叠毒2级、凋零3级、辐射6级。',
      effects:[{ op:'damage', targets:'priority', dmg:[0,10] },{ op:'status', targets:'enemy', status:'poison', level:[1,2] },{ op:'status', targets:'enemy', status:'wither', level:[2,3] },{ op:'status', targets:'enemy', status:'rad', level:[3,6] }] },
    cr_light: { id:'cr_light', type:'skill', faction:'craft', name:'终末守望之光', cost:3, weight:3,
      desc:'一阶段:60点伤害,叠电1级、虚弱1级。二阶段:100点伤害,叠电2级、虚弱2级。',
      effects:[{ op:'damage', targets:'priority', dmg:[60,100] },{ op:'status', targets:'enemy', status:'elec', level:[1,2] },{ op:'status', targets:'enemy', status:'weak', level:[1,2] }] },
    cr_voidshield: { id:'cr_voidshield', type:'skill', faction:'craft', name:'虚空盾', cost:2, weight:3,
      desc:'所有建筑获得一回合80%减伤、100%反伤。',
      effects:[{ op:'shield', pct:80, reflect:100, turn:1 }] },
    cr_glitchhit: { id:'cr_glitchhit', type:'skill', faction:'craft', name:'乱码荡击', cost:2, weight:3,
      desc:'造成20点伤害,叠乱码1级。对方每有一层乱码,增伤2点。',
      effects:[{ op:'glitchHit' }] },
    cr_repair: { id:'cr_repair', type:'skill', faction:'craft', name:'简单修缮', cost:2, weight:3,
      desc:'回复本体100血。',
      effects:[{ op:'heal', targets:'main', amount:100 }] },
    cr_reforge: { id:'cr_reforge', type:'skill', faction:'craft', name:'回炉重铸', cost:4, weight:2,
      desc:'清除自身和对方的乱码状态,对方乱码每级回复本体50血。',
      effects:[{ op:'reforge' }] },
    cr_substitute: { id:'cr_substitute', type:'skill', faction:'craft', name:'等量代换', cost:2, weight:2,
      desc:'献祭任意张卡牌,根据消耗卡牌的数量等量提升自身体力。',
      effects:[{ op:'substitute' }] },
    cr_ray: { id:'cr_ray', type:'skill', faction:'craft', name:'湮灭射线', cost:6, weight:1,
      desc:'造成200点伤害+40%对方血量上限(无视护甲),叠乱码3级。',
      effects:[{ op:'annihilate' }] },
    // 被动(数量上限1,抽到后打出生效,不可重复)
    cr_field: { id:'cr_field', type:'passive', faction:'craft', name:'力场', cost:0, weight:1, count:1,
      desc:'被动:免伤八次,每次最多免伤200伤害。',
      effects:[{ op:'field' }] },
    cr_immortal: { id:'cr_immortal', type:'passive', faction:'craft', name:'生生不息', cost:0, weight:1, count:1,
      desc:'被动:抵抗一次致命伤害后清除全场乱码状态,并提供50%减伤。',
      effects:[{ op:'immortal' }] }
  };

  /* ---------------- 阵营牌堆构成 ----------------
   * 牌堆无限:仅有权重的卡进入权重抽取池,按权重加权随机抽取,永不耗尽。
   * 无权重卡(本体/城墙/外城)= 开局直接上场;标有数量(count)的卡限制场上最多数量。 */
  function buildDeck(factionId) {
    const pool = [];
    const addFrom = (obj) => {
      for (const k of Object.keys(obj)) {
        const c = obj[k];
        if (c.faction === factionId && c.weight !== undefined && !c.startOnField) {
          pool.push({ card: c, weight: c.weight });
        }
      }
    };
    addFrom(BUILDINGS);
    addFrom(SKILLS);
    return pool;
  }

  const CARD_DB = {};
  Object.assign(CARD_DB, BUILDINGS, SKILLS);
  for (const k of Object.keys(CARD_DB)) {
    const c = CARD_DB[k];
    if (c.type === 'skill' && c.weight === undefined) c.weight = 1;
    if (c.faction) { const f = FACTIONS[c.faction]; c.factionName = f.name; c.factionColor = f.color; }
  }

  global.CARDS = { FACTIONS, BUILDINGS, SKILLS, CARD_DB, buildDeck };
})(typeof module !== 'undefined' ? module.exports : window);
if (typeof module !== 'undefined') {
  const { FACTIONS, BUILDINGS, SKILLS, CARD_DB, buildDeck } = module.exports.CARDS;
  module.exports = { FACTIONS, BUILDINGS, SKILLS, CARD_DB, buildDeck };
}
