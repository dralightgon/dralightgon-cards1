/* =========================================================
 * 卡牌对决 - 服务器入口
 * Node.js + ws:静态页面服务 + WebSocket 联机(多房间 1v1 / 2v2 四人独立)
 * ========================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const engine = require('./game-engine.js');
const ai = require('./ai.js');
const { FACTIONS } = require('../public/js/cards-data.js');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, '..', 'public');

const AI_DIFFS = { easy: '简单', normal: '普通', hard: '困难' };

/* ---------------- 静态文件服务 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------------- 房间管理 ---------------- */
const rooms = new Map();
let roomSeq = 100;

function genRoomId() { roomSeq++; return String(roomSeq); }

function broadcast(room, msg) {
  const payload = JSON.stringify(msg);
  for (const team of room.teams) {
    for (const c of team) {
      if (c && c.readyState === 1) c.send(payload);
    }
  }
}

/* side 索引(0..3)→ 队伍(0/1)与槽位(0/1)
 * 1v1:side0=队0槽0, side1=队1槽0(每队一槽)
 * 2v2:side0,1=队0槽0/1; side2,3=队1槽0/1 */
function sideToTeam(room, sideIdx) { return room.mode === '2v2' ? (sideIdx < 2 ? 0 : 1) : sideIdx; } // 1v1/1v1v1: side 即队伍
function sideToSlot(room, sideIdx) { return room.mode === '2v2' ? (sideIdx % 2) : 0; }
function sideConn(room, sideIdx) {
  const ti = sideToTeam(room, sideIdx), slot = sideToSlot(room, sideIdx);
  return room.teams[ti][slot] || null;
}

function broadcastState(room) {
  if (!room.game) return;
  const game = room.game;
  const specJson = JSON.stringify({ t: 'state', state: engine.publicState(game, -1) });
  for (let si = 0; si < game.sides.length; si++) {
    const c = sideConn(room, si);
    if (c && c.readyState === 1) {
      c.send(JSON.stringify({ t: 'state', state: engine.publicState(game, si) }));
    }
  }
  if (room.spectators) {
    for (const c of room.spectators) {
      if (c.readyState === 1) c.send(specJson);
    }
  }
}

/* 房间列表:已结束(ended)的房间不显示 */
function visibleRooms() {
  return [...rooms.values()].filter(r => !(r.game && r.game.phase === 'ended'));
}

function roomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    hasPassword: !!room.password,
    state: room.game ? room.game.phase : 'lobby',
    factions: room.factions.slice(),
    teams: room.teams.map(t => t.filter(c => !!c).map(c => c.name)),
    count: room.teams.reduce((a, t) => a + t.filter(c => !!c).length, 0),
    need: room.mode === '2v2' ? 4 : (room.mode === '1v1v1' ? 3 : 2),
    aiCount: room.teams.reduce((a, t) => a + t.filter(c => c && c.isAI).length, 0)
  };
}

function broadcastRooms() {
  const list = visibleRooms().map(roomSummary);
  for (const room of rooms.values()) broadcast(room, { t: 'rooms', rooms: list });
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server });

wss.on('connection', (conn) => {
  conn.name = '玩家';
  conn.room = null;
  conn.teamIdx = -1;
  conn.sideIdx = -1;

  conn.send(JSON.stringify({ t: 'welcome', rooms: visibleRooms().map(roomSummary) }));

  conn.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    handleMsg(conn, msg);
  });

  conn.on('close', () => { handleDisconnect(conn); });
});

function joinSide(conn, room, sideIdx) {
  const ti = sideToTeam(room, sideIdx), slot = sideToSlot(room, sideIdx);
  conn.room = room;
  conn.teamIdx = ti;
  conn.sideIdx = sideIdx;
  room.teams[ti][slot] = conn;
}

