/* =========================================================
 * 卡牌对决 - 服务器规则引擎
 * 服务器权威:所有判定与结算均在服务器完成
 * ========================================================= */
'use strict';
const { FACTIONS, BUILDINGS, SKILLS, buildDeck } = require('../public/js/cards-data.js');

/* ---------------- 常量 ---------------- */
const RAD_DMG    = [1, 5, 10, 20, 30, 50, 75, 100];   // 辐射 1~8级
const FIRE_DMG   = [5, 10, 15, 20, 25, 30, 30, 30];   // 火 1~8级(文档给出6级数值,7/8级沿用30)
const ELEC_BONUS = [0.2, 0.5, 1.0, 2.0];              // 电增伤 1~4级
const ICE_ENERGY = [1, 2, 3, 4];                       // 冰减体力 1~4级
const POISON_PCT = [1, 2, 3, 4, 5];                    // 毒%最大血量 1~5级
const WEAK_MULT  = [0.1, 0.2, 0.3];                    // 虚弱减伤 1~3级
const WITHER_DMG = [10, 20, 30];                        // 凋零 1~3级(按每组第一档)

const MAX_HAND = 10;
// 体力默认无上限(按用户规则调整)
const MAX_ENERGY = 9999;

const emptyStatus = () => ({ rad:0, fire:0, elec:0, ice:0, poison:0, weak:0, wither:0, glitch:0 });
const emptyBuffs  = () => ({ shieldPct:0, flat:0, reflect:0, elecOnHit:0, invuln:0 });

/* ---------------- 工具 ---------------- */
function rnd(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rnd(arr.length)]; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = rnd(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

let UID_SEQ = 1000;   // 全局建筑 uid(跨 side 唯一)

/* ---------------- 玩家(一方) ---------------- */
function createSide(sideIndex, name, factionId) {
  const faction = FACTIONS[factionId];
  const side = {
    index: sideIndex,
    team: factionId ? 0 : 0,   // 队伍号(createGame 后覆盖)
    attackTarget: -1,          // 当前目标敌方 side 索引(2v2 用)
    pendingShields: [],        // 待对方回合激活的减伤/反伤效果
    name: name || ('玩家' + (sideIndex + 1)),
    faction: factionId,
    factionName: faction.name,
    factionColor: faction.color,
    energy: 0,
    maxEnergy: 3,
    energyInherit: factionId === 'craft', // 创世神体力继承(其余阵营每回合刷新为3)
    status: emptyStatus(),
    // 状态降级计时器
    decay: { fire:0, elec:0, wither:0 },
    // 一回合临时标记
    shield: false,        // 本回合开过盾
    noMoreCards: false,   // 本回合不能出其他牌(重装/修养/新血)
    energyPenalty: 0,     // 下回合体力惩罚
    skipNext: false,      // 下回合被跳过
    fieldLeft: 0,         // 力场剩余次数
    immortalReady: false, // 生生不息待触发
    immortalShield: 0,    // 生生不息触发的临时减伤
    passiveUsed: {},      // 已生效的被动卡(数量上限用)
    globalShield: factionId === 'craft' ? 100 : 0, // 创世神开局减伤%
    buildings: [],
    weightDeck: [], hand: [],
    disconnected: false,
    eliminated: false          // 1v1v1:主城被摧毁即淘汰
  };
  return side;
}

function freshBuilding(side, card) {
  const maxHp = card.main && card.maxHp2 ? card.hp : card.hp;
  return {
    uid: ++UID_SEQ,
    cardId: card.id,
    name: card.name,
    type: card.type,
    main: !!card.main,
    priority: card.priority || 0,
    hp: maxHp,
    maxHp: maxHp,
    phase: card.main && card.maxHp2 ? 1 : 0,
    buffs: emptyBuffs(),
    destroyed: false
  };
}

/* ---------------- 游戏 ---------------- */
/* 2v2:四人各自独立阵营/属性/状态/体力,队伍号 team=0/1 */
function createGame(room) {
  const game = {
    roomId: room.id,
    mode: room.mode,          // '1v1' | '2v2'
    sides: [],
    turnOrder: [],
    turn: -1,
    turnCount: 0,
    phase: 'lobby',
    winner: null,             // 获胜队伍号(0/1)
    log: [],
    lastEventSeq: 0
  };
  if (room.mode === '1v1v1') {
    // 三方混战:每方1人,各自独立阵营与队伍(team=0/1/2)
    for (let i = 0; i < 3; i++) {
      const conn = room.teams[i][0];
      const s = createSide(i, conn.name || ('玩家' + (i + 1)), room.factions[i]);
      s.team = i;
      game.sides.push(s);
    }
    game.turnOrder = [0, 1, 2];
  } else if (room.mode === '2v2') {
    // 每队 2 人 → side0..3(队伍0: side0,side1;队伍1: side2,side3)
    for (let ti = 0; ti < 2; ti++) {
      for (let si = 0; si < 2; si++) {
        const conn = room.teams[ti][si];
        const idx = ti * 2 + si;
        const s = createSide(idx, conn.name || ('玩家' + (idx + 1)), room.factions[idx]);
        s.team = ti;
        game.sides.push(s);
      }
    }
    // 队伍交替行动:队0甲 → 队1甲 → 队0乙 → 队1乙
    game.turnOrder = [0, 2, 1, 3];
  } else {
    for (let i = 0; i < 2; i++) {
      const conn = room.teams[i][0];
      const s = createSide(i, conn.name || ('玩家' + (i + 1)), room.factions[i]);
      s.team = i;
      game.sides.push(s);
    }
    game.turnOrder = [0, 1];
  }
  return game;
}

function log(game, text) {
  game.log.push(text);
  if (game.log.length > 200) game.log.shift();
  game.lastEventSeq++;
}

/* 开局布场 + 无限权重牌堆 */
function setupDeck(side) {
  // 无权重卡(本体/城墙/外城)= 开局直接上场
  for (const k of Object.keys(BUILDINGS)) {
    const c = BUILDINGS[k];
    if (c.faction === side.faction && c.startOnField) {
      side.buildings.push(freshBuilding(side, c));
    }
  }
  // 权重抽取池(牌堆无限,按权重加权随机)
  side.weightDeck = buildDeck(side.faction);
  // 初始手牌3张
  for (let i = 0; i < 3 && side.hand.length < MAX_HAND; i++) drawCards(side, 1, null);
}

/* 按权重加权随机抽一张(动态排除已达场上上限的卡) */
function drawCardByWeight(side) {
  const pool = (side.weightDeck || []).filter(({ card }) => {
    if (card.count === undefined) return true;            // 技能:无限可抽
    if (card.type === 'passive') return !side.passiveUsed[card.id]; // 被动:生效后不可再抽
    const onField = side.buildings.filter(b => !b.destroyed && b.cardId === card.id).length;
    return onField < card.count;                           // 建筑:场上未达上限才可抽
  });
  if (!pool.length) return null;   // 全部达上限(理论上仅当所有有数量卡集齐)
  let total = 0;
  for (const x of pool) total += x.weight || 1;
  let r = Math.random() * total;
  for (const x of pool) { r -= (x.weight || 1); if (r <= 0) return x.card; }
  return pool[pool.length - 1].card;
}

function drawCards(side, n, game) {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (side.hand.length >= MAX_HAND) break;
    const card = drawCardByWeight(side);
    if (!card) break;
    side.hand.push(card);
    drawn++;
  }
  if (drawn && game) log(game, side.factionName + ' 抽了 ' + drawn + ' 张牌');
  return drawn;
}

