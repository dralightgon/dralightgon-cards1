/* =========================================================
 * 卡牌对决 - 电脑 AI
 * 三种难度: easy(简单) / normal(普通) / hard(困难)
 * AI 与真人共用同一规则引擎,仅决策逻辑不同
 * ========================================================= */
'use strict';

/* 状态分值(每级) */
const STATUS_SCORE = { rad: 6, fire: 7, elec: 5, ice: 4, poison: 6, weak: 5, wither: 8, glitch: 6 };

function rnd(n) { return Math.floor(Math.random() * n); }

function mainPhase(side) {
  const main = side.buildings.find(b => b.main);
  return main && main.phase ? 1 : 0;
}

function phaseVal(v, phase) {
  if (Array.isArray(v)) return v[phase] !== undefined ? v[phase] : v[0];
  return v;
}

/* 评估单个效果 */
function rateEffect(fx, card, side, enemy, difficulty) {
  let s = 0;
  const phase = mainPhase(side);
  switch (fx.op) {
    case 'damage': {
      const d = phaseVal(fx.dmg, phase) || 0;
      const d1 = phaseVal(fx.dmgFirst, phase) || 0;
      const dr = phaseVal(fx.dmgRest, phase) || 0;
      let mult = 1;
      if (fx.targets === 'main') mult = 1.45;          // 直接打本体
      else if (fx.targets === 'all') mult = 1.7;       // 全体
      else if (fx.targets === 'priority') mult = 1.1;
      else if (fx.targets === 'others') mult = 1.25;
      const total = d + d1 + dr * 0.5;
      s += total * mult * (difficulty === 'hard' ? 1.25 : 1);
      // 击杀价值:本体残血时集火
      if (fx.targets === 'main' || fx.targets === 'priority' || fx.targets === 'all') {
        const main = enemy.buildings.find(b => b.main && !b.destroyed);
        if (main && total >= main.hp) s += 80;
        else if (main && total >= main.hp * 0.5) s += 25;
      }
      break;
    }
    case 'status': {
      const lv = phaseVal(fx.level, phase) || 0;
      const v = STATUS_SCORE[fx.status] || 5;
      s += lv * v * (fx.targets === 'self' ? 1 : 1.1);
      break;
    }
    case 'heal': {
      const amt = phaseVal(fx.amount, phase) || 0;
      const main = side.buildings.find(b => b.main && !b.destroyed);
      const lost = main ? main.maxHp - main.hp : 0;
      let urgency = 0.4;
      if (main && main.hp < main.maxHp * 0.35) urgency = 2.0;
      else if (main && main.hp < main.maxHp * 0.6) urgency = 1.3;
      else if (lost > 0) urgency = 0.7;
      s += amt * 0.9 * urgency;
      if (fx.targets === 'allBuildings') s += amt * 0.4;
      break;
    }
    case 'shield': s += 22 + (phaseVal(fx.pct, phase) || 0) * 0.18 + (phaseVal(fx.reflect, phase) || 0) * 0.09 + (fx.elecOnHit || 0) * 3; break;
    case 'energy': s += (fx.n || 0) * 9; break;
    case 'energyPenalty': s += 7; break;
    case 'draw': s += (fx.n || 0) * 9; break;
    case 'clearStatus': {
      const hasStatus = Object.values(side.status).some(v => v > 0);
      s += hasStatus ? 24 : 3;
      break;
    }
    case 'skipTurn': s += 28; break;
    case 'returnCard': s += 8; break;
    case 'discard': s -= 5; break;
    case 'noMoreCards': s -= 14; break;
    case 'nuke': s += 95; break;
    case 'glitchHit': s += 22 + enemy.status.glitch * 2; break;
    case 'annihilate': s += 165; break;
    case 'reforge': s += 6 + enemy.status.glitch * 9; break;
    case 'substitute': s += 12; break;
    case 'copyStatus': {
      const mine = Object.values(side.status).reduce((a, v) => a + v, 0);
      s += mine > 0 ? 16 : 1;
      break;
    }
    case 'maxHpUp': s += (phaseVal(fx.amount, phase) || 0) * 1.3; break;
    case 'learnCard': s += 7; break;
    case 'field': s += 30; break;
    case 'immortal': s += 25; break;
    default: s += 4;
  }
  return s;
}

/* 评估一张卡牌(分值越大越值得出) */
function rateCard(card, side, enemy, difficulty) {
  if (card.type === 'building') {
    if (card.main) return -1000;              // 本体不会在手牌
    let s = 42;
    if (card.priority) s += 14;               // 优先受伤建筑
    if (card.hp <= 100) s += 6;               // 低成本功能建筑
    if (card.hp > 500) s += 8;
    return s;
  }
  if (card.type === 'passive') return 32;      // 力场/生生不息:尽早打出
  let s = 0;
  for (const fx of (card.effects || [])) s += rateEffect(fx, card, side, enemy, difficulty);
  if (card.cost >= 5) s += 10;                 // 高费强力牌
  return s;
}

/* 等量代换等需要选择数量的牌 */
function defaultSub(card, side) {
  if (card.id === 'cr_substitute') {
    // 献祭手里低价值牌,保留至少 2 张
    return Math.max(1, Math.min(3, side.hand.length - 2));
  }
  return 1;
}

/* AI 单次决策:返回 { action:'play'|'end', handIdx?, subCount? } */
function aiDecide(game, sideIdx, difficulty) {
  const side = game.sides[sideIdx];
  // 敌方:2v2 取 attackTarget,否则取威胁最大(主城血量比例最低)的敌人
  const enemies = game.sides.filter(s => s.team !== side.team && s.index !== side.index);
  let enemy = null;
  if (side.attackTarget != null && enemies.some(e => e.index === side.attackTarget)) {
    enemy = game.sides[side.attackTarget];
  } else if (enemies.length) {
    enemy = enemies.reduce((a, b) => {
      const am = a.buildings.find(x => x.main && !x.destroyed);
      const bm = b.buildings.find(x => x.main && !x.destroyed);
      const ar = am ? am.hp / am.maxHp : 1;
      const br = bm ? bm.hp / bm.maxHp : 1;
      return br < ar ? b : a;
    });
    side.attackTarget = enemy.index;
  }
  if (!enemy) return { action: 'end' };
  if (side.noMoreCards || !side.hand.length) return { action: 'end' };

  const playable = side.hand.map((cd, i) => ({ cd, i, cost: cd.cost || 0 }))
    .filter(x => x.cost <= side.energy);
  if (!playable.length) return { action: 'end' };

  /* --- 简单:随机为主,常提前结束 --- */
  if (difficulty === 'easy') {
    if (Math.random() < 0.32) return { action: 'end' };
    const pool = playable.slice().sort(() => Math.random() - 0.5);
    const pick = pool[0];
    return { action: 'play', handIdx: pick.i, subCount: defaultSub(pick.cd, side) };
  }

  /* --- 普通/困难:按评估分择优 --- */
  const scored = playable.map(p => ({ ...p, score: rateCard(p.cd, side, enemy, difficulty) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (difficulty === 'normal') {
    if (best.score <= 0 && Math.random() < 0.6) return { action: 'end' };
  } else {
    // 困难:只出有正收益的牌;低价值牌留体力
    if (best.score <= 0) return { action: 'end' };
  }
  return { action: 'play', handIdx: best.i, subCount: defaultSub(best.cd, side) };
}

module.exports = { aiDecide, rateCard };