function makeAIConn(difficulty) {
  const label = AI_DIFFS[difficulty] || '简单';
  return {
    isAI: true,
    aiDifficulty: AI_DIFFS[difficulty] ? difficulty : 'easy',
    name: '🤖AI·' + label,
    room: null,
    teamIdx: -1,
    sideIdx: -1,
    readyState: 1,
    send() {},
    _gone: false
  };
}

function pickFactionFree(excludes) {
  const ids = Object.keys(FACTIONS).filter(f => !excludes.includes(f));
  return ids[Math.floor(Math.random() * ids.length)];
}

function handleMsg(conn, msg) {
  switch (msg.t) {
    case 'hello':
      conn.name = (msg.name || '').slice(0, 12) || '玩家';
      conn.send(JSON.stringify({ t: 'rooms', rooms: visibleRooms().map(roomSummary) }));
      break;

    case 'listRooms':
      conn.send(JSON.stringify({ t: 'rooms', rooms: visibleRooms().map(roomSummary) }));
      break;

    case 'createRoom': {
      if (conn.room) return;
      const mode = ['1v1', '2v2', '1v1v1'].includes(msg.mode) ? msg.mode : '1v1';
      const faction = FACTIONS[msg.faction] ? msg.faction : null;
      const teamCount = mode === '1v1v1' ? 3 : 2;
      const slotCount = mode === '2v2' ? 2 : 1;
      const room = {
        id: genRoomId(),
        name: (msg.name || '').slice(0, 10) || ('房间' + roomSeq),
        password: msg.password ? String(msg.password).slice(0, 8) : '',
        mode,
        teams: Array.from({ length: teamCount }, () => new Array(slotCount).fill(null)),
        factions: mode === '2v2' ? [faction, null, null, null] : new Array(teamCount).fill(null),
        game: null,
        state: 'lobby',
        owner: conn
      };
      room.factions[0] = faction;
      rooms.set(room.id, room);
      joinSide(conn, room, 0);
      addAIs(room, msg.aiAlly, msg.aiEnemy);
      conn.send(JSON.stringify({ t: 'joined', room: roomSummary(room), teamIdx: 0, sideIdx: 0, isOwner: true }));
      broadcast(room, { t: 'room', room: roomSummary(room) });
      broadcastRooms();
      break;
    }

    case 'joinRoom': {
      if (conn.room) return;
      const room = rooms.get(String(msg.roomId));
      if (!room) { conn.send(JSON.stringify({ t: 'error', msg: '房间不存在' })); return; }
      if (room.password && room.password !== String(msg.password || '')) {
        conn.send(JSON.stringify({ t: 'error', msg: '密码错误' })); return;
      }
      if (room.game && room.game.phase === 'playing') {
        conn.room = room; conn.teamIdx = -1; conn.sideIdx = -1;
        room.spectators = room.spectators || [];
        room.spectators.push(conn);
        conn.send(JSON.stringify({ t: 'joined', room: roomSummary(room), teamIdx: -1, sideIdx: -1, spectate: true, isOwner: false, state: engine.publicState(room.game, -1) }));
        return;
      }
      // 找一个空槽:优先顶替 AI 槽,再按队伍空槽平衡
      const needPer = room.mode === '2v2' ? 2 : 1;
      const total = room.mode === '2v2' ? 4 : (room.mode === '1v1v1' ? 3 : 2);
      let pick = -1;
      const aiSlots = [];
      const freeSlots = [];
      for (let si = 0; si < total; si++) {
        const c = sideConn(room, si);
        if (!c) freeSlots.push(si);
        else if (c.isAI) aiSlots.push(si);
      }
      if (freeSlots.length === 0 && aiSlots.length === 0) {
        conn.send(JSON.stringify({ t: 'error', msg: '房间已满' })); return;
      }
      if (aiSlots.length > 0) {
        // 顶替 AI:优先顶替"已有真人队友"的队的 AI 槽,其次平衡
        const teamCounts = [0, 1].map(ti => room.teams[ti].filter(c => !!c && !c.isAI).length);
        aiSlots.sort((a, b) => {
          const ta = sideToTeam(room, a), tb = sideToTeam(room, b);
          if ((teamCounts[ta] > 0) !== (teamCounts[tb] > 0)) return (teamCounts[ta] > 0) ? -1 : 1;
          return teamCounts[ta] - teamCounts[tb];
        });
        pick = aiSlots[0];
      } else {
        // 空槽:优先补"已有真人"的队;两队都有真人时空槽少的队优先(尽量同队)
        const freeCounts = [0, 1].map(ti => room.teams[ti].filter(c => !c).length);
        const humanCounts = [0, 1].map(ti => room.teams[ti].filter(c => !!c && !c.isAI).length);
        freeSlots.sort((a, b) => {
          const ta = sideToTeam(room, a), tb = sideToTeam(room, b);
          if ((humanCounts[ta] > 0) !== (humanCounts[tb] > 0)) return (humanCounts[ta] > 0) ? -1 : 1;
          return freeCounts[ta] - freeCounts[tb];
        });
        pick = freeSlots[0];
      }
      // 顶替 AI(如有)
      const cur = sideConn(room, pick);
      if (cur && cur.isAI) {
        room.teams[sideToTeam(room, pick)][sideToSlot(room, pick)] = null;
        cur.room = null; cur.teamIdx = -1; cur.sideIdx = -1;
      }
      joinSide(conn, room, pick);
      conn.send(JSON.stringify({ t: 'joined', room: roomSummary(room), teamIdx: sideToTeam(room, pick), sideIdx: pick, isOwner: false }));
      broadcast(room, { t: 'room', room: roomSummary(room) });
      broadcastRooms();
      break;
    }

    case 'setFaction': {
      const room = conn.room;
      if (!room || conn.sideIdx < 0 || room.state !== 'lobby') return;
      const f = msg.faction;
      if (!FACTIONS[f]) return;
      if (room.mode === '2v2') {
        // 四人各执一个阵营:已被他人选用的不可重复
        for (let si = 0; si < 4; si++) {
          if (si !== conn.sideIdx && room.factions[si] === f) {
            conn.send(JSON.stringify({ t: 'error', msg: '该阵营已被其他玩家选择' })); return;
          }
        }
        room.factions[conn.sideIdx] = f;
      } else if (room.mode === '1v1v1') {
        // 三方各执一个阵营:互斥
        for (let si = 0; si < 3; si++) {
          if (si !== conn.sideIdx && room.factions[si] === f) {
            conn.send(JSON.stringify({ t: 'error', msg: '该阵营已被其他玩家选择' })); return;
          }
        }
        room.factions[conn.sideIdx] = f;
      } else {
        room.factions[conn.teamIdx] = f;
      }
      broadcast(room, { t: 'room', room: roomSummary(room) });
      broadcastRooms();
      break;
    }

    case 'start': {
      const room = conn.room;
      if (!room) return;
      if (conn !== room.owner) { conn.send(JSON.stringify({ t: 'error', msg: '只有房主可以开始' })); return; }
      const need = room.mode === '2v2' ? 2 : 1;
      const total = room.mode === '2v2' ? 4 : (room.mode === '1v1v1' ? 3 : 2);
      const teamCount = room.teams.length;
      if (!Array.from({ length: teamCount }, (_, ti) => room.teams[ti].filter(c => !!c).length >= need).every(Boolean)) {
        conn.send(JSON.stringify({ t: 'error', msg: '人数不足' })); return;
      }
      if (!room.factions.slice(0, total).every(f => !!f)) {
        conn.send(JSON.stringify({ t: 'error', msg: '有玩家未选择阵营' })); return;
      }
      room.state = 'playing';
      room.game = engine.createGame(room);
      engine.startGame(room.game, room);
      broadcastState(room);
      broadcastRooms();
      maybeRunAI(room);
      break;
    }

    case 'playCard': {
      const room = conn.room;
      if (!room || conn.sideIdx < 0 || !room.game) return;
      if (room.game.phase !== 'playing') return;
      const res = engine.playCard(room.game, conn.sideIdx, msg.handIdx, {
        subCount: msg.subCount,
        target: msg.target,
        discardIdx: msg.discardIdx,
        targetHand: msg.targetHand
      });
      if (!res.ok) { conn.send(JSON.stringify({ t: 'error', msg: res.msg })); }
      broadcastState(room);
      maybeRunAI(room);
      break;
    }

    case 'endTurn': {
      const room = conn.room;
      if (!room || conn.sideIdx < 0 || !room.game) return;
      if (room.game.phase !== 'playing') return;
      if (room.game.turn !== conn.sideIdx) return;
      engine.endTurn(room.game);
      broadcastState(room);
      maybeRunAI(room);
      break;
    }

    /* 2v2:切换当前攻击目标敌方(该回合内持久) */
    case 'attackTarget': {
      const room = conn.room;
      if (!room || conn.sideIdx < 0 || !room.game) return;
      if (room.game.phase !== 'playing') return;
      const side = room.game.sides[conn.sideIdx];
      const t = room.game.sides[msg.idx];
      if (side && t && t.team !== side.team && side.team !== undefined) {
        side.attackTarget = msg.idx;
        broadcastState(room);
      }
      break;
    }

    case 'chat': {
      const room = conn.room;
      if (!room) return;
      const text = String(msg.text || '').slice(0, 100);
      if (!text.trim()) return;
      const teamTag = conn.teamIdx >= 0 ? (room.mode === '2v2' ? ('[队' + (conn.teamIdx + 1) + ']') : '') : '[观战]';
      broadcast(room, { t: 'chat', who: conn.name + teamTag, text: text.trim() });
      break;
    }

    case 'leave': {
      handleDisconnect(conn);
      break;
    }
  }
}