/* ---------------- 状态 ---------------- */
const IMMUNE = {
  nether: ['fire'],
  end: ['ice'],
  // craft(创世神):不再免疫状态,改为只受到一半来自状态效果的伤害
};

function applyStatus(side, status, level, game) {
  const faction = side.faction;
  if (level <= 0) return 0;
  if (IMMUNE[faction] && IMMUNE[faction].includes(status)) return 0;
  const cap = status === 'elec' ? FACTIONS[faction].elecCap :
             status === 'rad' ? 8 :
             status === 'fire' ? 8 :
             status === 'ice' ? 4 :
             status === 'poison' ? 5 :
             status === 'weak' ? 3 :
             status === 'wither' ? 3 : 99;
  const before = side.status[status];
  side.status[status] = clamp(before + level, 0, cap);
  const added = side.status[status] - before;
  // 乱码:叠加时一次性永久削减血量上限(按叠加当时的原上限计算,此后固定不再削减)
  if (added > 0 && status === 'glitch') {
    for (const b of side.buildings) {
      if (b.destroyed) continue;
      const cut = Math.floor(b.maxHp * 0.01 * added);
      if (cut > 0) {
        b.maxHp -= cut;
        b.hp = Math.min(b.hp, b.maxHp);
        if (b.hp <= 0 && !b.destroyed && game && game.phase === 'playing') checkDestroy(game, side, b);
      }
    }
  }
  return added;
}

function clearStatus(side) {
  side.status = emptyStatus();
  side.decay = { fire: 0, elec: 0, wither: 0 };
}

