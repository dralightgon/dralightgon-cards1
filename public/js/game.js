/* =========================================================
 * 卡牌对决 - 对战逻辑 v4
 * 1v1 / 2v2(四人独立阵营·明牌)·待出牌区·选定目标·对方回合减伤
 * ========================================================= */
(function () {
  'use strict';
  const F = window.CARDS.FACTIONS;
  const B = window.CARDS.BUILDINGS;
  const DB = window.CARDS.CARD_DB;
  const STATUS_META = {
    rad:    { icon: '☢', name: '辐射', eff: '最高8级,每级造成1/5/10/20/30/50/75/100伤害。无视减伤,无法反伤,可电增伤。每回合降1级' },
    fire:   { icon: '🔥', name: '火', eff: '最高8级,每级造成5/10/15/20/25/30伤害。可减伤,无法反伤,可电增伤。每两回合降1级' },
    elec:   { icon: '⚡', name: '电', eff: '最高4级,每级受伤增加20%/50%/100%/200%。每两回合降1级' },
    ice:    { icon: '❄', name: '冰', eff: '最高4级,每级减少1/2/3/4体力。每回合降1级' },
    poison: { icon: '☠', name: '毒', eff: '最高5级,每级造成1%/2%/3%/4%/5%最大血量伤害。无视减伤,无法反伤,无法电增伤。不会降低,只能被卡牌清除' },
    weak:   { icon: '💫', name: '虚弱', eff: '最高3级,每级减少10%/20%/30%伤害。每回合降1级' },
    wither: { icon: '🥀', name: '凋零', eff: '最高3级,每级造成10/20/30、20/35/50、30/45/60伤害。可减伤,无法反伤,可电增伤。每两回合降1级' },
    glitch: { icon: '⚙', name: '乱码', eff: '无上限,每级永久减少1%血量上限。不会降低,仅MINECRAFT阵营卡牌可消除' }
  };

  let state = null;
  let mySide = 0;
  let myTeam = 0;
  let spectating = false;
  let curLogLen = 0;
  let inGame = false;
  let isOwner = false;
  let waitRoom = null;

  // ---- 出牌交互状态 ----
  let selHand = -1;
  let targetMode = null;
  let targetUid = null;
  let lockedPrio = -1;
  let lockedSideIdx = -1; // 锁定目标所属阵营(index),优先受伤等级仅在该阵营内生效
  let allyDiscardIdx = -1;
  let enemyCardIdx = -1;
  let subCount = 1;
  let longPressFired = false;

  const $ = id => document.getElementById(id);
  function toast(msg) { window.LobbyToast(msg); }

  function cardNeedsTarget(c) {
    if (!c) return null;
    const def = DB[c.id];
    const fx = def ? def.effects : null;
    if (!fx) return null;
    const single = fx.some(ef => ef.op === 'damage' && (ef.targets === 'priority' || ef.targets === 'others'));
    if (single) return 'building';
    if (fx.some(ef => ef.op === 'returnCard')) return 'enemyHand';
    if (fx.some(ef => ef.op === 'discard')) return 'allyHand';
    if (fx.some(ef => ef.op === 'substitute')) return 'subCount';
    if (fx.some(ef => ef.op === 'learnCard')) return 'enemyHand';
    return null;
  }

  function isMyTurn() {
    return state && state.phase === 'playing' && state.turn === mySide && !spectating && state.you;
  }
  function mySideView() { return state.you; }
  function enemies() { return state.sides.filter(s => s.team !== myTeam && s.index !== mySide); }
  function allySide() { return state.sides.find(s => s.team === myTeam && s.index !== mySide) || null; }

  /* ---------------- 状态栏(效果+等级) ---------------- */
  function statusHtml(side) {
    let html = '';
    for (const k of Object.keys(STATUS_META)) {
      if (side.status[k] > 0) {
        html += `<div class="st-row"><span class="st-icon">${STATUS_META[k].icon}</span><span class="st-lv">${side.status[k]}级</span><span class="st-name">${STATUS_META[k].name}</span><span class="st-eff">${STATUS_META[k].eff}</span></div>`;
      }
    }
    if (side.globalShield > 0) html += `<div class="st-row gold"><span class="st-icon">🛡</span><span class="st-lv"></span><span class="st-name">全局减伤</span><span class="st-eff">${side.globalShield}%</span></div>`;
    if (side.fieldLeft > 0) html += `<div class="st-row gold"><span class="st-icon">✦</span><span class="st-lv"></span><span class="st-name">力场</span><span class="st-eff">剩余${side.fieldLeft}次·每次限伤200</span></div>`;
    if (side.shieldReady) html += `<div class="st-row gold"><span class="st-icon">🛡</span><span class="st-lv"></span><span class="st-name">减伤待发</span><span class="st-eff">对方回合生效一回合${side.shieldReadyReflect ? '·反伤' + side.shieldReadyReflect + '%' : ''}</span></div>`;
    if (side.skipNext) html += `<div class="st-row gold"><span class="st-icon">⏳</span><span class="st-lv"></span><span class="st-name">跳过</span><span class="st-eff">下回合被跳过</span></div>`;
    if (!html) html = '<div class="st-none">无</div>';
    return html;
  }

  /* ---------------- 卡牌/建筑/状态详情(点击显示到信息面板) ---------------- */
  function showInfo(name, tag, desc) {
    $('ipName').textContent = name || '';
    $('ipTag').textContent = tag || '';
    $('ipDesc').textContent = desc || '';
    // 悬浮在牌组(手牌区)正上方,不遮挡手牌
    const ha = document.querySelector('.hand-area');
    if (ha) {
      const r = ha.getBoundingClientRect();
      $('infoPanel').style.bottom = (window.innerHeight - r.top + 8) + 'px';
    }
    $('infoPanel').style.display = 'block';
  }
  function hideInfo() { $('infoPanel').style.display = 'none'; }
  function showCardDetail(c) {
    if (!c) return;
    showInfo(c.name, c.type === 'building' ? '建筑' : c.type === 'passive' ? '被动' : '技能',
      (c.cost ? '体力消耗 ' + c.cost + ' · ' : '') + (c.desc || ''));
  }
  function showBuildingInfo(b) {
    const tpl = B[b.cardId];
    const tag = '建筑' + (b.priority ? ' · 优' + b.priority : '');
    const hp = '血量 ' + Math.max(0, b.hp) + ' / ' + b.maxHp;
    const desc = (tpl && tpl.desc ? tpl.desc : (b.main ? '阵营主城,被摧毁则该阵营败北。' : '')) + ' · 当前 ' + hp;
    showInfo(b.name + (b.phase === 2 ? ' (二阶段)' : ''), tag, desc);
  }
  function attachLongPress(el, card, onClick) {
    el.addEventListener('click', (e) => {
      showCardDetail(card);
      if (onClick) onClick(e);
    });
  }
  function bindStatusClicks() {
    document.querySelectorAll('.sp-body').forEach(el => {
      el.onclick = (e) => {
        const row = e.target.closest('.st-row');
        if (!row) return;
        if (row.dataset.st && STATUS_META[row.dataset.st]) {
          const m = STATUS_META[row.dataset.st];
          const lv = row.querySelector('.st-lv');
          showInfo(m.name + (lv && lv.textContent ? ' ' + lv.textContent : ''), '状态效果', m.eff);
        } else if (row.classList.contains('gold')) {
          const nm = ((row.querySelector('.st-name') || {}).textContent) || '';
          const ef = ((row.querySelector('.st-eff') || {}).textContent) || '';
          let desc = ef;
          if (nm === '全局减伤') desc = '创世神开局100%减伤,每回合下降8%。';
          if (nm === '力场') desc = '创世神力场:每次受到攻击限伤200。';
          if (nm === '减伤待发') desc = '已使用的减伤卡,对方回合自动生效一回合。';
          if (nm === '跳过') desc = '该阵营下回合被跳过。';
          showInfo(nm, '状态效果', desc);
        }
      };
    });
  }

  /* ---------------- 明牌小卡(对方/队友手牌) ---------------- */
  function renderMiniHand(container, side, canPick) {
    container.innerHTML = '';
    side.hand.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'e-card' + (canPick ? ' pickable' : '') + (canPick && i === enemyCardIdx ? ' e-card-picked' : '');
      const fc = F[c.faction];
      d.style.setProperty('--fc', fc ? fc.color : '#888');
      d.innerHTML = `<div class="ec-cost">${c.cost || 0}</div><div class="ec-name">${c.name}</div><div class="ec-type">${c.type === 'building' ? '建筑' : c.type === 'passive' ? '被动' : '技能'}</div>`;
      attachLongPress(d, c, () => { if (canPick) { enemyCardIdx = i; render(); } });
      container.appendChild(d);
    });
  }

  /* ---------------- 建筑区(可选定攻击目标) ---------------- */
  function renderBuildings(container, side, opts) {
    opts = opts || {};
    container.innerHTML = '';
    for (const b of side.buildings) {
      const div = document.createElement('div');
      div.className = 'bldg' + (b.main ? ' main' : '') + (b.priority ? ' prio' : '');
      const pct = Math.max(0, Math.min(100, b.hp / b.maxHp * 100));
      const theme = (F[side.faction] || {}).color || '#8a7a60';
      const barColor = theme;
      let buffs = '';
      if (b.buffs.shieldPct) buffs += `<span class="b-buff" title="减伤${b.buffs.shieldPct}%">🛡${b.buffs.shieldPct}%</span>`;
      if (b.buffs.reflect) buffs += `<span class="b-buff" title="反伤${b.buffs.reflect}%">↩${b.buffs.reflect}%</span>`;
      if (b.buffs.flat) buffs += `<span class="b-buff" title="伤害减免${b.buffs.flat}">⛨${b.buffs.flat}</span>`;
      div.innerHTML = `
        <div class="bldg-name" style="color:${theme}">${b.main ? '🏰 ' : ''}${b.name}${b.phase === 2 ? ' <em>II</em>' : ''}${b.priority ? ` <em class="prio-tag">优${b.priority}</em>` : ''}</div>
        <div class="bldg-bar"><div class="bldg-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="bldg-hp" style="color:${theme}">${Math.max(0, b.hp)} / ${b.maxHp}</div>
        ${buffs ? `<div class="bldg-buffs">${buffs}</div>` : ''}
      `;
      if (opts.selectable && isMyTurn()) {
        div.classList.add('bldg-selectable');
        if (targetUid === b.uid) div.classList.add('bldg-target');
        if (lockedPrio > 0 && side.index === lockedSideIdx && b.priority < lockedPrio) div.classList.add('bldg-locked');
        div.onclick = () => {
          if (lockedPrio > 0 && side.index === lockedSideIdx && (b.priority || 0) < lockedPrio) {
            toast('已自动锁定到更优先受伤的建筑,无法更换');
            return;
          }
          targetUid = b.uid;
          lockedPrio = b.priority || 0;
          lockedSideIdx = side.index;
          render();
          toast('已选定目标:' + b.name);
          showBuildingInfo(b);
        };
      }
      container.appendChild(div);
    }
  }

  /* 自动锁定:优先受伤等级只在目标所属阵营内生效,不跨阵营 */
  function autoLockTarget() {
    if (targetUid == null) return;
    let cur = null, curSide = null;
    for (const e of enemies()) {
      const fb = e.buildings.find(x => x.uid === targetUid);
      if (fb) { cur = fb; curSide = e; break; }
    }
    if (!cur || !curSide) return;
    const maxPrio = Math.max(0, ...curSide.buildings.map(b => b.priority || 0));
    if (maxPrio > lockedPrio) {
      const higher = curSide.buildings.filter(b => (b.priority || 0) === maxPrio && !b.destroyed);
      if (higher.length) {
        targetUid = higher[0].uid;
        lockedPrio = maxPrio;
        lockedSideIdx = curSide.index;
        toast('出现更优先受伤的建筑,目标已自动锁定');
      }
    }
  }

  /* ---------------- 单个 side 卡片(敌方/队友/自己共用) ---------------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function sideBlock(side, opts) {
    opts = opts || {};
    const fac = F[side.faction];
    const div = document.createElement('div');
    let cls = 'side-block' + (opts.targetActive ? ' target-active' : '');
    div.className = cls;
    div.style.setProperty('--fc', fac.color);
    const shieldTag = side.shieldReady ? '<span class="sb-shield-ready">🛡 对方回合减伤</span>' : '';
    div.innerHTML = `
      ${opts.atkTag ? '<div class="sb-atk-tag">🎯 当前攻击目标</div>' : ''}
      ${opts.teamTag ? `<div class="sb-team-tag">${opts.teamTag}</div>` : ''}
      <div class="side-info">
        <div class="side-id">
          <div class="side-faction"><img src="${fac.img}" alt=""><b style="color:${fac.color}">${fac.name}</b></div>
          <div class="side-name">${esc(side.name)}</div>
        </div>
        ${shieldTag}
        <div class="side-meters">
          <div class="meter energy"><span class="meter-label">体力</span><b>${side.energy}</b></div>
          <div class="meter deck"><span class="meter-label">牌堆</span><b>∞</b></div>
          <div class="meter hand"><span class="meter-label">手牌</span><b>${side.handCount}</b></div>
        </div>
      </div>
      <div class="status-panel"><div class="sp-title">状态效果</div><div class="sp-body">${statusHtml(side)}</div></div>
      <div class="mini-hand" id="mini-${side.index}"></div>
      <div class="buildings" id="bldg-${side.index}"></div>
    `;
    return div;
  }

  /* ---------------- 主渲染 ---------------- */
  function render() {
    if (!state || !state.sides || state.sides.length < 2) return;
    if (spectating || !state.you) { renderSpectateView(); return; }
    const me = mySideView();
    const enems = enemies();

    // 优先级自动锁定:先于渲染执行,切换后直接反映到画面
    if (isMyTurn() && targetMode === 'building') autoLockTarget();
    else if (!isMyTurn()) { targetUid = null; lockedPrio = -1; lockedSideIdx = -1; }

    // 敌方区块
    const ep = $('enemyPanel');
    ep.innerHTML = '';
    const enemyWrap = document.createElement('div');
    enemyWrap.className = 'enemy-wrap';
    const meAT = me.attackTarget;
    for (const e of enems) {
      const block = sideBlock(e, {
        teamTag: '敌方',
        atkTag: enems.length > 1 && meAT === e.index && isMyTurn(),
        targetActive: enems.length > 1 && meAT === e.index && isMyTurn()
      });
      enemyWrap.appendChild(block);
      renderMiniHand(block.querySelector('#mini-' + e.index), e, targetMode === 'enemyHand' && isMyTurn());
      renderBuildings(block.querySelector('#bldg-' + e.index), e, { selectable: true });
      if (enems.length > 1 && isMyTurn()) {
        block.onclick = (ev) => {
          if (ev.target.closest('.bldg') || ev.target.closest('.e-card')) return;
          if (targetMode !== 'building') return;
          if (meAT === e.index) return;
          Net.send({ t: 'attackTarget', idx: e.index });
          render();
          toast('攻击目标:' + e.factionName);
        };
      }
    }
    ep.appendChild(enemyWrap);

    // 队友区块(2v2,明牌但不可操作)
    const allyArea = $('allySideArea');
    allyArea.innerHTML = '';
    const ally = allySide();
    if (ally) {
      const ab = sideBlock(ally, { teamTag: '队友' });
      allyArea.appendChild(ab);
      renderMiniHand(ab.querySelector('#mini-' + ally.index), ally, false);
      renderBuildings(ab.querySelector('#bldg-' + ally.index), ally, {});
    }

    // 自己区块
    const selfArea = $('selfSideArea');
    selfArea.innerHTML = '';
    const sb = sideBlock(me, { teamTag: '我方' });
    selfArea.appendChild(sb);
    renderBuildings(sb.querySelector('#bldg-' + me.index), me, {});

    renderHand();
    renderSelectedZoneIfAny();
    renderTopbar();
    renderLog();
    bindStatusClicks();
  }

  /* ---------------- 观战视图(明牌,不可操作) ---------------- */
  function renderSpectateView() {
    const ep = $('enemyPanel');
    ep.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'enemy-wrap';
    for (const sv of state.sides) {
      const block = sideBlock(sv, { teamTag: '队' + (sv.team + 1), atkTag: false, targetActive: false });
      wrap.appendChild(block);
      renderMiniHand(block.querySelector('#mini-' + sv.index), sv, false);
      renderBuildings(block.querySelector('#bldg-' + sv.index), sv, {});
    }
    ep.appendChild(wrap);
    $('allySideArea').innerHTML = '';
    $('selfSideArea').innerHTML = '';
    renderHand();
    renderSelectedZoneIfAny();
    renderTopbar();
    renderLog();
    const et = $('btnEndTurn');
    if (et) et.style.display = 'none';
    const cp = $('btnConfirmPlay'), cc = $('btnCancelSelect');
    if (cp) cp.style.display = 'none';
    if (cc) cc.style.display = 'none';
  }

  /* ---------------- 手牌(自己,固定区域) ---------------- */
  function renderHand() {
    const row = $('handRow');
    const you = state.you;
    const eb = $('energyBadge');
    if (eb) {
      if (you && !spectating) {
        eb.style.display = 'inline-flex';
        $('energyBadgeText').textContent = '体力 ' + you.energy;
        eb.classList.toggle('over', you.energy < 1 && isMyTurn());
      } else {
        eb.style.display = 'none';
      }
    }
    if (!you) {
      row.innerHTML = '';
      $('handHint').textContent = spectating ? '观战中' : '等待对方行动…';
      return;
    }
    row.innerHTML = '';
    you.hand.forEach((c, i) => {
      const div = document.createElement('div');
      const affordable = isMyTurn() && !you.noMoreCards && (c.cost || 0) <= you.energy;
      div.className = 'card' + (isMyTurn() ? ' mycard' : '') + (affordable ? ' playable' : '') + (selHand === i ? ' selected' : '') + (targetMode === 'allyHand' && i === allyDiscardIdx ? ' discard-target' : '');
      const fc = F[c.faction] || F[you.faction];
      div.style.setProperty('--fc', fc ? fc.color : '#888');
      div.innerHTML = `
        <div class="card-cost">${c.cost || 0}</div>
        <div class="card-name">${c.name}</div>
        <div class="card-type">${c.type === 'building' ? '建筑' : c.type === 'passive' ? '被动' : '技能'}</div>
        <div class="card-desc-mini">${(c.desc || '').slice(0, 16)}${(c.desc || '').length > 16 ? '…' : ''}</div>
      `;
      attachLongPress(div, c, () => {
        if (!isMyTurn() || you.noMoreCards) return;
        if (targetMode === 'allyHand') {
          if (i === selHand) { toast('不能丢弃待出的牌'); return; }
          allyDiscardIdx = i;
          render();
          return;
        }
        if (selHand === i) { clearSelect(); render(); return; }
        selHand = i;
        setupSelect(c);
        render();
      });
      row.appendChild(div);
    });
    const hint = $('handHint');
    if (state.phase === 'ended') hint.textContent = '对局已结束';
    else if (spectating) hint.textContent = '观战中(明牌)';
    else if (state.turn !== mySide) hint.textContent = '等待对方行动…';
    else if (you.noMoreCards) hint.textContent = '本回合不能再出其他卡牌';
    else hint.textContent = '你的回合 · 点卡牌放入待出牌区(长按看效果)';
  }

  /* ---------------- 待出牌区 ---------------- */
  function setupSelect(c) {
    targetMode = cardNeedsTarget(c);
    targetUid = null;
    lockedPrio = -1;
    allyDiscardIdx = -1;
    enemyCardIdx = -1;
    subCount = 1;
    renderSelectedZone(c);
  }
  function clearSelect() {
    selHand = -1;
    targetMode = null;
    targetUid = null;
    lockedPrio = -1;
    allyDiscardIdx = -1;
    enemyCardIdx = -1;
  }
  function renderSelectedZoneIfAny() {
    const zone = $('selectedZone');
    if (selHand >= 0 && state.you && state.you.hand[selHand]) {
      renderSelectedZone(state.you.hand[selHand]);
      zone.style.display = 'block';
    } else {
      zone.style.display = 'none';
    }
  }
  function renderSelectedZone(c) {
    const zone = $('selectedZone');
    zone.style.display = 'block';
    const fc = F[c.faction];
    $('selectedCard').innerHTML = `
      <div class="card" style="--fc:${fc ? fc.color : '#888'}">
        <div class="card-cost">${c.cost || 0}</div>
        <div class="card-name">${c.name}</div>
        <div class="card-type">${c.type === 'building' ? '建筑' : c.type === 'passive' ? '被动' : '技能'}</div>
        <div class="card-desc-mini">${(c.desc || '').slice(0, 16)}</div>
      </div>`;
    const hint = $('targetHint');
    if (targetMode === 'building') {
      const n = enemies().length;
      hint.textContent = '点击对方建筑选定攻击目标' + (n > 1 ? '(可点敌方区块切换攻击对象)' : '');
    } else if (targetMode === 'allyHand') hint.textContent = '点击要献祭丢弃的己方手牌';
    else if (targetMode === 'enemyHand') hint.textContent = '点击对方一张手牌(破招/拟态)';
    else if (targetMode === 'subCount') hint.textContent = '选择献祭卡牌数量(等量提升体力)';
    else hint.textContent = '无目标需求,可直接确定出牌';
    const sb = $('subCountBox');
    if (targetMode === 'subCount') {
      sb.style.display = 'flex';
      const maxN = Math.max(0, state.you.hand.length - 1);
      let opts = '';
      for (let n = 1; n <= maxN; n++) opts += `<button class="sc-btn${n === subCount ? ' on' : ''}" data-n="${n}">${n}</button>`;
      if (maxN === 0) opts = '<span class="st-none">无可献祭手牌</span>';
      sb.innerHTML = opts;
      sb.querySelectorAll('.sc-btn').forEach(b => b.onclick = () => { subCount = parseInt(b.dataset.n, 10); renderSelectedZone(state.you.hand[selHand]); });
    } else {
      sb.style.display = 'none';
    }
  }

  function renderTopbar() {
    const turnEl = $('gtTurn');
    if (state.phase === 'ended') {
      turnEl.textContent = '已结束';
      turnEl.className = 'gt-turn ended';
    } else if (spectating || !state.you) {
      const cur = state.sides[state.turn];
      turnEl.textContent = `第${state.turnCount}回合 · ${cur ? cur.factionName + '(队' + (cur.team + 1) + ')' : '观战'}`;
      turnEl.className = 'gt-turn';
    } else {
      const cur = state.sides[state.turn];
      let who = '?';
      if (cur) {
        who = cur.factionName;
        if (state.sides.length > 2) who += '(队' + (cur.team + 1) + ')';
      }
      const meMark = (state.turn === mySide && state.you) ? ' · 你的回合' : '';
      turnEl.textContent = `第${state.turnCount}回合 · ${who}${meMark}`;
      turnEl.className = 'gt-turn ' + (state.turn === mySide ? 'mine' : '');
    }
    $('gtRoom').textContent = `房间 ${state.roomId} · ${state.mode === '2v2' ? '2v2 四人独立' : state.mode === '1v1v1' ? '1v1v1 三方混战' : '1v1'}`;
  }

  function renderLog() {
    if (!state) return;
    const body = $('logBody');
    if (state.log.length !== curLogLen) {
      const newStart = curLogLen;
      curLogLen = state.log.length;
      body.innerHTML = '';
      for (const line of state.log) {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.textContent = line;
        body.appendChild(div);
      }
      body.scrollTop = body.scrollHeight;
      // 自身受伤提示(非自己回合,排除持续伤害来源=自己)
      if (state.you && !isMyTurn()) {
        const myTag = state.you.factionName + '的「';
        for (let i = newStart; i < state.log.length; i++) {
          const line = state.log[i];
          if (line.startsWith(myTag) && line.indexOf('受到来自 ') >= 0 && line.indexOf(' 点伤害') >= 0) {
            const m = line.match(/受到来自 (.+?) 的 (\d+) 点伤害/);
            const bm = line.match(/的「(.+?)」受到/);
            if (m && bm && m[1] !== state.you.factionName) {
              toast('💥 你的「' + bm[1] + '」受到来自 ' + m[1] + ' 的 ' + m[2] + ' 点伤害');
            }
          }
        }
      }
    }
  }

  function appendChat(who, text) {
    const body = $('chatBody');
    const div = document.createElement('div');
    div.className = 'chat-line';
    div.innerHTML = `<b>${esc(who)}:</b> ${esc(text)}`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  /* ---------------- 等待区(1v1 2槽 / 2v2 4槽,各执阵营) ---------------- */
  function renderWait(room) {
    if (!room || state) return;
    waitRoom = room;
    const wait = $('lobbyWait');
    wait.style.display = 'block';
    $('waitRoom').textContent = `房间 ${room.id} · ${room.mode === '2v2' ? '2v2 四人独立' : room.mode === '1v1v1' ? '1v1v1 三方混战' : '1v1'}`;
    $('gtRoom').textContent = `房间 ${room.id} · ${room.mode === '2v2' ? '2v2 四人独立' : room.mode === '1v1v1' ? '1v1v1 三方混战' : '1v1'}`;

    const total = room.mode === '2v2' ? 4 : (room.mode === '1v1v1' ? 3 : 2);
    const teamsBox = $('waitTeams');
    teamsBox.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'wait-grid';
    for (let si = 0; si < total; si++) {
      const is1v1 = room.mode === '1v1';
      const ti = room.mode === '1v1v1' ? si : (si < 2 ? 0 : 1);
      const slot = (room.mode === '2v2') ? (si % 2) : 0;
      const name = room.teams[ti] && room.teams[ti][slot] ? room.teams[ti][slot] : '';
      const fac = room.factions[si] ? F[room.factions[si]] : null;
      const isMine = si === mySide;
      const div = document.createElement('div');
      div.className = 'wait-slot' + (isMine ? ' mine' : '');
      div.innerHTML = `
        <div class="wt-tag">${isMine ? '我方' : (room.mode === '2v2' ? (ti === 0 ? '队友' : '敌方') : '敌方')}</div>
        <div class="wt-faction" ${fac ? `style="color:${fac.color}"` : ''}>${fac ? fac.name : '未选择'}</div>
        <div class="wt-name">${name ? esc(name) : '<em>等待加入…</em>'}</div>
        <div class="wt-ready">${fac ? '✓ 就绪' : '…'}</div>
      `;
      grid.appendChild(div);
    }
    teamsBox.appendChild(grid);

    const myFac = room.factions[mySide];
    $('waitFactionPick').style.display = myFac ? 'none' : 'grid';
    $('waitFactionTitle').textContent = myFac ? '' : (room.mode === '2v2' ? '选择你的阵营(四人各不相同)' : room.mode === '1v1v1' ? '选择你的阵营(三人各不相同)' : '选择你的阵营');
    if (!myFac && $('waitFactionPick').children.length === 0) {
      const box = $('waitFactionPick');
      const used = room.factions.filter(Boolean);
      for (const id of Object.keys(F)) {
        const f = F[id];
        if (room.mode !== '1v1' && used.includes(id)) continue;
        const d = document.createElement('div');
        d.className = 'faction-opt';
        d.innerHTML = `<img src="${f.img}" alt=""><div class="fo-name">${f.name}</div>`;
        d.onclick = () => Net.send({ t: 'setFaction', faction: id });
        box.appendChild(d);
      }
    }

    const need = room.mode === '2v2' ? 2 : 1;
    const is1v1 = room.mode === '1v1';
    let ready = true;
    for (let ti = 0; ti < room.teams.length; ti++) {
      const names = room.teams[ti] || [];
      const humans = names.filter(Boolean);
      if (humans.length < need) { ready = false; break; }
      for (let s = 0; s < humans.length; s++) {
        const fi = (room.mode === '2v2') ? ti * 2 + s : ti;
        if (!room.factions[fi]) { ready = false; break; }
      }
    }
    const startBtn = $('btnStart');
    startBtn.style.display = (isOwner && ready && !spectating) ? 'block' : 'none';
  }

  /* ---------------- 入口 ---------------- */
  function enter(opts) {
    mySide = opts.sideIdx >= 0 ? opts.sideIdx : (opts.teamIdx >= 0 ? opts.teamIdx : 0);
    myTeam = opts.teamIdx >= 0 ? opts.teamIdx : (mySide < 2 ? 0 : 1);
    spectating = !!opts.spectate;
    isOwner = !!opts.isOwner;
    inGame = true;
    curLogLen = 0;
    state = null;
    waitRoom = null;
    clearSelect();
    ['enemyPanel', 'allySideArea', 'selfSideArea', 'handRow', 'handHint']
      .forEach(id => { const el = $(id); if (el) el.innerHTML = ''; });
    $('selectedZone').style.display = 'none';
    $('gtTurn').textContent = '';
    $('logBody').innerHTML = '';
    $('chatBody').innerHTML = '';
    $('endModal').style.display = 'none';
    $('cardDetailModal').style.display = 'none';
    $('waitFactionPick').innerHTML = '';
    if (opts.state) { state = opts.state; curLogLen = state.log.length; $('lobbyWait').style.display = 'none'; render(); }
    else { $('lobbyWait').style.display = 'block'; if (opts.room) renderWait(opts.room); }
  }

  /* ---------------- 网络消息 ---------------- */
  Net.on('room', (m) => renderWait(m.room));
  Net.on('state', (m) => {
    if (!inGame) return;
    state = m.state;
    if (state.phase !== 'lobby') $('lobbyWait').style.display = 'none';
    render();
    if (state.phase === 'ended') {
      const youWon = !spectating && state.winner === myTeam;
      $('endTitle').textContent = spectating ? '对局结束' : (youWon ? '🎉 胜利!' : '💀 失败');
      $('endSub').textContent = state.winner != null ? (state.sides.find(s => s.team === state.winner).factionName + ' 方获胜') : '对局结束';
      $('endModal').style.display = 'flex';
      clearSelect();
    }
  });
  Net.on('chat', (m) => appendChat(m.who, m.text));

  /* ---------------- 事件 ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    $('ipClose').onclick = () => hideInfo();
    $('btnEndTurn').onclick = () => {
      if (state && inGame && state.turn === mySide && state.phase === 'playing' && !spectating) {
        clearSelect();
        Net.send({ t: 'endTurn' });
      }
    };
    $('btnStart').onclick = () => { Net.send({ t: 'start' }); };
    $('btnLog').onclick = () => { $('logDrawer').classList.toggle('open'); renderLog(); };
    $('btnChat').onclick = () => $('chatDrawer').classList.toggle('open');
    document.querySelectorAll('.close-x').forEach(b => {
      b.onclick = () => document.getElementById(b.dataset.close).classList.remove('open');
    });
    $('chatSend').onclick = sendChat;
    $('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
    function sendChat() {
      const v = $('chatInput').value.trim();
      if (!v) return;
      Net.send({ t: 'chat', text: v });
      $('chatInput').value = '';
    }

    $('btnConfirmPlay').onclick = () => {
      if (!isMyTurn()) return;
      if (selHand < 0 || !state.you || !state.you.hand[selHand]) return;
      const c = state.you.hand[selHand];
      if ((c.cost || 0) > state.you.energy) {
        toast('体力不足(需要 ' + c.cost + ')');
        return;
      }
      const extra = {};
      if (targetMode === 'building') {
        if (targetUid == null) { toast('请先点击对方建筑选定攻击目标'); return; }
        extra.target = targetUid;
      } else if (targetMode === 'allyHand') {
        if (allyDiscardIdx < 0) { toast('请点击要献祭丢弃的己方手牌'); return; }
        extra.discardIdx = allyDiscardIdx;
      } else if (targetMode === 'enemyHand') {
        if (enemyCardIdx < 0) { toast('请点击对方一张手牌'); return; }
        extra.targetHand = enemyCardIdx;
      } else if (targetMode === 'subCount') {
        extra.subCount = subCount;
      }
      Net.send(Object.assign({ t: 'playCard', handIdx: selHand }, extra));
      clearSelect();
    };
    $('btnCancelSelect').onclick = () => { clearSelect(); render(); };
    $('cardDetailModal').addEventListener('click', (e) => {
      if (e.target === $('cardDetailModal') || e.target.closest('.cd-tip')) hideCardDetail();
    });
  });

  window.Game = { enter };
})();
