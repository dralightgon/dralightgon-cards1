/* =========================================================
 * 卡牌对决 - WebSocket 客户端封装(含断线自动重连)
 * ========================================================= */
(function (global) {
  'use strict';
  const handlers = {};
  let sock = null;
  let queue = [];
  let retryTimer = null;
  let pageUnloading = false;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return new Promise((resolve, reject) => {
      sock = new WebSocket(proto + '://' + location.host);
      sock.onopen = () => {
        clearTimeout(retryTimer);
        for (const m of queue) sock.send(JSON.stringify(m));
        queue = [];
        setStatus('ok');
        resolve();
      };
      sock.onerror = () => { /* onclose 会兜底 */ };
      sock.onclose = () => {
        setStatus('off');
        if (pageUnloading) return;
        // 2 秒后自动重连
        retryTimer = setTimeout(() => {
          connect().then(() => {
            if (global.onNetReconnect) global.onNetReconnect();
          }).catch(() => {});
        }, 2000);
      };
      sock.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const h = handlers[msg.t];
        if (h) h(msg);
        if (global.onNetMessage) global.onNetMessage(msg);
      };
    });
  }

  function send(obj) {
    if (sock && sock.readyState === 1) sock.send(JSON.stringify(obj));
    else queue.push(obj);
  }

  function on(type, fn) { handlers[type] = fn; }
  function setStatus(s) { if (global.onConnStatus) global.onConnStatus(s); }

  global.Net = { connect, send, on, setStatus };
  global.addEventListener('beforeunload', () => { pageUnloading = true; });
})(window);