/* ---------------- 电脑 AI ---------------- */

/* 建房时按配置补 AI */
function addAIs(room, aiAlly, aiEnemy) {
  const mk = (diff) => makeAIConn(diff);
  if (room.mode === '1v1') {
    if (aiEnemy && AI_DIFFS[aiEnemy]) {
      room.factions[1] = pickFactionFree([room.factions[0]]);
      joinSide(mk(aiEnemy), room, 1);
    }
  } else if (room.mode === '1v1v1') {
    // 三方混战:AI 补位其余两方
    if (aiEnemy && AI_DIFFS[aiEnemy]) {
      let used = room.factions.filter(Boolean);
      room.factions[1] = pickFactionFree(used);
      joinSide(mk(aiEnemy), room, 1);
      room.factions[2] = pickFactionFree(room.factions.filter(Boolean));
      joinSide(mk(aiEnemy), room, 2);
    }
  } else {
    // 2v2:队0队友(side1) + 队1对手(side2, side3)
    if (aiAlly && AI_DIFFS[aiAlly]) {
      room.factions[1] = pickFactionFree([room.factions[0], room.factions[2], room.factions[3]].filter(Boolean));
      joinSide(mk(aiAlly), room, 1);
    }
    if (aiEnemy && AI_DIFFS[aiEnemy]) {
      const used = room.factions.filter(Boolean);
      room.factions[2] = pickFactionFree(used);
      joinSide(mk(aiEnemy), room, 2);
      room.factions[3] = pickFactionFree(room.factions.filter(Boolean));
      joinSide(mk(aiEnemy), room, 3);
    }
  }
}