/* ---------------- 伤害结算 ---------------- */
function calcDamage(attacker, defender, b, baseDmg, opts) {
  opts = opts || {};
  let dmg = baseDmg;

  // 力场:每次受击最多200(仅创世神本体)
  if (b.main && defender.fieldLeft > 0) {
    if (dmg > 200) dmg = 200;
    defender.fieldLeft--;
  }

  if (!opts.ignoreArmor) {
    // 虚弱
    if (defender.status.weak > 0) dmg *= (1 - WEAK_MULT[defender.status.weak - 1]);
    // 建筑临时减伤
    if (b.buffs.shieldPct > 0) dmg *= (1 - b.buffs.shieldPct / 100);
    // 节点固有减伤(全体)
    const nodeCount = defender.buildings.filter(x => !x.destroyed && x.cardId === 'zg_node').length;
    if (nodeCount > 0) dmg *= Math.pow(0.8, nodeCount);
    // 乱码水晶(仅本体)
    if (b.main) {
      const crystalCount = defender.buildings.filter(x => !x.destroyed && x.cardId === 'cr_crystal').length;
      if (crystalCount > 0) dmg *= Math.pow(0.85, crystalCount);
    }
    // 创世神开局减伤 + 生生不息减伤
    if (defender.globalShield > 0) dmg *= (1 - defender.globalShield / 100);
    if (defender.immortalShield > 0) dmg *= (1 - defender.immortalShield / 100);
    // 平减
    if (b.buffs.flat > 0) dmg -= b.buffs.flat;
  }

  // 电增伤(受伤方)
  if (opts.canElec !== false && defender.status.elec > 0) dmg *= (1 + ELEC_BONUS[defender.status.elec - 1]);
  // 母体受2倍火伤
  if (opts.fireType && b.cardId === 'zg_main') dmg *= 2;

  dmg = Math.max(0, Math.floor(dmg));
  return dmg;
}

/* 对防守方指定建筑造成伤害 */
function hitBuilding(game, attacker, defender, b, baseDmg, opts) {
  opts = opts || {};
  // 终界护盾:本体免伤(强制伤害与持续状态伤害除外)
  if (b.main && !opts.forced && !opts.doTick && defender.faction === 'end') {
    const shields = defender.buildings.filter(x => !x.destroyed && x.cardId === 'en_shield');
    if (shields.length > 0) {
      log(game, defender.factionName + ' 的护盾保护了本体');
      return 0;
    }
  }
  let dmg = calcDamage(attacker, defender, b, baseDmg, opts);
  // 创世神:只受到一半来自状态效果的伤害
  if (opts.doTick && defender.faction === 'craft') dmg = Math.floor(dmg / 2);
  if (dmg <= 0) return 0;
  b.hp -= dmg;
  const srcName = (attacker && attacker.factionName) ? attacker.factionName : '天灾';
  log(game, defender.factionName + '的「' + b.name + '」受到来自 ' + srcName + ' 的 ' + dmg + ' 点伤害(' + Math.max(0, b.hp) + '/' + b.maxHp + ')');

  // 电网:受伤时给对方叠电
  if (b.buffs.elecOnHit > 0) {
    const added = applyStatus(attacker, 'elec', b.buffs.elecOnHit, game);
    if (added > 0) log(game, attacker.factionName + ' 因电网被叠电' + added + '级');
  }

  // 反伤:反射给攻击方本体
  if (b.buffs.reflect > 0 && attacker !== defender) {
    const reflectDmg = Math.max(0, Math.floor(dmg * b.buffs.reflect / 100));
    if (reflectDmg > 0) {
      const ab = attacker.buildings.find(x => x.main && !x.destroyed);
      if (ab) {
        ab.hp -= reflectDmg;
        log(game, attacker.factionName + ' 的「' + ab.name + '」受到反伤 ' + reflectDmg + ' 点');
        checkDestroy(game, attacker, ab);
      }
    }
  }

  checkDestroy(game, defender, b);
  return dmg;
}

function checkDestroy(game, side, b) {
  if (b.hp <= 0 && !b.destroyed) {
    if (b.main) {
      // 生生不息:抵抗一次致命伤害
      if (side.immortalReady) {
        side.immortalReady = false;
        b.hp = 1;
        for (const s of game.sides) clearGlitch(s);
        side.immortalShield = 50;
        log(game, side.factionName + ' 触发「生生不息」!清除全场乱码,获得50%减伤');
        return;
      }
      if (side.faction === 'craft' && b.phase === 1) {
        // 创世神进二阶段
        b.phase = 2;
        b.maxHp = b.maxHp2 || 1000;
        b.hp = b.maxHp;
        b.destroyed = false;
        log(game, side.factionName + ' 的 MINECRAFT 进入二阶段!血量恢复至 ' + b.hp);
        return;
      }
      if (game.mode === '1v1v1') {
        // 三方混战:主城被毁即淘汰,最后存活阵营获胜
        side.eliminated = true;
        b.destroyed = true;
        log(game, side.factionName + ' 被淘汰!(主城被摧毁)');
        const alive = game.sides.filter(x => !x.eliminated);
        if (alive.length <= 1) {
          if (alive.length === 1) endGame(game, alive[0].team, '唯一存活');
          else endGame(game, game.turn, '仅剩一人'); // 兜底(理论上不会)
        }
        return;
      }
      endGame(game, side.team === 0 ? 1 : 0, '本体被摧毁');
      return;
    }
    b.destroyed = true;
    log(game, side.factionName + ' 的「' + b.name + '」被摧毁');
  }
}

