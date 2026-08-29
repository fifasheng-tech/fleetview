/* 视图：总览 / 服务矩阵 */
(function (w, D) {
  'use strict';
  var FV = w.FV, S = FV.state, esc = FV.esc, num = FV.num, ms = FV.ms;

  function head(title, sub, count, tools) {
    return '<div class="page-head"><div class="row">' +
      '<div><h1>' + title + '</h1><p>' + sub + '</p></div>' +
      (count != null ? '<span class="count-badge">' + count + '</span>' : '') +
      '<div class="toolbar">' + (tools || '') + '</div>' +
      '</div></div>';
  }
  FV.head = head;

  /* ---------------------------------------------------------- 总览 */
  FV.views.overview = function (root) {
    var ov = S.data.overview, svcs = S.data.services || [];
    if (!ov) { root.innerHTML = '<div class="empty">加载中…</div>'; return; }

    var down = svcs.filter(function (s) { return s.state === 'down'; });
    var warn = svcs.filter(function (s) { return s.state === 'warn'; });
    var featured = svcs.filter(function (s) { return s.featured; });
    var hero = featured.filter(function (s) { return s.state === 'up'; })[0] || featured[0] || svcs[0] || {};
    var t = ov.ttft || {};
    var src = ov.sources || [];
    var cpa = src[0] || {}, ccs = src[1] || {}, her = src[2] || {};

    root.innerHTML =
      head('监控总览', '本地智能体、CLI 与管理平台的调用、首词与存活状况', null,
        FV.rangeSeg() +
        '<button class="chip" id="btnProbe"><svg><use href="#i-zap"/></svg>实测首词</button>' +
        '<button class="btn-dark" id="btnRefresh"><svg><use href="#i-refresh"/></svg>立即刷新</button>') +

      '<div class="bento">' +

        // 大：调用总量（跨 7 列，高）
        '<div class="card accent pad-lg tall-num c7 h-md">' +
          '<div class="status-tag ' + (hero.state || 'down') + '"><span class="d"></span>' +
            esc(hero.name || '无服务') + ' · ' + (FV.stateLabel[hero.state] || '') + '</div>' +
          '<div class="bignum" style="margin:20px 0 6px">' + num(ov.calls) + '<small>次调用</small></div>' +
          '<div class="muted" style="font-size:13.5px;font-weight:550">' +
            '过去 ' + S.range + ' 内经 CPA 与 CC Switch 记录的模型请求总数</div>' +
          '<div style="flex:1"></div>' +
          '<div class="hero-meta" style="margin-top:0">' +
            '<div class="kv"><span class="k">成功率</span><span class="v mono" style="font-size:19px;color:' +
              (ov.success_rate >= 95 ? 'var(--green)' : ov.success_rate >= 80 ? 'var(--amber)' : 'var(--red)') +
              '">' + ov.success_rate + '%</span></div>' +
            '<div class="vline"></div>' +
            '<div class="kv"><span class="k">失败请求</span><span class="v mono" style="font-size:19px">' + num(ov.failed) + '</span></div>' +
            '<div class="vline"></div>' +
            '<div class="kv"><span class="k">消耗 token</span><span class="v mono" style="font-size:19px">' + num(ov.tokens) + '</span></div>' +
          '</div>' +
        '</div>' +

        // 小高：首词渐变卡（跨 5 列）
        '<div class="gradcard c5 stretch">' +
          '<div class="gc-top">' +
            '<span class="gc-name">首词延迟 · TIME TO FIRST TOKEN</span>' +
            '<span class="gc-badge">P50</span>' +
          '</div>' +
          '<div class="gc-num" style="font-size:46px">' +
            (t.p50 != null ? (t.p50 / 1000).toFixed(2) : '—') + '<small>秒</small></div>' +
          '<div class="gc-sub">P90 ' + ms(t.p90) + ' · P95 ' + ms(t.p95) + ' · 样本 ' + (t.n || 0) + ' 次</div>' +
          '<div style="position:relative;z-index:1;margin-top:14px;display:flex;gap:var(--gap-sm)">' +
            '<button class="gc-badge" id="toTtft" style="border:0;cursor:pointer;font-family:inherit">查看分布 →</button>' +
          '</div>' +
        '</div>' +

        // 同一行的两张卡等高：都 stretch，画布按布局后的实测高度渲染
        '<div class="card c8 h-sm stretch">' +
          '<div class="card-h"><h3>调用量与首词趋势</h3>' +
            '<div class="r legend">' +
              '<span><i style="background:#9dbcff"></i>成功</span>' +
              '<span><i style="background:#f5333f"></i>失败</span>' +
              '<span><i style="background:#f5333f;border-radius:999px;height:3px;width:14px"></i>首词 p50</span>' +
            '</div></div>' +
          '<div class="chart-wrap"><canvas id="cvSeries"></canvas></div>' +
        '</div>' +

        '<div class="card c4 h-sm stretch">' +
          '<div class="card-h"><h3>服务存活</h3>' +
            '<div class="r"><button class="chip" id="toSvc" style="padding:6px 12px;font-size:11.5px">全部</button></div></div>' +
          '<div class="grow" style="display:flex;align-items:center;justify-content:center;padding:2px 0 10px">' +
            '<div style="width:124px"><canvas id="cvDonut"></canvas></div></div>' +
          '<div class="grid g-2" style="gap:var(--gap-sm)">' +
            statRow('运行中', ov.services.up, 'var(--green)') +
            statRow('异常', ov.services.warn, 'var(--amber)') +
            statRow('已停止', ov.services.down, 'var(--red)') +
            statRow('已暂停', ov.services.paused, '#a8b2bf') +
          '</div>' +
        '</div>' +

        // 告警条（满宽，矮）
        (down.length || warn.length
          ? '<div class="card c12 alert-banner">' +
              '<div class="ab-head">' +
                '<span class="ab-ic"><svg><use href="#i-alert"/></svg></span>' +
                '<div><div class="ab-title">需要关注</div>' +
                  '<div class="tiny muted">' + (down.length + warn.length) + ' 项服务不在正常状态</div></div>' +
              '</div>' +
              '<div class="ab-items">' + down.concat(warn).map(function (s) {
                return '<div class="ab-item">' +
                  '<span class="status-tag ' + s.state + '"><span class="d"></span></span>' +
                  '<div style="min-width:0">' +
                    '<div class="ellip" style="font-weight:750;font-size:13px">' + esc(s.name) + '</div>' +
                    '<div class="ellip tiny muted">' + esc(s.note || s.desc || '') + '</div>' +
                  '</div>' +
                  (s.controllable
                    ? '<button class="mini-btn go" data-act="start" data-id="' + s.id + '" title="启动"><svg><use href="#i-play"/></svg></button>'
                    : '<span class="tag bad">' + FV.stateLabel[s.state] + '</span>') +
                '</div>';
              }).join('') + '</div>' +
            '</div>'
          : '') +

        // 三张来源卡，高度不一
        srcCard('CPA Manager Plus', 'cpa', cpa.calls, cpa.failed, cpa.tokens, cpa.ttft,
                '账号池网关 · usage_events', 'c5 h-sm') +
        srcCard('CC Switch', 'ccs', ccs.calls, ccs.failed, ccs.tokens, ccs.ttft,
                '供应商代理 · proxy_request_logs', 'c4 h-sm') +

        '<div class="card dark c3 stretch">' +
          '<div class="card-h"><h3>Hermes</h3>' +
            '<div class="r"><span class="tag hermes">智能体</span></div></div>' +
          '<div class="bignum sm">' + num(her.calls) + '<small>次调用</small></div>' +
          '<div class="divider"></div>' +
          '<div class="kv" style="margin-bottom:9px"><span class="k">会话数</span>' +
            '<span class="v mono">' + num(her.sessions) + '</span></div>' +
          '<div class="kv"><span class="k">累计 token</span>' +
            '<span class="v mono">' + num(her.tokens) + '</span></div>' +
          '<div style="flex:1"></div>' +
          '<div class="tiny muted">最近活动 ' + FV.ago(her.last_seen) + '</div>' +
        '</div>' +
      '</div>';

    // 绘图：等布局完成再量高度，避免 clientHeight 读到 0
    requestAnimationFrame(function () {
      var dn = D.getElementById('cvDonut');
      if (dn) {
        w.FVChart.donut(dn, [
          { v: ov.services.up, c: '#22b04b' },
          { v: ov.services.warn, c: '#ff9500' },
          { v: ov.services.down, c: '#f5333f' },
          { v: ov.services.paused, c: '#cdd5de' }
        ], { center: ov.services.up + '/' + ov.services.total, label: '在线', height: 122 });
      }
      var cv = D.getElementById('cvSeries');
      if (cv && S.data.series) {
        w.FVChart.callsChart(cv, S.data.series.points, { height: 224 });
      }
    });

    FV.bindRange();
    FV.bindServiceActions(root);
    D.getElementById('toSvc').onclick = function () { FV.go('services'); };
    D.getElementById('toTtft').onclick = function () { FV.go('ttft'); };
    D.getElementById('btnRefresh').onclick = FV.refreshAll;
    D.getElementById('btnProbe').onclick = FV.openProbe;
  };

  function statRow(label, v, color) {
    return '<div class="row-item" style="grid-template-columns:9px minmax(0,1fr) auto;padding:8px 11px;gap:var(--gap-sm)">' +
      '<span style="width:8px;height:8px;border-radius:3px;background:' + color + '"></span>' +
      '<span class="ellip" style="font-size:12px;font-weight:650;color:var(--ink-2)">' + label + '</span>' +
      '<span class="tnum" style="font-size:14px">' + (v || 0) + '</span></div>';
  }

  function srcCard(name, cls, calls, failed, tokens, t, sub, span) {
    t = t || {};
    var rate = calls ? (100 * (calls - failed) / calls).toFixed(1) : '—';
    return '<div class="card ' + (span || '') + '">' +
      '<div class="card-h"><h3>' + name + '</h3>' +
        '<div class="r"><span class="tag ' + cls + '">数据源</span></div></div>' +
      '<div class="bignum sm">' + num(calls) + '<small>次调用</small></div>' +
      '<div class="divider"></div>' +
      '<div class="grid g-2" style="gap:var(--gap-md)">' +
        '<div class="kv"><span class="k">成功率</span><span class="v mono">' + rate + '%</span></div>' +
        '<div class="kv"><span class="k">失败</span><span class="v mono">' + num(failed) + '</span></div>' +
        '<div class="kv"><span class="k">首词 p50</span><span class="v mono">' + ms(t.p50) + '</span></div>' +
        '<div class="kv"><span class="k">token</span><span class="v mono">' + num(tokens) + '</span></div>' +
      '</div>' +
      '<div style="flex:1"></div>' +
      '<div class="tiny muted">' + sub + '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------- 服务矩阵 */
  FV.views.services = function (root) {
    var svcs = S.data.services || [];
    if (!svcs.length) { root.innerHTML = '<div class="empty">加载中…</div>'; return; }

    var groups = [];
    svcs.forEach(function (s) {
      var g = groups.filter(function (x) { return x.name === (s.group || '其他'); })[0];
      if (!g) { g = { name: s.group || '其他', items: [] }; groups.push(g); }
      g.items.push(s);
    });

    var filt = S.svcFilter || 'all';
    var badCount = svcs.filter(function (s) { return s.state === 'down' || s.state === 'warn'; }).length;

    root.innerHTML =
      head('服务矩阵', '端口探测与进程匹配双重校验，可直接启停', svcs.length,
        '<button class="chip' + (filt === 'bad' ? ' on' : '') + '" id="fBad"><svg><use href="#i-filter"/></svg>只看异常' +
          (badCount ? '<span class="dot-alert"></span>' : '') + '</button>' +
        '<button class="chip' + (filt === 'ctrl' ? ' on' : '') + '" id="fCtrl">可控服务</button>' +
        '<button class="btn-dark" id="btnRefresh2"><svg><use href="#i-refresh"/></svg>重新探测</button>') +

      groups.map(function (g) {
        var items = g.items.filter(function (s) {
          if (filt === 'bad') return s.state === 'down' || s.state === 'warn';
          if (filt === 'ctrl') return s.controllable;
          return true;
        });
        if (!items.length) return '';
        return '<div style="margin-bottom:22px">' +
          '<div class="card-h" style="margin-bottom:12px">' +
            '<h3 style="font-size:14px">' + esc(g.name) + '</h3>' +
            '<span class="sub">' + items.length + ' 项</span>' +
          '</div>' +
          '<div class="grid g-4">' + items.map(FV.serviceCard).join('') + '</div>' +
        '</div>';
      }).join('') || '<div class="empty">没有符合条件的服务</div>';

    FV.bindServiceActions(root);
    FV.paintSparks(root);
    D.getElementById('btnRefresh2').onclick = FV.refreshAll;
    D.getElementById('fBad').onclick = function () { S.svcFilter = filt === 'bad' ? 'all' : 'bad'; FV.render(); };
    D.getElementById('fCtrl').onclick = function () { S.svcFilter = filt === 'ctrl' ? 'all' : 'ctrl'; FV.render(); };
  };
})(window, document);
