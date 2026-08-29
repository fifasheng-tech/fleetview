/* 视图：调用分析 / 首词延迟 */
(function (w, D) {
  'use strict';
  var FV = w.FV, S = FV.state, esc = FV.esc, num = FV.num, ms = FV.ms;

  function pill(rate) {
    var c = rate >= 95 ? 'ok' : rate >= 80 ? '' : 'bad';
    return '<span class="tag ' + c + '">' + rate + '%</span>';
  }

  /* ---------------------------------------------------------- 调用分析 */
  FV.views.calls = function (root) {
    root.innerHTML = FV.head('调用分析', '按模型与供应商拆解调用量、成功率与延迟', null,
      FV.rangeSeg()) + '<div class="empty">加载中…</div>';
    FV.bindRange();

    Promise.all([
      FV.get('/api/models?range=' + S.range),
      FV.get('/api/providers?range=' + S.range)
    ]).then(function (r) {
      var models = r[0].models || [], provs = r[1].providers || [], ccsp = r[1].ccswitch || [];
      var total = models.reduce(function (a, m) { return a + m.calls; }, 0);

      root.innerHTML = FV.head('调用分析', '按模型与供应商拆解调用量、成功率与延迟', total, FV.rangeSeg()) +

        '<div class="grid g-hero" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card">' +
            '<div class="card-h"><h3>模型调用排行</h3><span class="sub">Top ' + models.length + '</span></div>' +
            '<div class="rows">' + (models.length ? models.map(function (m, i) {
              var w0 = total ? (100 * m.calls / models[0].calls) : 0;
              return '<div class="row-item" style="grid-template-columns:26px minmax(0,1.5fr) 1fr auto auto auto">' +
                '<span class="rank">' + (i + 1) + '</span>' +
                '<div style="min-width:0">' +
                  '<div class="ellip" style="font-weight:700;font-size:13px">' + esc(m.model) + '</div>' +
                  '<div class="tiny muted">' + m.sources.join(' · ') + '</div>' +
                '</div>' +
                '<div><div class="bar-track"><div class="bar-fill blue" style="width:' + w0 + '%"></div></div></div>' +
                '<span class="tnum" style="font-size:13.5px;min-width:44px;text-align:right">' + num(m.calls) + '</span>' +
                '<span class="tnum tiny muted" style="min-width:58px;text-align:right">' + ms(m.ttft.p50) + '</span>' +
                pill(m.success_rate) +
              '</div>';
            }).join('') : '<div class="empty">该时间段无调用记录</div>') + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>供应商分布</h3><span class="sub">按来源合并</span></div>' +
            '<div class="chart-wrap"><canvas id="cvProv"></canvas></div>' +
            '<div class="divider"></div>' +
            '<div class="rows">' + provs.slice(0, 6).map(function (p) {
              return '<div class="row-item" style="grid-template-columns:1fr auto auto;padding:9px 13px">' +
                '<span class="ellip tiny" style="font-weight:650">' + esc(p.provider) + '</span>' +
                '<span class="tag ' + (p.source === 'CPA' ? 'cpa' : 'ccs') + '">' + p.source + '</span>' +
                pill(p.success_rate) +
              '</div>';
            }).join('') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="card" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card-h"><h3>调用量与首词趋势</h3><span class="sub">柱=调用次数，线=首词 p50</span></div>' +
          '<div class="chart-wrap"><canvas id="cvSeries2"></canvas></div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-h"><h3>CC Switch 供应商健康</h3>' +
            '<span class="sub">当前生效 / 故障转移队列</span></div>' +
          '<div class="rows">' + (ccsp.length ? ccsp.filter(function (p) {
            return p.current || p.failover || !p.healthy;
          }).map(function (p) {
            return '<div class="row-item' + (!p.healthy ? ' fail' : '') + '" style="grid-template-columns:auto minmax(0,1fr) auto auto auto">' +
              '<span class="status-tag ' + (p.healthy ? 'up' : 'down') + '"><span class="d"></span></span>' +
              '<div style="min-width:0"><div class="ellip" style="font-weight:700;font-size:13px">' + esc(p.name) + '</div>' +
                '<div class="tiny muted">' + esc(p.app) + (p.last_error ? ' · ' + esc(String(p.last_error).slice(0, 60)) : '') + '</div></div>' +
              (p.current ? '<span class="tag ok">当前生效</span>' : '') +
              (p.failover ? '<span class="tag">故障转移</span>' : '') +
              '<span class="tiny muted mono">' + (p.failures ? p.failures + ' 次连败' : '正常') + '</span>' +
            '</div>';
          }).join('') : '<div class="empty">无供应商记录</div>') + '</div>' +
        '</div>';

      w.FVChart.hbars(D.getElementById('cvProv'), provs.slice(0, 6).map(function (p) {
        return { k: p.provider, v: p.calls, label: num(p.calls),
                 c0: p.source === 'CPA' ? '#9dbcff' : '#c3a8ff',
                 c1: p.source === 'CPA' ? '#2f6bff' : '#6b3fd4' };
      }), { labelWidth: 178 });

      if (S.data.series) w.FVChart.callsChart(D.getElementById('cvSeries2'), S.data.series.points, { height: 230 });
      FV.bindRange();
    });
  };

  /* ---------------------------------------------------------- 首词延迟 */
  FV.views.ttft = function (root) {
    root.innerHTML = FV.head('首词延迟', '从发出请求到收到第一个内容片段的耗时', null, FV.rangeSeg()) +
      '<div class="empty">加载中…</div>';
    FV.bindRange();

    FV.get('/api/ttft?range=' + S.range).then(function (r) {
      var hi = r.histogram || {}, st = hi.stats || {}, models = r.models || [], probes = r.probes || [];
      var counts = hi.counts || [], labels = hi.labels || [];
      var mx = Math.max.apply(null, counts.concat([1]));
      var ranked = models.filter(function (m) { return m.ttft.n >= 3; })
                         .sort(function (a, b) { return (a.ttft.p50 || 0) - (b.ttft.p50 || 0); });

      root.innerHTML = FV.head('首词延迟', '从发出请求到收到第一个内容片段的耗时 (TTFT)', st.n || 0,
        FV.rangeSeg() + '<button class="btn-dark" id="btnProbe2"><svg><use href="#i-zap"/></svg>实测首词</button>') +

        '<div class="grid g-4" style="margin-bottom:var(--gap-lg)">' +
          kpi('中位数 P50', st.p50, 'var(--green)') +
          kpi('P90', st.p90, 'var(--amber)') +
          kpi('P95', st.p95, 'var(--red)') +
          kpi('最快 / 最慢', null, '', ms(st.min) + ' / ' + ms(st.max)) +
        '</div>' +

        '<div class="grid g-hero" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card">' +
            '<div class="card-h"><h3>首词延迟分布</h3><span class="sub">样本 ' + (st.n || 0) + ' 次成功调用</span></div>' +
            '<div class="histo">' + labels.map(function (l, i) {
              var cls = i <= 2 ? 'fast' : i <= 4 ? 'mid' : '';
              var pct = counts[i] ? Math.max(3, 100 * counts[i] / mx) : 0;
              return '<div class="hb ' + cls + '">' +
                '<span class="hval">' + (counts[i] || 0) + '</span>' +
                '<div class="hbar" style="height:' + pct + '%"></div>' +
                '<span class="hlab">' + l + '</span></div>';
            }).join('') + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>主动实测</h3><span class="sub">经 CLI Proxy API 发一次最小流式请求</span></div>' +
            (probes.length ? '<div class="rows">' + probes.slice(0, 7).map(function (p) {
              return '<div class="row-item' + (p.ok ? '' : ' fail') + '" style="grid-template-columns:minmax(0,1fr) auto auto">' +
                '<span class="ellip tiny" style="font-weight:650">' + esc(p.model || '—') + '</span>' +
                '<span class="tnum" style="font-size:13px">' + ms(p.ttft_ms) + '</span>' +
                '<span class="tiny faint">' + FV.ago(p.ts) + '</span>' +
              '</div>';
            }).join('') + '</div>'
            : '<div class="empty" style="padding:26px 10px">还没有实测记录<br><span class="tiny">点右上「实测首词」发起一次</span></div>') +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-h"><h3>按模型排序</h3><span class="sub">仅统计样本 ≥3 次的模型，由快到慢</span></div>' +
          '<div class="rows">' + (ranked.length ? ranked.map(function (m, i) {
            var t = m.ttft;
            var slowest = ranked[ranked.length - 1].ttft.p50 || 1;
            return '<div class="row-item" style="grid-template-columns:26px minmax(0,1.3fr) 1fr auto auto auto">' +
              '<span class="rank">' + (i + 1) + '</span>' +
              '<div style="min-width:0"><div class="ellip" style="font-weight:700;font-size:13px">' + esc(m.model) + '</div>' +
                '<div class="tiny muted">' + m.calls + ' 次调用 · ' + m.sources.join(' · ') + '</div></div>' +
              '<div><div class="bar-track"><div class="bar-fill' +
                (t.p50 < 2000 ? ' green' : t.p50 < 8000 ? ' amber' : '') +
                '" style="width:' + Math.max(4, 100 * t.p50 / slowest) + '%"></div></div></div>' +
              '<span class="tnum" style="font-size:13.5px;min-width:60px;text-align:right">' + ms(t.p50) + '</span>' +
              '<span class="tiny muted mono" style="min-width:70px;text-align:right">p95 ' + ms(t.p95) + '</span>' +
              '<span class="tiny faint mono" style="min-width:40px;text-align:right">n=' + t.n + '</span>' +
            '</div>';
          }).join('') : '<div class="empty">该时间段样本不足</div>') + '</div>' +
        '</div>';

      FV.bindRange();
      D.getElementById('btnProbe2').onclick = FV.openProbe;
    });
  };

  function kpi(label, v, color, override) {
    return '<div class="card">' +
      '<div class="status-tag" style="margin-bottom:10px"><span class="d" style="background:' + (color || '#cdd5de') + '"></span>' + label + '</div>' +
      '<div class="bignum sm">' + (override != null ? override
        : (v != null ? (v >= 1000 ? (v / 1000).toFixed(2) : v) : '—') +
          (v != null ? '<small>' + (v >= 1000 ? '秒' : '毫秒') + '</small>' : '')) + '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------- 实测弹层 */
  FV.openProbe = function () {
    var models = (S.data.probeModels || ['gpt-5', 'claude-opus-4-8', 'tokenrhythm-glm-5']);
    FV.sheet(
      '<div class="card-h"><h3>实测首词延迟</h3>' +
        '<div class="r"><button class="mini-btn" id="pClose"><svg><use href="#i-x"/></svg></button></div></div>' +
      '<p class="muted" style="font-size:13px;margin-bottom:16px">' +
        '向本机 CLI Proxy API (127.0.0.1:8317) 发一次 <code>max_tokens=8</code> 的流式请求，' +
        '计时到第一个内容片段到达为止。会真实消耗一次配额。</p>' +
      '<div style="display:flex;gap:var(--gap-sm);margin-bottom:var(--gap-lg)">' +
        '<input type="text" id="pModel" value="' + esc(models[0]) + '" placeholder="模型名">' +
        '<button class="btn-dark" id="pRun" style="flex:none"><svg><use href="#i-zap"/></svg>开始</button>' +
      '</div>' +
      '<div id="pOut"></div>');

    D.getElementById('pClose').onclick = FV.closeSheet;
    D.getElementById('pRun').onclick = function () {
      var btn = this, model = D.getElementById('pModel').value.trim();
      if (!model) return;
      btn.disabled = true;
      D.getElementById('pOut').innerHTML = '<div class="empty">请求中，最长等待 30 秒…</div>';
      FV.post('/api/probe-ttft', { model: model }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          D.getElementById('pOut').innerHTML =
            '<div class="row-item fail"><div><div style="font-weight:700">探测失败</div>' +
            '<div class="tiny muted" style="margin-top:4px">' + esc(r.msg || '未知错误') + '</div></div></div>';
          return;
        }
        D.getElementById('pOut').innerHTML =
          '<div class="card" style="box-shadow:none;background:var(--card-soft);padding:18px">' +
          '<div class="status-tag up"><span class="d"></span>探测成功 · ' + esc(r.model) + '</div>' +
          '<div class="bignum" style="margin-top:12px">' + (r.ttft_ms / 1000).toFixed(2) + '<small>秒首词</small></div>' +
          '<div class="tiny muted" style="margin-top:8px">整轮耗时 ' + ms(r.total_ms) + '</div></div>';
        FV.toast('首词 ' + ms(r.ttft_ms), 'good');
      }).catch(function (e) {
        btn.disabled = false;
        D.getElementById('pOut').innerHTML = '<div class="empty">请求异常: ' + esc(e.message) + '</div>';
      });
    };
  };
})(window, document);
