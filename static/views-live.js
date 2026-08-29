/* 视图：实时监控 —— SSE 推流，调用逐条落到 feed */
(function (w, D) {
  'use strict';
  var FV = w.FV, S = FV.state, esc = FV.esc, num = FV.num, ms = FV.ms;

  var MAX_FEED = 60;
  S.feed = [];
  S.rate = [];           // 每 2 秒一格的调用速率，用于滚动曲线
  S.streamOn = false;
  if (S.feedProxyOnly === undefined) S.feedProxyOnly = true;
  var es = null, seen = {};
  S.liveCount = 0;

  /* ---------------------------------------------------------- 连接 */
  function connect() {
    if (es) return;
    if (/[?&]nostream=1/.test(w.location.search)) return pollFallback();
    try {
      es = new EventSource('/api/stream');
    } catch (e) {
      FV.toast('浏览器不支持 SSE，已退回轮询', 'bad');
      return pollFallback();
    }

    es.addEventListener('hello', function (m) {
      var d = JSON.parse(m.data);
      S.liveStats = d.stats;
      S.feed = (d.backlog || []).map(function (e) {
        e._old = true; return e;
      }).slice(0, MAX_FEED);
      setOn(true);
      if (S.page === 'live') paint();
    });

    es.addEventListener('calls', function (m) {
      var d = JSON.parse(m.data);
      var fresh = 0;
      (d.events || []).forEach(function (e) {
        var k = e.source + ':' + e.cursor_id;
        if (seen[k]) return;
        seen[k] = 1;
        e._t = Date.now();
        S.feed.unshift(e);   // events 为升序，逐条 unshift 后最新自然在顶部
        S.liveCount++;
        fresh++;
      });
      if (S.feed.length > MAX_FEED) S.feed.length = MAX_FEED;
      bumpRate(fresh);
      if (S.page === 'live') paint();
    });

    es.addEventListener('stats', function (m) {
      S.liveStats = JSON.parse(m.data);
      if (S.page === 'live') paintMetrics();
    });

    es.addEventListener('services', function (m) {
      var d = JSON.parse(m.data);
      S.data.services = d.services || S.data.services;
      if (S.page === 'live') paintServices();
    });

    es.onerror = function () {
      setOn(false);
      if (S.page === 'live') paintStatus();
    };
    es.onopen = function () { setOn(true); };
  }

  function disconnect() {
    if (es) { es.close(); es = null; }
    setOn(false);
  }

  function setOn(v) {
    if (S.streamOn === v) return;
    S.streamOn = v;
    FV.renderNav();
    paintStatus();
  }

  /* 无 SSE 时的轮询兜底 */
  var pollTimer = null;
  function pollFallback() {
    if (pollTimer) return;
    var cur = { cpa: 0, ccs: 0 };
    pollTimer = setInterval(function () {
      FV.get('/api/live?cpa=' + cur.cpa + '&ccs=' + cur.ccs).then(function (d) {
        cur = d.cursor;
        S.liveStats = d.stats;
        if (d.first && (d.backlog || []).length && !S.feed.length) {
          S.feed = d.backlog.map(function (e) { e._old = true; return e; })
                            .slice(0, MAX_FEED);
        }
        var fresh = 0;
        (d.events || []).forEach(function (e) {
          e._t = Date.now(); S.feed.unshift(e); S.liveCount++; fresh++;
        });
        if (S.feed.length > MAX_FEED) S.feed.length = MAX_FEED;
        bumpRate(fresh);
        setOn(true);
        if (S.page === 'live') paint();
      });
    }, 2500);
  }

  function bumpRate(n) {
    S.rate.push(n);
    if (S.rate.length > 90) S.rate.shift();
  }

  /* ---------------------------------------------------------- 渲染 */
  FV.views.live = function (root) {
    connect();
    root.innerHTML = FV.head('实时监控',
      '经 SSE 长连接推送，新调用落库后 2 秒内出现在下方', null,
      '<span class="chip" id="liveState"><span class="live-dot"></span><span id="liveStateTxt">连接中</span></span>' +
      '<button class="chip" id="liveClear">清空</button>' +
      '<button class="btn-dark" id="liveToggle"><svg><use href="#i-pause"/></svg>暂停</button>') +

      '<div class="bento">' +

        // 左列两张卡放进一个 stack，避免跨行卡撑开行轨、在中间留出空档
        '<div class="c5 stack stretch">' +

        '<div class="card accent pad-lg">' +
          '<div class="card-h"><h3>实时吞吐</h3>' +
            '<div class="r"><span class="tiny faint mono" id="liveClock"></span></div></div>' +
          '<div class="gauge-wrap">' +
            '<div class="gauge"><canvas id="cvGauge"></canvas>' +
              '<div class="g-txt"><span class="g-v" id="gV">—</span><span class="g-k">次 / 分钟</span></div></div>' +
            '<div style="flex:1;display:flex;flex-direction:column;gap:var(--gap-sm);min-width:0" id="liveMetrics"></div>' +
          '</div>' +
          '<div style="flex:1"></div>' +
          '<div class="divider"></div>' +
          '<div class="tiny muted" style="margin-bottom:7px">最近 3 分钟到达节奏（每格 2 秒）</div>' +
          '<canvas id="cvRate" style="height:48px"></canvas>' +
        '</div>' +

        // 服务在线：留在 stack 内，用 flex:1 吃掉剩余高度
        '<div class="card grow-card">' +
          '<div class="card-h"><h3>服务在线</h3>' +
            '<div class="r"><span class="tiny faint mono" id="svcAt"></span></div></div>' +
          '<div id="liveSvc" class="rows"></div>' +
        '</div>' +

        '</div>' +   // /stack

        // 右列：实时调用流，与左列 stack 等高
        '<div class="card c7 stretch">' +
          '<div class="card-h"><h3>实时调用流</h3>' +
            '<span class="sub" id="feedStat">最新 ' + MAX_FEED + ' 条</span>' +
            '<div class="r">' +
              '<button class="chip' + (S.feedProxyOnly ? ' on' : '') + '" id="feedProxy" style="padding:6px 12px;font-size:11.5px">' +
                (S.feedProxyOnly ? '显示全部' : '只看代理请求') + '</button>' +
            '</div></div>' +
          '<div class="feed-head">' +
            '<span>时间</span><span>来源</span><span>模型</span>' +
            '<span>调用方 / 渠道</span><span style="text-align:right">首词</span>' +
            '<span style="text-align:right">总耗时</span><span style="text-align:center">结果</span>' +
          '</div>' +
          '<div class="feed" id="feed" style="max-height:600px"></div>' +
        '</div>' +

      '</div>';

    D.getElementById('liveClear').onclick = function () {
      S.feed = []; S.rate = []; S.liveCount = 0; paint();
    };
    D.getElementById('feedProxy').onclick = function () {
      S.feedProxyOnly = !S.feedProxyOnly;
      this.textContent = S.feedProxyOnly ? '显示全部' : '只看代理请求';
      this.className = 'chip' + (S.feedProxyOnly ? ' on' : '');
      this.style.padding = '6px 12px'; this.style.fontSize = '11.5px';
      paintFeed();
    };
    D.getElementById('liveToggle').onclick = function () {
      if (es || pollTimer) {
        disconnect();
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        this.innerHTML = '<svg><use href="#i-play"/></svg>继续';
        FV.toast('已暂停实时推流');
      } else {
        connect();
        this.innerHTML = '<svg><use href="#i-pause"/></svg>暂停';
        FV.toast('已恢复实时推流', 'good');
      }
    };

    paint();
  };

  function paint() {
    if (S.page !== 'live') return;
    paintStatus();
    paintMetrics();
    paintServices();
    paintFeed();
  }

  function paintStatus() {
    var t = D.getElementById('liveStateTxt');
    if (!t) return;
    var dot = D.getElementById('liveState').querySelector('.live-dot');
    if (S.streamOn) { t.textContent = '实时连接中'; dot.className = 'live-dot'; }
    else { t.textContent = '已断开'; dot.className = 'live-dot off'; }
  }

  function paintMetrics() {
    var st = S.liveStats;
    if (!st || !D.getElementById('liveMetrics')) return;
    var c = D.getElementById('liveClock');
    if (c) c.textContent = FV.clock(st.at);

    D.getElementById('gV').textContent = st.m1.per_min;
    var cap = Math.max(20, st.m15.per_min * 2.2);
    w.FVChart.gauge(D.getElementById('cvGauge'), st.m1.per_min, cap);

    D.getElementById('liveMetrics').innerHTML =
      '<div style="display:flex;gap:var(--gap-sm)">' +
        metric('近 1 分钟', st.m1.calls, '次', st.m1.failed) +
        metric('近 5 分钟', st.m5.calls, '次', st.m5.failed) +
        metric('近 15 分钟', st.m15.calls, '次', st.m15.failed) +
      '</div>' +
      '<div style="display:flex;gap:var(--gap-sm)">' +
        '<div class="pill-metric"><span class="k">实时首词</span><span class="v">' +
          (st.m5.ttft ? (st.m5.ttft / 1000).toFixed(2) + '<small>秒</small>' : '—') + '</span></div>' +
        '<div class="pill-metric"><span class="k">15 分钟 token</span><span class="v">' +
          num(st.m15.tokens) + '</span></div>' +
      '</div>';

    w.FVChart.bars(D.getElementById('cvRate'), S.rate, 54);
  }

  function metric(k, v, unit, fail) {
    return '<div class="pill-metric"><span class="k">' + k + '</span>' +
      '<span class="v">' + v + '<small>' + unit + '</small>' +
      (fail ? ' <small style="color:var(--red)">' + fail + ' 失败</small>' : '') +
      '</span></div>';
  }

  function paintServices() {
    var box = D.getElementById('liveSvc');
    if (!box) return;
    var svcs = (S.data.services || []).filter(function (s) { return s.featured || s.state !== 'up'; });
    var at = D.getElementById('svcAt');
    if (at) at.textContent = FV.clock(S.data.overview && S.data.overview.at);
    box.innerHTML = svcs.length ? svcs.map(function (s) {
      return '<div class="row-item' + (s.state === 'down' ? ' fail' : '') +
        '" style="grid-template-columns:auto minmax(0,1fr) auto;padding:9px 13px">' +
        '<span class="status-tag ' + s.state + '"><span class="d"></span></span>' +
        '<span class="ellip tiny" style="font-weight:650">' + esc(s.name) + '</span>' +
        '<span class="tiny ' + (s.state === 'up' ? 'muted' : '') + '" style="' +
          (s.state === 'up' ? '' : 'color:var(--red)') + '">' +
          (s.state === 'up' ? (s.latency_ms != null ? Math.round(s.latency_ms) + 'ms' : '在线')
                            : FV.stateLabel[s.state]) + '</span>' +
      '</div>';
    }).join('') : '<div class="empty" style="padding:20px">全部正常</div>';
  }

  function paintFeed() {
    var box = D.getElementById('feed');
    if (!box) return;
    var list = S.feedProxyOnly
      ? S.feed.filter(function (e) { return e.kind !== 'session'; })
      : S.feed;

    // 头部先说清连接状态：连着但没新调用 ≠ 坏了
    var st = D.getElementById('feedStat');
    if (st) {
      if (!S.streamOn)
        st.innerHTML = '<span style="color:var(--red)">● 连接已断开</span>';
      else if (S.liveCount)
        st.innerHTML = '<b style="color:var(--green)">● 实时监听中 · 已收到 ' + S.liveCount + ' 条</b>';
      else
        st.innerHTML = '<span style="color:var(--green)">● 实时监听中</span>' +
                       '<span class="tiny muted"> · 暂无新调用，下方为最近记录</span>';
    }

    if (!list.length) {
      box.innerHTML = '<div class="empty">' +
        (S.feedProxyOnly ? '暂无代理请求记录<br><span class="tiny">会话回写 / Codex 记录已隐藏，点右上「显示全部」可看</span>'
                         : '暂无调用记录<br><span class="tiny">本机发生模型请求时会自动出现在这里</span>') +
        '</div>';
      return;
    }

    var now = Date.now();
    var divided = false;
    box.innerHTML = list.map(function (e) {
      var sep = '';
      if (e._old && !divided) {
        divided = true;
        sep = '<div class="feed-sep"><span>以下为接入前的最近记录</span></div>';
      }
      return sep + row(e, now);
    }).join('');
  }

  function row(e, now) {
    return (function (e) {
      var fresh = !e._old && e._t && (now - e._t) < 6000;
      var old = !!e._old;
      var sess = e.kind === 'session';
      return '<div class="feed-row' + (e.failed ? ' fail' : '') + (fresh ? ' fresh' : '') + (old ? ' old' : '') + '">' +
        '<span class="tiny faint mono">' + w.FVChart.hhmm(e.ts) + '</span>' +
        '<span class="tag ' + (e.source === 'CPA' ? 'cpa' : 'ccs') + '">' +
          (e.source === 'CPA' ? 'CPA' : 'CCS') + '</span>' +
        '<div style="min-width:0">' +
          '<div class="ellip" style="font-weight:700;font-size:12.5px">' + esc(e.model || '—') + '</div>' +
          (e.error ? '<div class="ellip tiny" style="color:var(--red)">' + esc(e.error) + '</div>'
                   : '<div class="ellip tiny faint">' + esc(e.provider || '') + '</div>') +
        '</div>' +
        '<div style="min-width:0">' +
          '<div class="ellip tiny" style="font-weight:650">' + esc(e.channel || '—') + '</div>' +
          '<div class="ellip tiny ' + (sess ? 'faint' : 'muted') + '">' + esc(e.channel_key || '') + '</div>' +
        '</div>' +
        '<span class="tnum tiny" style="text-align:right' + (e.ttft ? ';color:var(--ink)' : '') + '"' +
          (e.ttft ? '' : ' title="' + (sess ? '会话回写 / Codex 会话记录由日志同步而来，不经过代理，库中无计时' : (e.failed ? '请求失败，首个内容片段从未到达' : '非流式请求，没有首词概念')) + '"') + '>' +
          (e.ttft ? '⚡' + ms(e.ttft) : '<span class="faint">无计时</span>') + '</span>' +
        '<span class="tnum tiny muted" style="text-align:right">' +
          (e.latency ? ms(e.latency) : '<span class="faint">—</span>') + '</span>' +
        (e.failed ? '<span class="tag bad" style="text-align:center">' + (e.status || 'ERR') + '</span>'
                  : '<span class="tag ok" style="text-align:center">' + num(e.tokens || 0) + 'tk</span>') +
      '</div>';
    })(e);
  }
})(window, document);