function isAITurn(room) {
  const game = room.game;
  if (!game || game.phase !== 'playing') return false;
  const c = sideConn(room, game.turn);
  return !!c && !!c.isAI;
}

function maybeRunAI(room) {
  if (!isAITurn(room)) return;
  if (room.aiPending) return;
  room.aiPending = true;
  setTimeout(() => { room.aiPending = false; aiTakeTurn(room); }, 900);
}

function aiTakeTurn(room) {
  const game = room.game;
  if (!game || game.phase !== 'playing') return;
  if (!isAITurn(room)) return;
  const ti = game.turn;
  const c = sideConn(room, ti);
  const diff = c.aiDifficulty;
  const decision = ai.aiDecide(game, ti, diff);
  if (decision.action === 'play') {
    const res = engine.playCard(game, ti, decision.handIdx, { subCount: decision.subCount });
    broadcastState(room);
    if (res.ok) {
      room.aiPending = true;
      setTimeout(() => { room.aiPending = false; aiTakeTurn(room); }, 750);
    } else {
      engine.endTurn(game);
      broadcastState(room);
      afterAITurn(room);
    }
  } else {
    engine.endTurn(game);
    broadcastState(room);
    afterAITurn(room);
  }
}

function afterAITurn(room) {
  if (!isAITurn(room)) return;
  room.aiPending = true;
  setTimeout(() => { room.aiPending = false; aiTakeTurn(room); }, 1200);
}