/* 选择目标:priority 优先级数字越大越优先;护盾优先 */
function pickTargets(defender, mode) {
  const alive = defender.buildings.filter(x => !x.destroyed);
  const main = alive.find(x => x.main);
  if (mode === 'main') return [main].filter(Boolean);
  if (mode === 'others') return alive.filter(x => !x.main);
  if (mode === 'all') return alive;
  // priority:取优先级最高的建筑(优先受伤)
  const sorted = alive.filter(x => !x.main).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (sorted.length && sorted[0].priority > 0) return [sorted[0]];
  return [main].filter(Boolean);
}

function dealDamage(game, attacker, defender, mode, baseDmg, opts) {
  opts = opts || {};
  let targets = opts.forceTarget ? [opts.forceTarget] : pickTargets(defender, mode);
  if (!targets.length) return 0;
  if (opts.dmgFirst !== undefined) {
    targets.forEach((b, i) => hitBuilding(game, attacker, defender, b, i === 0 ? opts.dmgFirst : opts.dmgRest, opts));
  } else {
    const dmgArr = Array.isArray(baseDmg) ? baseDmg : null;
    targets.forEach((b) => {
      let d = baseDmg;
      if (dmgArr) d = dmgArr[defenderPhase(defender) - 1];
      hitBuilding(game, attacker, defender, b, d, opts);
    });
  }
  return 1;
}

function defenderPhase(defender) {
  const main = defender.buildings.find(x => x.main && !x.destroyed);
  return main && main.phase ? main.phase : 1;
}

function endGame(game, winnerIdx, reason) {
  if (game.phase === 'ended') return;
  game.phase = 'ended';
  game.winner = winnerIdx;
  log(game, '对局结束!' + game.sides[winnerIdx].factionName + ' 获胜(' + reason + ')');
}

/* ---------------- 回合流程 ---------------- */
function nextTurnSide(game, cur) {
  const order = game.turnOrder || [0, 1];
  const idx = order.indexOf(cur);
  const n = order.length;
  for (let k = 1; k <= n; k++) {
    const nxt = order[(idx + k) % n];
    const sd = game.sides[nxt];
    if (sd && !sd.eliminated) return nxt;
  }
  return order[(idx + 1) % n];
}

function startGame(game, room) {
  for (const s of game.sides) setupDeck(s);
  game.turn = game.turnOrder[0];
  game.turnCount = 0;
  game.phase = 'playing';
  log(game, '对局开始!' + game.sides[game.turn].factionName + ' 先手');
  beginTurn(game);
}

/* 攻击目标解析:1v1 固定对手,2v2 取 attackTarget(默认敌队第一个) */
function resolveEnemy(game, side) {
  const enemies = game.sides.filter(s => s.team !== side.team && !s.eliminated);
  if (!enemies.length) return null;
  let idx = side.attackTarget;
  if (idx == null || idx < 0 || !enemies.some(e => e.index === idx)) {
    idx = enemies[0].index;
    side.attackTarget = idx;
  }
  return game.sides[idx];
}

/* 敌方全部 side(2v2 两个) */
function allEnemies(game, side) {
  return game.sides.filter(s => s.team !== side.team && !s.eliminated);
}

