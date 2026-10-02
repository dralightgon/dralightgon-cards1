/* =========================================================
 * 卡牌对决 - 大厅逻辑(单页应用:大厅/对战同页切换)
 * ========================================================= */
(function () {
  'use strict';
  const F = window.CARDS.FACTIONS;
  let myFaction = 'overworld';
  let myName = localStorage.getItem('cb_name') || '';

  const viewLobby = () => document.getElementById('viewLobby');
  const viewGame = () => document.getElementById('viewGame');

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }
  window.LobbyToast = toast;

  /* --- 连接状态 --- */
  Net.onConnStatus = (s) => {
    const el = document.getElementById('connStatus');
    el.textContent = s === 'off' ? '连接断开' : (s === 'ok' ? '已连接' : '连接中…');
    el.className = 'conn-status ' + (s === 'off' ? 'bad' : s === 'ok' ? 'good' : '');
  };

  /* --- 阵营选择 --- */
  function renderFactions() {
    const box = document.getElementById('factionPicker');
    box.innerHTML = '';
    for (const id of Object.keys(F)) {
      const f = F[id];
      const div = document.createElement('div');
      div.className = 'faction-opt' + (id === myFaction ? ' selected' : '');
      div.innerHTML = `<img src="${f.img}" alt="${f.name}"><div class="fo-name">${f.name}</div>`;
      div.onclick = () => {
        myFaction = id;
        box.querySelectorAll('.faction-opt').forEach(x => x.classList.remove('selected'));
        div.classList.add('selected');
      };
      box.appendChild(div);
    }
  }

  /* --- 房间列表 --- */
  function renderRooms(rooms) {
    const list = document.getElementById('roomList');
    document.getElementById('roomCount').textContent = rooms.length ? `(${rooms.length})` : '';
    if (!rooms.length) {
      list.innerHTML = '<div class="room-empty">暂无房间,创建一个吧</div>';
      return;
    }
    list.innerHTML = '';
    rooms.forEach(r => {
      const row = document.createElement('div');
      row.className = 'room-row';
      const busy = r.state === 'playing' || r.state === 'ended';
      const frag = (i) => `<span class="frag" style="background:${r.factions[i] ? F[r.factions[i]].color : '#555'}">${r.factions[i] ? F[r.factions[i]].name : '?'}</span>`;
      const facHtml = r.mode === '2v2' ? frag(0) + frag(1) + '<span class="vs">vs</span>' + frag(2) + frag(3)
        : r.mode === '1v1v1' ? frag(0) + '<span class="vs">vs</span>' + frag(1) + '<span class="vs">vs</span>' + frag(2)
        : frag(0) + '<span class="vs">vs</span>' + frag(1);
      row.innerHTML = `
        <div class="room-id">${r.id}</div>
        <div class="room-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)} ${r.hasPassword ? '🔒' : ''} ${r.aiCount ? '🤖' : ''}</div>
        <div class="room-mode">${r.mode === '2v2' ? '2v2' : r.mode === '1v1v1' ? '1v1v1' : '1v1'}</div>
        <div class="room-factions">${facHtml}</div>
        <div class="room-people">${r.count}/${r.need}</div>
        <button class="btn btn-join ${r.state === 'playing' ? 'btn-spectate' : ''}" data-id="${r.id}" data-pwd="${r.hasPassword ? 1 : 0}" data-state="${r.state}">${r.state === 'playing' ? '观战' : r.state === 'ended' ? '已结束' : '加入'}</button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.btn-join').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.state === 'ended') return;
        // 同步昵称
        const name = document.getElementById('nickname').value.trim();
        if (name && name !== myName) {
          myName = name;
          localStorage.setItem('cb_name', name);
          Net.send({ t: 'hello', name });
        }
        const needPwd = btn.dataset.pwd === '1';
        const pwd = needPwd ? prompt('输入房间密码:') : '';
        if (needPwd && pwd === null) return;
        Net.send({ t: 'joinRoom', roomId: btn.dataset.id, password: pwd || '' });
      };
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* --- 切换视图 --- */
  function enterGame(teamIdx, sideIdx, spectate, state, isOwner, room) {
    viewLobby().style.display = 'none';
    viewGame().style.display = 'flex';
    window.Game.enter({ teamIdx, sideIdx, spectate, state, isOwner, room });
  }
  function exitGame() {
    viewGame().style.display = 'none';
    viewLobby().style.display = 'block';
    Net.send({ t: 'leave' });
  }

  /* --- 断线自动重连后:回到大厅并刷新 --- */
  Net.onNetReconnect = () => {
    viewGame().style.display = 'none';
    viewLobby().style.display = 'block';
    Net.setStatus('ok');
    Net.send({ t: 'hello', name: myName || '玩家' });
    Net.send({ t: 'listRooms' });
  };

  /* --- 消息 --- */
  Net.on('rooms', (m) => renderRooms(m.rooms));
  Net.on('error', (m) => toast(m.msg || '操作失败'));
  Net.on('joined', (m) => {
    if (!m.room) return;
    localStorage.setItem('cb_name', myName);
    enterGame(m.teamIdx, m.sideIdx, !!m.spectate, m.state || null, !!m.isOwner, m.room);
  });

  /* --- 事件绑定 --- */
  document.addEventListener('DOMContentLoaded', () => {
    const nameEl = document.getElementById('nickname');
    if (myName) nameEl.value = myName;
    renderFactions();

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const is2v2 = btn.dataset.mode === '2v2';
        document.getElementById('aiField1v1').style.display = is2v2 ? 'none' : 'block';
        document.getElementById('aiField2v2').style.display = is2v2 ? 'block' : 'none';
      };
    });

    const refBtn = document.getElementById('btnRefreshRooms');
    if (refBtn) refBtn.onclick = () => Net.send({ t: 'listRooms' });

    document.getElementById('btnCreate').onclick = () => {
      const name = nameEl.value.trim();
      if (!name) { toast('先输入昵称'); nameEl.focus(); return; }
      myName = name;
      localStorage.setItem('cb_name', name);
      const mode = document.querySelector('.mode-btn.active').dataset.mode;
      const aiEnemy = document.getElementById('aiEnemy').value;
      const aiAlly = mode === '2v2' ? document.getElementById('aiAlly').value : 'none';
      Net.send({
        t: 'createRoom',
        name: document.getElementById('roomName').value.trim(),
        password: document.getElementById('roomPwd').value.trim(),
        mode,
        faction: myFaction,
        aiAlly,
        aiEnemy: mode === '2v2' ? document.getElementById('aiEnemy2').value : aiEnemy
      });
    };

    document.getElementById('btnBackLobby').onclick = () => {
      document.getElementById('endModal').style.display = 'none';
      exitGame();
    };
    document.getElementById('btnLeave').onclick = () => exitGame();

    Net.setStatus('ok');
    Net.connect().then(() => {
      Net.setStatus('ok');
      const name = nameEl.value.trim() || myName || '玩家';
      myName = name;
      Net.send({ t: 'hello', name });
      Net.send({ t: 'listRooms' });
    }).catch(() => Net.setStatus('off'));
  });
})();
