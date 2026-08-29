/* FleetView 核心 —— 状态、路由、顶栏、总览、服务矩阵 */
(function (w, D) {
  'use strict';

  var FV = w.FV = { views: {}, state: { page: 'overview', range: '24h', data: {}, busy: {} } };
  var S = FV.state;

  /* ---------------------------------------------------------- 工具 */
  function el(id) { return D.getElementById(id); }
  function h(html) { var t = D.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  FV.el = el; FV.h = h; FV.esc = esc;

  function num(n) {
    if (n == null) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function ms(v) {
    if (v == null) return '—';
    return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + 's' : Math.round(v) + 'ms';
  }
  function ago(ts) {
    if (!ts) return '—';
    var d = Math.floor(Date.now() / 1000) - ts;
    if (d < 60) return d + ' 秒前';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    return Math.floor(d / 86400) + ' 天前';
  }
  function clock(ts) {
    var d = new Date((ts || Date.now() / 1000) * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  }
  FV.num = num; FV.ms = ms; FV.ago = ago; FV.clock = clock;

  /* ---------------------------------------------------------- 网络 */
  function get(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }
  FV.get = get; FV.post = post;

  /* ---------------------------------------------------------- 提示 */
  var toastTimer;
  function toast(msg, kind) {
    var t = el('toast');
    t.textContent = msg;
    t.className = 'toast on' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  FV.toast = toast;

  w.FVtip = {
    show: function (x, y, text) {
      var t = el('tip');
      t.textContent = text;
      t.className = 'tooltip on';
      var r = t.getBoundingClientRect();
      t.style.left = Math.min(w.innerWidth - r.width - 12, Math.max(8, x + 14)) + 'px';
      t.style.top = Math.max(8, y - r.height - 12) + 'px';
    },
    hide: function () { el('tip').className = 'tooltip'; }
  };

  function sheet(html) {
    el('sheet').innerHTML = html;
    el('sheetBg').className = 'sheet-bg on';
  }
  function closeSheet() { el('sheetBg').className = 'sheet-bg'; }
  FV.sheet = sheet; FV.closeSheet = closeSheet;
  el('sheetBg').addEventListener('click', function (e) { if (e.target === el('sheetBg')) closeSheet(); });
  D.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  /* ---------------------------------------------------------- 导航 */
  var PAGES = [
    { id: 'overview', label: '总览', icon: 'i-grid' },
    { id: 'live', label: '实时监控', icon: 'i-pulse', live: true },
    { sep: '运行' },
    { id: 'services', label: '服务矩阵', icon: 'i-server' },
    { id: 'agents', label: 'Hermes 智能体', icon: 'i-flame' },
    { sep: '调用' },
    { id: 'calls', label: '调用分析', icon: 'i-chart' },
    { id: 'ttft', label: '首词延迟', icon: 'i-zap' },
    { id: 'tokens', label: 'Token 消耗', icon: 'i-cube' },
    { sep: '健康' },
    { id: 'accounts', label: '账号池', icon: 'i-key' },
    { id: 'errors', label: '错误告警', icon: 'i-alert' },
    { id: 'logs', label: '调用日志', icon: 'i-list' },
    { sep: '' },
    { id: 'settings', label: '设置', icon: 'i-sliders' }
  ];
  FV.pages = PAGES;

  function renderNav() {
    el('nav').innerHTML = PAGES.map(function (p) {
      if (p.sep !== undefined) return '<div class="nav-sep"></div>';
      var badge = (p.id === 'errors' && S.alertCount) ? '<span class="nav-dot"></span>' : '';
      var pulse = (p.live && S.streamOn) ? '<span class="nav-live"></span>' : '';
      return '<button class="nav-btn' + (S.page === p.id ? ' on' : '') + '" data-page="' + p.id + '">' +
        '<svg><use href="#' + p.icon + '"/></svg>' + badge + pulse +
        '<span class="tip">' + p.label + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(el('nav').querySelectorAll('[data-page]'), function (b) {
      b.onclick = function () { go(b.dataset.page); };
    });
  }
  FV.renderNav = renderNav;

  function go(page) {
    S.page = page;
    if (w.location.hash.slice(1) !== page) w.location.hash = page;
    renderNav();
    render();
  }
  FV.go = go;

  w.addEventListener('hashchange', function () {
    var p = w.location.hash.slice(1);
    if (p && p !== S.page && FV.views[p]) go(p);
  });

  /* ---------------------------------------------------------- 区间选择 */
  var RANGES = [['1h', '1 小时'], ['6h', '6 小时'], ['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天']];

  FV.rangeSeg = function () {
    return '<div class="seg" id="rangeSeg">' + RANGES.map(function (r) {
      return '<button data-r="' + r[0] + '"' + (S.range === r[0] ? ' class="on"' : '') + '>' + r[1] + '</button>';
    }).join('') + '</div>';
  };

  FV.bindRange = function () {
    var seg = el('rangeSeg');
    if (!seg) return;
    Array.prototype.forEach.call(seg.children, function (b) {
      b.onclick = function () {
        S.range = b.dataset.r;
        el('podRangeLabel').textContent = b.dataset.r.toUpperCase();
        refreshData().then(render);
      };
    });
  };

  /* ---------------------------------------------------------- 顶栏 */
  function paintTop() {
    var ov = S.data.overview;
    if (!ov) return;
    var s = ov.services || {};
    el('podServices').innerHTML = (s.up || 0) + '<small>/ ' + (s.total || 0) + '</small>';
    el('podCalls').innerHTML = num(ov.calls) + '<small>次 · ' + (ov.success_rate) + '%</small>';
    el('podTtft').innerHTML = ov.ttft && ov.ttft.p50 != null
      ? (ov.ttft.p50 / 1000).toFixed(2) + '<small>s</small>'
      : '—';
    el('lastCheck').textContent = clock(ov.at);

    var bad = (s.down || 0), warn = (s.warn || 0);
    var ring = el('healthRing'), txt = el('healthText');
    if (bad) { ring.className = 'ring bad'; txt.textContent = bad + ' 项离线'; }
    else if (warn) { ring.className = 'ring warn'; txt.textContent = warn + ' 项异常'; }
    else { ring.className = 'ring'; txt.textContent = '全部正常'; }
  }
  FV.paintTop = paintTop;

  /* ---------------------------------------------------------- 数据 */
  function refreshData() {
    var r = S.range;
    return Promise.all([
      get('/api/overview?range=' + r),
      get('/api/services'),
      get('/api/timeseries?range=' + r)
    ]).then(function (res) {
      S.data.overview = res[0];
      S.data.services = res[1].services || [];
      S.data.paused = res[1].paused || [];
      S.data.series = res[2];
      paintTop();
    }).catch(function (e) { toast('数据获取失败: ' + e.message, 'bad'); });
  }
  FV.refreshData = refreshData;

  function render() {
    var fn = FV.views[S.page];
    if (fn) fn(el('view'));
  }
  FV.render = render;

  /* ---------------------------------------------------------- 服务卡片 */
  var STATE_LABEL = { up: '运行中', warn: '异常', down: '已停止', paused: '已暂停' };
  FV.stateLabel = STATE_LABEL;

  var ICON_BY_GROUP = {
    '网关': 'i-server', '号池': 'i-key', '智能体': 'i-flame',
    '管理平台': 'i-grid', 'CLI': 'i-term', '存储': 'i-db',
    '网络': 'i-wifi', '其他': 'i-cpu'
  };
  FV.groupIcon = function (g) { return ICON_BY_GROUP[g] || 'i-cpu'; };

  FV.serviceCard = function (s) {
    var st = s.state || 'down';
    var pid = s.pids && s.pids.length ? s.pids[0] : null;
    var portTxt = s.port ? String(s.port)
      : (s.dynamic_ports && s.dynamic_ports.length ? s.dynamic_ports.join(',') : '进程型');
    var ctrl = s.controllable;
    var busy = S.busy[s.id];

    return '<div class="svc' + (st === 'down' ? ' is-down' : '') + (st === 'paused' ? ' is-paused' : '') + '" data-id="' + s.id + '">' +
      '<div class="svc-top">' +
        '<div class="svc-ic"><svg><use href="#' + FV.groupIcon(s.group) + '"/></svg></div>' +
        '<div style="min-width:0">' +
          '<div class="svc-name ellip">' + esc(s.name) + '</div>' +
          '<div class="svc-desc">' + esc(s.desc || '') + '</div>' +
        '</div>' +
        '<span class="svc-grp">' + esc(s.group || '') + '</span>' +
      '</div>' +
      '<div class="status-tag ' + st + '"><span class="d"></span>' + (STATE_LABEL[st] || st) + '</div>' +
      '<div class="svc-body">' +
        '<div><div class="k">端口</div><div class="v' + (s.port ? '' : ' off') + '">' + portTxt + '</div></div>' +
        '<div><div class="k">PID</div><div class="v' + (pid ? '' : ' off') + '">' + (pid || '—') +
          (s.proc_count > 1 ? '<span class="faint tiny"> ×' + s.proc_count + '</span>' : '') + '</div></div>' +
        '<div><div class="k">响应</div><div class="v' + (s.latency_ms ? '' : ' off') + '">' +
          (s.latency_ms != null ? Math.round(s.latency_ms) + 'ms' : '—') + '</div></div>' +
      '</div>' +
      '<canvas class="spark" data-spark="' + s.id + '"></canvas>' +
      '<div class="svc-foot">' +
        (s.note ? '<span class="note">' + esc(s.note) + '</span>'
                : '<span class="tiny muted">24h 在线 ' + (s.uptime_24h != null ? s.uptime_24h + '%' : '采集中') + '</span>') +
        '<div class="svc-actions">' +
          (ctrl && st !== 'up'
            ? '<button class="mini-btn go" data-act="start" data-id="' + s.id + '" title="启动"' + (busy ? ' disabled' : '') + '><svg><use href="#i-play"/></svg></button>' : '') +
          (ctrl && (st === 'up' || st === 'warn')
            ? '<button class="mini-btn danger" data-act="stop" data-id="' + s.id + '" title="停止"' + (busy ? ' disabled' : '') + '><svg><use href="#i-stop"/></svg></button>' : '') +
          (ctrl
            ? '<button class="mini-btn" data-act="restart" data-id="' + s.id + '" title="重启"' + (busy ? ' disabled' : '') + '><svg><use href="#i-refresh"/></svg></button>' : '') +
          '<button class="mini-btn" data-act="' + (st === 'paused' ? 'resume' : 'pause') + '" data-id="' + s.id + '" title="' + (st === 'paused' ? '恢复监控' : '暂停监控') + '">' +
            '<svg><use href="#' + (st === 'paused' ? 'i-play' : 'i-pause') + '"/></svg></button>' +
        '</div>' +
      '</div>' +
    '</div>';
  };

  FV.bindServiceActions = function (root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-act]'), function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var id = b.dataset.id, act = b.dataset.act;
        var svc = (S.data.services || []).filter(function (x) { return x.id === id; })[0] || {};
        if (act === 'stop' || act === 'restart') {
          if (!confirm('确认' + (act === 'stop' ? '停止' : '重启') + '「' + svc.name + '」？\n将向其进程发送 SIGTERM。')) return;
        }
        S.busy[id] = true;
        b.disabled = true;
        toast('正在' + ({ start: '启动', stop: '停止', restart: '重启', pause: '暂停监控', resume: '恢复监控' }[act]) + ' ' + svc.name + '…');
        post('/api/control', { id: id, action: act }).then(function (r) {
          S.busy[id] = false;
          toast(r.msg || (r.ok ? '完成' : '失败'), r.ok ? 'good' : 'bad');
          if (r.services) { S.data.services = r.services; }
          return refreshData();
        }).then(render).catch(function (err) {
          S.busy[id] = false;
          toast('操作失败: ' + err.message, 'bad');
        });
      };
    });
  };

  FV.paintSparks = function (root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-spark]'), function (cv) {
      var id = cv.dataset.spark;
      get('/api/history?id=' + encodeURIComponent(id)).then(function (hst) {
        var vals = (hst.points || []).map(function (p) { return p.latency !== null ? p.latency : (p.uptime === null ? null : p.uptime); });
        var any = vals.some(function (v) { return v !== null; });
        var svc = (S.data.services || []).filter(function (x) { return x.id === id; })[0] || {};
        var color = svc.state === 'down' ? '#f5333f' : (svc.state === 'warn' ? '#ff9500' : '#22b04b');
        w.FVChart.spark(cv, any ? vals : [], color);
      }).catch(function () {});
    });
  };

  /* ---------------------------------------------------------- 主题 */
  function applyTheme(t) {
    S.theme = t;
    if (t === 'dark') D.documentElement.setAttribute('data-theme', 'dark');
    else D.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('fv-theme', t); } catch (e) {}
    // canvas 图表不吃 CSS 变量，得整页重绘
    if (S.data.overview) render();
  }
  FV.applyTheme = applyTheme;

  (function initTheme() {
    var saved = null;
    var forced = (w.location.search.match(/[?&]theme=(light|dark)/) || [])[1];
    if (forced) {
      S.theme = forced;
      if (forced === 'dark') D.documentElement.setAttribute('data-theme', 'dark');
      return;
    }
    try { saved = localStorage.getItem('fv-theme'); } catch (e) {}
    if (!saved) {
      saved = (w.matchMedia && w.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark' : 'light';
    }
    S.theme = saved;
    if (saved === 'dark') D.documentElement.setAttribute('data-theme', 'dark');
  })();

  el('themeBtn').onclick = function () {
    applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  };

  if (w.matchMedia) {
    w.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      var saved = null;
      try { saved = localStorage.getItem('fv-theme'); } catch (err) {}
      if (!saved) applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  /* ---------------------------------------------------------- 启动 */
  FV.refreshAll = function () {
    toast('正在重新探测所有服务…');
    return post('/api/refresh').then(function () { return refreshData(); }).then(function () {
      render(); toast('已刷新', 'good');
    });
  };

  FV.boot = function () {
    var hp = w.location.hash.slice(1);
    if (hp && FV.views[hp]) S.page = hp;
    renderNav();
    refreshData().then(render);
    setInterval(function () {
      refreshData().then(function () { if (S.page !== 'settings') render(); });
    }, 30000);
    w.addEventListener('resize', function () {
      clearTimeout(w.__rz); w.__rz = setTimeout(render, 220);
    });
  };
})(window, document);