function beginTurn(game) {
  if (game.phase !== 'playing') return;
  const side = game.sides[game.turn];
  game.turnCount++;

  if (side.eliminated) { endTurn(game); return; }

  if (side.skipNext) {
    side.skipNext = false;
    log(game, side.factionName + ' 的回合被跳过!');
    endTurn(game);
    return;
  }

  // 清自身上一周期的临时减伤/反伤(盾只保护"对方回合",轮到自身回合即过期)
  for (const b of side.buildings) {
    b.buffs.shieldPct = 0; b.buffs.flat = 0; b.buffs.reflect = 0; b.buffs.elecOnHit = 0;
  }
  side.immortalShield = 0;
  side.shield = false;

  // 减伤卡:轮到对方回合时激活(一回合)
  for (const s of game.sides) {
    if (s.team === side.team || s.eliminated) continue;
    if (s.pendingShields.length) {
      for (const sh of s.pendingShields) shieldAllNow(s, sh.pct, sh.flat, sh.reflect, sh.elecOnHit);
      s.pendingShields = [];
    }
  }

  // 自身回合开始:结算自身持续伤害与状态降级(各 side 独立)
  if (game.phase === 'playing') tickStatusDamage(game, side, allEnemies(game, side));
  if (game.phase === 'playing') decayStatus(game, side);
  if (game.phase === 'playing') {
    const e = resolveEnemy(game, side);
    if (e && side.faction === 'craft' && side.globalShield > 0) {
      // 创世神开局减伤按自身回合衰减
      side.globalShield = Math.max(0, side.globalShield - 8);
    }
  }

  // 体力刷新/继承
  const buildingEnergy = side.buildings.filter(x => !x.destroyed && ['zg_node', 'zg_colony', 'cr_crystal'].includes(x.cardId)).length;
  if (side.energyInherit) {
    side.energy = Math.min(MAX_ENERGY, side.energy + 3 + buildingEnergy);
    side.maxEnergy = Math.min(MAX_ENERGY, side.energy);
  } else {
    side.energy = 3 + buildingEnergy;
    side.maxEnergy = side.energy;
  }
  // 冰减体力
  if (side.status.ice > 0) {
    const loss = ICE_ENERGY[side.status.ice - 1];
    side.energy = Math.max(0, side.energy - loss);
    log(game, side.factionName + ' 因冰冻损失 ' + loss + ' 体力');
  }
  // 体力惩罚(吸魂)
  if (side.energyPenalty > 0) {
    side.energy = Math.max(0, side.energy - side.energyPenalty);
    log(game, side.factionName + ' 因吸魂损失 ' + side.energyPenalty + ' 体力');
    side.energyPenalty = 0;
  }
  side.noMoreCards = false;

  // 回合开始回血类建筑效果
  for (const b of side.buildings) {
    if (b.destroyed) continue;
    if (b.cardId === 'zg_main') {
      const hasWither = side.status.wither > 0;
      if (!hasWither) { b.hp = Math.min(b.maxHp, b.hp + 20); }
    }
    if (b.cardId === 'zg_colony') {
      const main = side.buildings.find(x => x.main);
      if (main) {
        main.hp = Math.min(main.maxHp, main.hp + 20);
        // 群落上限增益封顶:每张累计最多+300
        const colonies = side.buildings.filter(x => !x.destroyed && x.cardId === 'zg_colony').length;
        const baseMain = BUILDINGS.zg_main.hp;
        if (main.maxHp < baseMain + 300 * colonies) {
          const gain = Math.min(50, baseMain + 300 * colonies - main.maxHp);
          main.maxHp += gain;
        }
      }
    }
    if (b.cardId === 'cr_crystal') {
      const main = side.buildings.find(x => x.main);
      if (main) { main.hp = Math.min(main.maxHp, main.hp + 20); }
    }
  }

  // 抽牌:每回合固定抽3张
  drawCards(side, 3, game);

  log(game, '—— ' + side.factionName + ' 的回合(第' + game.turnCount + '回合,体力 ' + side.energy + ')——');
}

function endTurn(game) {
  if (game.phase !== 'playing') return;
  // 切换回合(beginTurn 内负责"清自身上一周期盾"与"激活敌方减伤待发")
  game.turn = nextTurnSide(game, game.turn);
  beginTurn(game);
}

/* 持续伤害:在 side 自身回合开始结算(attacker=敌方,用于反伤/电网) */
function tickStatusDamage(game, defender, enemies) {
  // 创世神:自身乱码固定为敌方乱码总和的一半(向下取整);值上升时补削血量上限
  const applyGlitchCut = (side, add) => {
    if (add <= 0) return;
    for (const b of side.buildings) {
      if (b.destroyed) continue;
      const cut = Math.floor(b.maxHp * 0.01 * add);
      if (cut > 0) { b.maxHp -= cut; b.hp = Math.min(b.hp, b.maxHp); }
    }
  };
  if (defender.faction === 'craft') {
    const newGl = Math.floor(enemies.reduce((a, e) => a + (e.status.glitch || 0), 0) / 2);
    applyGlitchCut(defender, newGl - defender.status.glitch);
    defender.status.glitch = newGl;
  }
  for (const e of enemies) {
    if (e.faction === 'craft') {
      const newGl2 = Math.floor(defender.status.glitch / 2);
      applyGlitchCut(e, newGl2 - e.status.glitch);
      e.status.glitch = newGl2;
    }
  }
  const st = defender.status;
  const alive = defender.buildings.filter(x => !x.destroyed);
  if (!alive.length) return;

  const hasFireIce = st.fire > 0 && st.ice > 0;

  const src = enemies[0] || null;
  for (const b of alive) {
    // 辐射:无视减伤,不可反伤,可电增伤
    if (st.rad > 0) {
      const dmg = RAD_DMG[st.rad - 1];
      hitBuilding(game, src, defender, b, dmg, { ignoreArmor: true, canElec: true, doTick: true });
    }
    // 冰+火抵消:每级40,不可电增伤
    if (hasFireIce) {
      const total = (st.ice + st.fire) * 40;
      hitBuilding(game, src, defender, b, total, { canElec: false, doTick: true });
    } else {
      // 火:可减伤,不可反伤,可电增伤(地狱免疫,母体2倍)
      if (st.fire > 0 && defender.faction !== 'nether') {
        const fdmg = FIRE_DMG[st.fire - 1];
        hitBuilding(game, src, defender, b, fdmg, { fireType: true, canElec: true, doTick: true });
      }
      // 冰:地狱堡垒额外受10×冰级无视护甲伤害
      if (st.ice > 0 && b.cardId === 'ne_main') {
        hitBuilding(game, src, defender, b, 10 * st.ice, { ignoreArmor: true, canElec: true, doTick: true });
      }
    }
    // 毒:无视减伤,不可反伤,不可电增伤(按最大血量%)
    if (st.poison > 0) {
      const pdmg = Math.floor(b.maxHp * POISON_PCT[st.poison - 1] / 100);
      hitBuilding(game, src, defender, b, pdmg, { ignoreArmor: true, canElec: false, doTick: true });
    }
    // 凋零:可减伤,不可反伤,可电增伤
    if (st.wither > 0) {
      hitBuilding(game, src, defender, b, WITHER_DMG[st.wither - 1], { canElec: true, doTick: true });
    }
    // 乱码:削减在叠加时已一次性完成(applyStatus),此处仅防御 hp<=0 未判负
    if (st.glitch > 0 && b.hp <= 0 && !b.destroyed) checkDestroy(game, defender, b);
    if (game.phase !== 'playing') break;
  }
}