function handleDisconnect(conn) {
  const room = conn.room;
  if (!room) return;
  // 从队伍槽位移除
  let removed = false;
  for (let ti = 0; ti < room.teams.length; ti++) {
    for (let slot = 0; slot < (room.teams[ti] || []).length; slot++) {
      if (room.teams[ti][slot] === conn) {
        room.teams[ti][slot] = null;
        removed = true;
        break;
      }
    }
  }
  if (removed) {
    const teamEmpty = room.teams.some(t => t.every(c => !c));
    if (room.state === 'playing' && room.game && room.game.phase === 'playing') {
      if (room.mode === '1v1v1') {
        // 三方混战:该方断线由 AI 托管(保持三方)
        for (let si = 0; si < (room.game.sides || []).length; si++) {
          if (sideConn(room, si) === null) {
            joinSide(makeAIConn('easy'), room, si);
          }
        }
      } else if (teamEmpty) {
        // 整队无人:判负(取第一个空队)
        const ti = room.teams.findIndex(t => t.every(c => !c));
        room.game.phase = 'ended';
        room.game.winner = ti === 0 ? 1 : 0;
        broadcastState(room);
      } else {
        // 该 side 由 AI 自动托管(保持 4 sides 完整)
        for (let si = 0; si < (room.game.sides || []).length; si++) {
          if (sideConn(room, si) === null) {
            const a = makeAIConn('easy');
            joinSide(a, room, si);
          }
        }
      }
    } else if (room.state === 'lobby') {
      if (conn.sideIdx >= 0 && room.factions[conn.sideIdx]) room.factions[conn.sideIdx] = null;
    }
  }
  if (room.spectators) {
    const si = room.spectators.indexOf(conn);
    if (si >= 0) room.spectators.splice(si, 1);
  }
  if (room.teams.every(t => t.every(c => !c)) && (!room.spectators || room.spectators.length === 0)) {
    rooms.delete(room.id);
  } else {
    broadcast(room, { t: 'room', room: roomSummary(room) });
  }
  broadcastRooms();
  if (room.state === 'playing' && room.game) maybeRunAI(room);
  conn.room = null;
  conn.teamIdx = -1;
  conn.sideIdx = -1;
}

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  卡牌对决 服务器已启动(1v1 / 2v2 四人独立 / 1v1v1 三方混战)');
  console.log('  本机访问: http://localhost:' + PORT);
  const net = require('os').networkInterfaces();
  for (const name of Object.keys(net)) {
    for (const ni of net[name]) {
      if (ni.family === 'IPv4' && !ni.internal) {
        console.log('  局域网访问: http://' + ni.address + ':' + PORT);
      }
    }
  }
  console.log('==============================================');
});
