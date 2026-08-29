/* 视图：Token 消耗 / Hermes 智能体 */
(function (w, D) {
  'use strict';
  var FV = w.FV, S = FV.state, esc = FV.esc, num = FV.num;

  /* ---------------------------------------------------------- Token 消耗 */
  FV.views.tokens = function (root) {
    root.innerHTML = FV.head('Token 消耗', '输入输出结构、缓存命中与单次调用成本', null, FV.rangeSeg()) +
      '<div class="empty">加载中…</div>';
    FV.bindRange();

    FV.get('/api/tokens?range=' + S.range).then(function (r) {
      var t = r.total || {}, models = r.models || [];
      var billed = (t.input || 0) + (t.cache_read || 0);

      root.innerHTML = FV.head('Token 消耗',
        '输入输出结构、缓存命中率与每次调用的平均消耗', num(t.all), FV.rangeSeg()) +

        '<div class="grid g-hero" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card">' +
            '<div class="status-tag"><span class="d" style="background:#2f6bff"></span>区间总消耗</div>' +
            '<div class="bignum" style="margin:16px 0 4px">' + num(t.all) + '<small>token</small></div>' +
            '<div class="muted" style="font-size:13px;font-weight:550">输入与输出之和，不含缓存读取</div>' +
            '<div class="divider"></div>' +
            '<div class="grid g-4" style="gap:var(--gap-md)">' +
              '<div class="kv"><span class="k">输入</span><span class="v mono">' + num(t.input) + '</span></div>' +
              '<div class="kv"><span class="k">输出</span><span class="v mono">' + num(t.output) + '</span></div>' +
              '<div class="kv"><span class="k">推理</span><span class="v mono">' + num(t.reasoning) + '</span></div>' +
              '<div class="kv"><span class="k">输出占比</span><span class="v mono">' +
                (t.all ? (100 * t.output / t.all).toFixed(1) + '%' : '—') + '</span></div>' +
            '</div>' +
            '<div class="divider"></div>' +
            '<div class="tiny muted">输入远大于输出是 agent 类负载的典型特征：' +
              '每轮都要把完整上下文重新送一遍，输出只有几百 token。</div>' +
          '</div>' +

          '<div class="gradcard" style="min-height:220px">' +
            '<div class="gc-top">' +
              '<span class="gc-name">缓存命中率 · CACHE HIT</span>' +
              '<span class="gc-badge">读 / 计费</span>' +
            '</div>' +
            '<div class="gc-num">' + (t.cache_hit_rate || 0) + '<small>%</small></div>' +
            '<div class="gc-sub">缓存读取 ' + num(t.cache_read) + ' · 缓存写入 ' + num(t.cache_write) +
              '<br>计费输入基数 ' + num(billed) + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-h"><h3>按模型拆解</h3>' +
            '<span class="sub">仅 CPA 侧有完整 token 明细，按总量排序</span></div>' +
          '<div class="rows">' + (models.length ? models.map(function (m, i) {
            var mx = models[0].total || 1;
            var outPct = m.total ? 100 * (m.outp || 0) / m.total : 0;
            return '<div class="row-item" style="grid-template-columns:26px minmax(0,1.3fr) 1fr 74px 66px 74px">' +
              '<span class="rank">' + (i + 1) + '</span>' +
              '<div style="min-width:0">' +
                '<div class="ellip" style="font-weight:700;font-size:13px">' + esc(m.model) + '</div>' +
                '<div class="tiny muted">' + m.calls + ' 次调用 · 输出占 ' + outPct.toFixed(1) + '%</div>' +
              '</div>' +
              '<div><div class="bar-track" style="height:9px;display:flex;overflow:hidden">' +
                '<div style="width:' + (100 * (m.inp || 0) / mx) + '%;background:linear-gradient(90deg,#9dbcff,#2f6bff)"></div>' +
                '<div style="width:' + (100 * (m.outp || 0) / mx) + '%;background:linear-gradient(90deg,#7fdc9c,#22b04b)"></div>' +
                '<div style="width:' + (100 * (m.reason || 0) / mx) + '%;background:linear-gradient(90deg,#ffd08a,#ff9500)"></div>' +
              '</div></div>' +
              '<span class="tnum tiny" style="text-align:right">' + num(m.total) + '</span>' +
              '<span class="tnum tiny muted" style="text-align:right">' + num(m.per_call) + '/次</span>' +
              '<span class="tnum tiny faint" style="text-align:right">' + num(m.reason || 0) + ' 推理</span>' +
            '</div>';
          }).join('') : '<div class="empty">该时间段无 token 记录</div>') + '</div>' +
          '<div class="legend" style="margin-top:14px">' +
            '<span><i style="background:#2f6bff"></i>输入</span>' +
            '<span><i style="background:#22b04b"></i>输出</span>' +
            '<span><i style="background:#ff9500"></i>推理</span>' +
          '</div>' +
        '</div>';

      FV.bindRange();
    });
  };

  /* ---------------------------------------------------------- Hermes */
  var SRC_CN = { cli: '命令行', desktop: '桌面端', cron: '定时任务',
                 telegram: 'Telegram', weixin: '微信', feishu: '飞书',
                 discord: 'Discord', api: 'API' };

  FV.views.agents = function (root) {
    root.innerHTML = FV.head('Hermes 智能体', '网关平台接入状态、会话来源与模型用量', null, '') +
      '<div class="empty">加载中…</div>';

    FV.get('/api/agents').then(function (r) {
      var gw = r.gateway || {}, plats = gw.platforms || [];
      var sources = r.sources || [], sum = r.summary || {};
      var models = r.models || [], sess = r.sessions || [];
      var bad = plats.filter(function (p) { return p.severity !== 'ok'; });
      var totalSess = sources.reduce(function (s, x) { return s + x.sessions; }, 0);

      root.innerHTML = FV.head('Hermes 智能体',
        '网关平台接入状态、会话来源分布与模型累计用量', plats.length, '') +

        '<div class="grid g-4" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card">' +
            '<div class="status-tag ' + (gw.gateway_state === 'running' ? 'up' : 'down') +
              '"><span class="d"></span>网关 ' + (gw.gateway_state === 'running' ? '运行中' : (gw.gateway_state || '未知')) + '</div>' +
            '<div class="bignum sm" style="margin-top:12px">' + (gw.pid || '—') + '<small>PID</small></div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="status-tag"><span class="d" style="background:var(--green)"></span>平台接入</div>' +
            '<div class="bignum sm" style="margin-top:12px">' +
              plats.filter(function (p) { return p.ok; }).length + '<small>/ ' + plats.length + ' 已连接</small></div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="status-tag"><span class="d" style="background:#2f6bff"></span>累计 API 调用</div>' +
            '<div class="bignum sm" style="margin-top:12px">' + num(sum.calls) + '<small>次</small></div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="status-tag"><span class="d" style="background:var(--amber)"></span>近 7 天会话</div>' +
            '<div class="bignum sm" style="margin-top:12px">' + totalSess + '<small>个</small></div>' +
          '</div>' +
        '</div>' +

        (bad.length
          ? '<div class="card" style="margin-bottom:var(--gap-lg);border-left:4px solid var(--red)">' +
              '<div class="card-h"><h3 style="color:var(--red)">平台异常</h3>' +
                '<span class="sub">' + bad.length + ' 个接入点不可用</span></div>' +
              '<div class="rows">' + bad.map(function (p) {
                return '<div class="row-item fail" style="grid-template-columns:auto minmax(0,1fr) auto">' +
                  '<span class="status-tag down"><span class="d"></span></span>' +
                  '<div style="min-width:0">' +
                    '<div style="font-weight:750;font-size:13.5px">' + esc(p.name) + '</div>' +
                    '<div class="tiny" style="color:var(--red)">' +
                      esc(p.error || p.error_code || p.state) + '</div>' +
                  '</div>' +
                  '<span class="tag bad">' + esc(p.state) + '</span>' +
                '</div>';
              }).join('') + '</div></div>'
          : '') +

        '<div class="grid g-hero" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card">' +
            '<div class="card-h"><h3>平台接入</h3><span class="sub">来自 gateway_state.json</span></div>' +
            '<div class="grid g-3" style="gap:var(--gap-md)">' + plats.map(function (p) {
              var cls = p.severity === 'ok' ? 'up' : p.severity === 'bad' ? 'down' : 'warn';
              return '<div class="row-item" style="grid-template-columns:auto minmax(0,1fr);padding:13px 14px">' +
                '<span class="status-tag ' + cls + '"><span class="d"></span></span>' +
                '<div style="min-width:0">' +
                  '<div class="ellip" style="font-weight:700;font-size:13px">' + esc(p.name) + '</div>' +
                  '<div class="tiny ' + (p.ok ? 'muted' : '') + '" style="' +
                    (p.ok ? '' : 'color:var(--red)') + '">' + esc(p.state) + '</div>' +
                '</div>' +
              '</div>';
            }).join('') + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>会话来源</h3><span class="sub">近 7 天</span></div>' +
            '<div class="chart-wrap"><canvas id="cvSrc"></canvas></div>' +
            '<div class="divider"></div>' +
            '<div class="rows">' + sources.map(function (s) {
              return '<div class="row-item" style="grid-template-columns:minmax(0,1fr) auto auto;padding:9px 13px">' +
                '<span class="tiny" style="font-weight:650">' + esc(SRC_CN[s.source] || s.source) + '</span>' +
                '<span class="tiny muted mono">' + num(s.messages) + ' 消息</span>' +
                '<span class="tiny faint mono">' + num(s.tools) + ' 工具</span>' +
              '</div>';
            }).join('') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="grid g-2">' +
          '<div class="card">' +
            '<div class="card-h"><h3>模型用量</h3><span class="sub">累计口径</span></div>' +
            '<div class="rows">' + models.slice(0, 9).map(function (m, i) {
              return '<div class="row-item" style="grid-template-columns:26px minmax(0,1fr) auto auto">' +
                '<span class="rank">' + (i + 1) + '</span>' +
                '<div style="min-width:0">' +
                  '<div class="ellip" style="font-weight:700;font-size:12.5px">' + esc(m.model) + '</div>' +
                  '<div class="ellip tiny muted">' + esc(m.billing_provider || '未标注') + '</div>' +
                '</div>' +
                '<span class="tnum tiny">' + num(m.calls) + ' 次</span>' +
                '<span class="tnum tiny muted">' + num(m.tokens) + 'tk</span>' +
              '</div>';
            }).join('') + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>最近会话</h3><span class="sub">按开始时间</span></div>' +
            '<div class="rows">' + sess.slice(0, 9).map(function (s) {
              return '<div class="row-item" style="grid-template-columns:auto minmax(0,1fr) auto auto">' +
                '<span class="tag">' + esc(SRC_CN[s.source] || s.source) + '</span>' +
                '<div style="min-width:0">' +
                  '<div class="ellip tiny" style="font-weight:650">' + esc(s.model || '未标注模型') + '</div>' +
                  '<div class="tiny faint">' + FV.ago(Math.round(s.started_at)) + '</div>' +
                '</div>' +
                '<span class="tnum tiny muted">' + (s.message_count || 0) + ' 消息</span>' +
                '<span class="tnum tiny faint">' + (s.tool_call_count || 0) + ' 工具</span>' +
              '</div>';
            }).join('') + '</div>' +
          '</div>' +
        '</div>';

      w.FVChart.hbars(D.getElementById('cvSrc'), sources.map(function (s) {
        return { k: SRC_CN[s.source] || s.source, v: s.sessions, label: s.sessions + ' 会话',
                 c0: '#ffc48f', c1: '#d4600f' };
      }), { labelWidth: 92 });
    });
  };
})(window, document);