function clearGlitch(side) {
  side.status.glitch = 0;
}

/* 状态降级 */
function decayStatus(game, defender) {
  const st = defender.status;
  if (st.rad > 0) { st.rad--; }
  if (st.ice > 0) { st.ice--; }
  if (st.weak > 0) { st.weak--; }
  if (st.fire > 0) {
    defender.decay.fire++;
    if (defender.decay.fire >= 2) { st.fire = Math.max(0, st.fire - 1); defender.decay.fire = 0; }
  }
  if (st.elec > 0) {
    defender.decay.elec++;
    if (defender.decay.elec >= 2) { st.elec = Math.max(0, st.elec - 1); defender.decay.elec = 0; }
  }
  if (st.wither > 0) {
    defender.decay.wither++;
    if (defender.decay.wither >= 2) { st.wither = Math.max(0, st.wither - 1); defender.decay.wither = 0; }
  }
}

/* ---------------- 技能执行 ---------------- */
function shieldAllNow(side, pct, flat, reflect, elecOnHit) {
  for (const b of side.buildings) {
    if (b.destroyed) continue;
    if (pct) b.buffs.shieldPct = Math.max(b.buffs.shieldPct, pct);
    if (flat) b.buffs.flat += flat;
    if (reflect) b.buffs.reflect = Math.max(b.buffs.reflect, reflect);
    if (elecOnHit) b.buffs.elecOnHit = Math.max(b.buffs.elecOnHit, elecOnHit);
  }
}

function phaseValue(v, side) {
  return Array.isArray(v) ? v[defenderPhase(side) - 1] : v;
}

function playCard(game, sideIdx, handIdx, extra) {
  const side = game.sides[sideIdx];
  if (game.phase !== 'playing') return { ok: false, msg: '对局未进行中' };
  if (game.turn !== sideIdx) return { ok: false, msg: '还没到你的回合' };
  if (side.noMoreCards) return { ok: false, msg: '本回合使用了特殊卡牌,不能再出其他牌' };
  if (handIdx < 0 || handIdx >= side.hand.length) return { ok: false, msg: '无效手牌' };

  const card = side.hand[handIdx];
  const cost = card.cost || 0;
  if (side.energy < cost) return { ok: false, msg: '体力不足(需要 ' + cost + ')' };
  // 数量上限校验(建筑/被动)
  if (card.type === 'building' && !card.main) {
    const onField = side.buildings.filter(b => !b.destroyed && b.cardId === card.id).length;
    if (card.count !== undefined && onField >= card.count) {
      return { ok: false, msg: '「' + card.name + '」已达场上上限(' + card.count + '张)' };
    }
  }
  if (card.type === 'passive' && side.passiveUsed[card.id]) {
    return { ok: false, msg: '「' + card.name + '」已生效,不能重复使用' };
  }

  // 扣费出牌
  side.energy -= cost;
  side.hand.splice(handIdx, 1);
  log(game, side.factionName + ' 打出「' + card.name + '」');

  const enemy = resolveEnemy(game, side);
  const e1 = card.effects || [];

  for (const ef of e1) {
    if (game.phase !== 'playing') break;
    const v = (x) => phaseValue(x, enemy);
    switch (ef.op) {
      case 'damage': {
        const dmg = v(ef.dmg);
        if (dmg > 0 || ef.dmgFirst !== undefined) {
          const opts = { forced: !!ef.forced, ignoreArmor: !!ef.ignoreArmor, fireType: !!ef.fireType, dmgFirst: ef.dmgFirst, dmgRest: ef.dmgRest };
          const aoe = ef.targets === 'all' || ef.targets === 'others';
          if (extra.target != null && !aoe) {
            let t = null;
            for (const es of allEnemies(game, side)) {
              t = es.buildings.find(b => !b.destroyed && b.uid === extra.target);
              if (t) break;
            }
            if (t) opts.forceTarget = t;
          }
          if (aoe) {
            // 2v2:AOE 波及所有敌方 side 的所有建筑
            for (const es of allEnemies(game, side)) {
              dealDamage(game, side, es, ef.targets, dmg, opts);
            }
          } else {
            dealDamage(game, side, enemy, ef.targets || 'priority', dmg, opts);
          }
        }
        break;
      }
      case 'status': {
        const added = applyStatus(enemy, ef.status, v(ef.level), game);
        if (added > 0) log(game, enemy.factionName + ' 被叠' + STATUS_CN[ef.status] + added + '级');
        break;
      }
      case 'shield':
        side.pendingShields.push({ pct: ef.pct || 0, flat: ef.flat || 0, reflect: ef.reflect || 0, elecOnHit: ef.elecOnHit || 0 });
        log(game, side.factionName + ' 获得城防效果(对方回合生效一回合)');
        break;
      case 'energy':
        side.energy += v(ef.n);
        log(game, side.factionName + ' 增加 ' + v(ef.n) + ' 体力');
        break;
      case 'energyPenalty':
        enemy.energyPenalty += v(ef.n);
        log(game, enemy.factionName + ' 下回合将损失 ' + v(ef.n) + ' 体力');
        break;
      case 'heal': {
        if (ef.targets === 'main') {
          const main = side.buildings.find(x => x.main && !x.destroyed);
          if (main) { main.hp = Math.min(main.maxHp, main.hp + v(ef.amount)); log(game, side.factionName + ' 回复「' + main.name + '」' + v(ef.amount) + '血'); }
        } else if (ef.targets === 'allBuildings') {
          for (const b of side.buildings) if (!b.destroyed) b.hp = Math.min(b.maxHp, b.hp + v(ef.amount));
          log(game, side.factionName + ' 所有建筑回复 ' + v(ef.amount) + '血');
        }
        break;
      }
      case 'maxHpUp': {
        const main = side.buildings.find(x => x.main && !x.destroyed);
        if (main) { main.maxHp += v(ef.amount); main.hp += v(ef.amount); log(game, side.factionName + ' 本体血量上限+' + v(ef.amount)); }
        break;
      }
      case 'draw':
        drawCards(side, v(ef.n), game);
        break;
      case 'discard': {
        if (extra.discardIdx != null && extra.discardIdx >= 0 && extra.discardIdx < side.hand.length) {
          const c = side.hand.splice(extra.discardIdx, 1)[0];
          log(game, side.factionName + ' 丢弃了「' + c.name + '」');
        } else {
          let dn = Math.min(v(ef.n), side.hand.length);
          for (let i = 0; i < dn; i++) side.hand.splice(rnd(side.hand.length), 1);
          log(game, side.factionName + ' 丢弃了 ' + dn + ' 张卡牌');
        }
        break;
      }
      case 'clearStatus':
        if (ef.targets === 'self') { clearStatus(side); log(game, side.factionName + ' 清除了所有状态效果'); }
        break;
      case 'noMoreCards':
        side.noMoreCards = true;
        break;
      case 'returnCard': {
        if (extra.targetHand != null && extra.targetHand >= 0 && extra.targetHand < enemy.hand.length) {
          const c = enemy.hand.splice(extra.targetHand, 1)[0];
          log(game, enemy.factionName + ' 的「' + c.name + '」被放回牌堆');
        } else if (enemy.hand.length) {
          const idx = rnd(enemy.hand.length);
          const c = enemy.hand.splice(idx, 1)[0];
          log(game, enemy.factionName + ' 的「' + c.name + '」被放回牌堆');
        }
        break;
      }
      case 'copyStatus': {
        for (const k of Object.keys(side.status)) {
          if (side.status[k] > 0) applyStatus(enemy, k, side.status[k], game);
        }
        log(game, side.factionName + ' 将自身状态施加给了对方');
        break;
      }
      case 'skipTurn':
        enemy.skipNext = true;
        log(game, enemy.factionName + ' 下回合将被跳过');
        break;
      case 'nuke': {
        // 30%上限(保底280) + 20%上限(无视减伤,保底120) + 辐射8
        const targets = enemy.buildings.filter(x => !x.destroyed);
        for (const b of targets) {
          const d1 = Math.max(280, Math.floor(b.maxHp * 0.3));
          hitBuilding(game, side, enemy, b, d1, {});
        }
        for (const b of targets) {
          if (b.destroyed) continue;
          const d2 = Math.max(120, Math.floor(b.maxHp * 0.2));
          hitBuilding(game, side, enemy, b, d2, { ignoreArmor: true });
        }
        applyStatus(enemy, 'rad', 8, game);
        log(game, enemy.factionName + ' 被核打击!叠辐射8级');
        break;
      }
      case 'glitchHit': {
        const bonus = enemy.status.glitch * 2;
        dealDamage(game, side, enemy, 'priority', 20 + bonus, {});
        applyStatus(enemy, 'glitch', 1, game);
        log(game, enemy.factionName + ' 被叠乱码1级(增伤+' + bonus + ')');
        break;
      }
      case 'reforge': {
        const enemyGlitch = enemy.status.glitch;
        clearGlitch(side); clearGlitch(enemy);
        const main = side.buildings.find(x => x.main && !x.destroyed);
        if (main && enemyGlitch > 0) {
          main.hp = Math.min(main.maxHp, main.hp + enemyGlitch * 50);
          log(game, side.factionName + ' 回炉重铸:清除全场乱码,回复本体 ' + enemyGlitch * 50 + '血');
        } else {
          log(game, side.factionName + ' 回炉重铸:清除全场乱码');
        }
        break;
      }
      case 'substitute': {
        const n = Math.min(extra && extra.subCount || 1, side.hand.length);
        for (let i = 0; i < n; i++) side.hand.splice(rnd(side.hand.length), 1);
        side.energy += n;
        log(game, side.factionName + ' 献祭 ' + n + ' 张卡牌,增加 ' + n + ' 体力');
        break;
      }
      case 'learnCard': {
        if (extra.learnTarget != null && extra.learnTarget >= 0 && extra.learnTarget < enemy.hand.length) {
          const c = Object.assign({}, enemy.hand[extra.learnTarget]);
          side.hand.push(c);
          log(game, side.factionName + ' 学习了对方一张卡牌:「' + c.name + '」');
        } else if (enemy.hand.length) {
          const c = Object.assign({}, enemy.hand[rnd(enemy.hand.length)]);
          side.hand.push(c);
          log(game, side.factionName + ' 学习了对方一张卡牌:「' + c.name + '」');
        }
        break;
      }
      case 'field':
        side.fieldLeft = 8;
        log(game, side.factionName + ' 展开力场(免伤8次)');
        break;
      case 'immortal':
        side.immortalReady = true;
        log(game, side.factionName + ' 获得「生生不息」庇护');
        break;
      case 'annihilate': {
        const main = enemy.buildings.find(x => x.main && !x.destroyed);
        const pctDmg = main ? Math.floor(main.maxHp * 0.4) : 0;
        dealDamage(game, side, enemy, 'priority', 200 + pctDmg, { ignoreArmor: true });
        applyStatus(enemy, 'glitch', 3, game);
        log(game, enemy.factionName + ' 被叠乱码3级');
        break;
      }
    }
  }

  // 建筑卡上场
  if (card.type === 'building' && !card.main) {
    side.buildings.push(freshBuilding(side, card));
    log(game, side.factionName + ' 建造了「' + card.name + '」');
  }
  // 被动卡生效登记
  if (card.type === 'passive') {
    side.passiveUsed[card.id] = true;
  }

  return { ok: true };
}

const STATUS_CN = { rad: '辐射', fire: '火', elec: '电', ice: '冰', poison: '毒', weak: '虚弱', wither: '凋零', glitch: '乱码' };

/* ---------------- 对局状态快照 ---------------- */
function publicState(game, viewerIdx) {
  const out = {
    roomId: game.roomId,
    mode: game.mode,
    phase: game.phase,
    turn: game.turn,
    turnCount: game.turnCount,
    winner: game.winner,
    log: game.log.slice(-40),
    you: null,
    sides: []
  };
  for (let i = 0; i < game.sides.length; i++) {
    const s = game.sides[i];
    const main = s.buildings.find(x => x.main && !x.destroyed);
    const pending = s.pendingShields.reduce((a, p) => ({ pct: Math.max(a.pct, p.pct), reflect: Math.max(a.reflect, p.reflect) }), { pct: 0, reflect: 0 });
    const sideView = {
      index: i,
      team: s.team,
      name: s.name,
      faction: s.faction,
      factionName: s.factionName,
      factionColor: s.factionColor,
      energy: s.energy,
      maxEnergy: s.maxEnergy,
      status: Object.assign({}, s.status),
      globalShield: s.globalShield,
      fieldLeft: s.fieldLeft,
      attackTarget: s.attackTarget,
      shieldReady: pending.pct > 0,          // 减伤卡已打出,对方回合将生效
      shieldReadyReflect: pending.reflect,
      phase: main ? main.phase : 0,
      eliminated: !!s.eliminated,
      buildings: s.buildings.filter(x => !x.destroyed).map(b => ({
        uid: b.uid, cardId: b.cardId, name: b.name, type: b.type, main: b.main,
        hp: b.hp, maxHp: b.maxHp, priority: b.priority, buffs: Object.assign({}, b.buffs)
      })),
      handCount: s.hand.length,
      deckCount: -1,
      deckInfinite: true,
      skipNext: s.skipNext,
      noMoreCards: s.noMoreCards,
      hand: s.hand.map(c => ({ id: c.id, name: c.name, type: c.type, cost: c.cost || 0, desc: c.desc, faction: c.faction, main: !!c.main, count: c.count, weight: c.weight }))
    };
    if (i === viewerIdx) out.you = sideView;
    out.sides.push(sideView);
  }
  return out;
}

module.exports = { createGame, startGame, beginTurn, endTurn, playCard, publicState, drawCards, applyStatus };
