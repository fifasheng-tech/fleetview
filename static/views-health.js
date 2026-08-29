/* 视图：账号池 / 错误告警 */
(function (w, D) {
  'use strict';
  var FV = w.FV, S = FV.state, esc = FV.esc, num = FV.num, ms = FV.ms;

  var HEALTH_CN = { ok: '健康', watch: '观察', degraded: '劣化', dead: '已失效' };

  /* ---------------------------------------------------------- 账号池 */
  FV.views.accounts = function (root) {
    root.innerHTML = FV.head('账号池', '按 CPA 凭据维度看每个号的成功率与首词', null, FV.rangeSeg()) +
      '<div class="empty">加载中…</div>';
    FV.bindRange();

    FV.get('/api/accounts?range=' + S.range).then(function (r) {
      var accts = r.accounts || [], provs = r.providers || [];
      var dead = accts.filter(function (a) { return a.health === 'dead'; });
      var bad = accts.filter(function (a) { return a.health === 'degraded'; });
      var totalCalls = accts.reduce(function (s, a) { return s + a.calls; }, 0);

      root.innerHTML = FV.head('账号池',
        '按 CPA 凭据 (auth_index) 维度看每个号的成功率、首词与承载量', accts.length,
        FV.rangeSeg()) +

        '<div class="grid g-4" style="margin-bottom:var(--gap-lg)">' +
          kpiCard('可用凭据', accts.filter(function (a) { return a.health === 'ok' || a.health === 'watch'; }).length,
                  '个', 'var(--green)') +
          kpiCard('劣化', bad.length, '个', 'var(--amber)') +
          kpiCard('已失效', dead.length, '个', 'var(--red)') +
          kpiCard('区间调用', num(totalCalls), '次', '#2f6bff') +
        '</div>' +

        (dead.length || bad.length
          ? '<div class="card" style="margin-bottom:var(--gap-lg);border-left:4px solid var(--red)">' +
              '<div class="card-h"><h3 style="color:var(--red)">凭据异常</h3>' +
              '<span class="sub">失效的号会持续吃掉重试预算，建议下线或换绑</span></div>' +
              '<div class="rows">' + dead.concat(bad).map(function (a) {
                return '<div class="row-item fail" style="grid-template-columns:auto auto minmax(0,1fr) auto auto auto">' +
                  '<span class="acct-key">' + esc(a.short) + '</span>' +
                  '<span class="hbadge ' + a.health + '">' + HEALTH_CN[a.health] + '</span>' +
                  '<span class="ellip tiny muted">' + esc(a.provider) + (a.label ? ' · ' + esc(a.label) : '') + '</span>' +
                  '<span class="tnum tiny">' + a.calls + ' 次</span>' +
                  '<span class="tnum tiny" style="color:var(--red)">' + a.failed + ' 失败</span>' +
                  '<span class="tnum" style="font-size:14px;color:var(--red)">' + a.success_rate + '%</span>' +
                '</div>';
              }).join('') + '</div></div>'
          : '') +

        '<div class="card" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card-h"><h3>全部凭据</h3>' +
            '<span class="sub">按承载调用量排序</span></div>' +
          '<div class="rows">' + (accts.length ? accts.map(function (a) {
            var share = totalCalls ? 100 * a.calls / accts[0].calls : 0;
            return '<div class="row-item" style="grid-template-columns:auto auto minmax(0,.9fr) 1fr 66px 62px 68px">' +
              '<span class="acct-key">' + esc(a.short) + '</span>' +
              '<span class="hbadge ' + a.health + '">' + HEALTH_CN[a.health] + '</span>' +
              '<span class="ellip tiny muted">' + esc(a.provider) + '</span>' +
              '<div><div class="bar-track"><div class="bar-fill ' +
                (a.success_rate >= 92 ? 'green' : a.success_rate >= 70 ? 'amber' : '') +
                '" style="width:' + Math.max(3, share) + '%"></div></div></div>' +
              '<span class="tnum tiny" style="text-align:right">' + num(a.calls) + ' 次</span>' +
              '<span class="tnum tiny muted" style="text-align:right">' + ms(a.ttft.p50) + '</span>' +
              '<span class="tnum" style="font-size:13px;text-align:right;color:' +
                (a.success_rate >= 92 ? 'var(--green)' : a.success_rate >= 70 ? 'var(--amber)' : 'var(--red)') +
                '">' + a.success_rate + '%</span>' +
            '</div>';
          }).join('') : '<div class="empty">该时间段没有带凭据标识的调用</div>') + '</div>' +
          '<div class="tiny muted" style="margin-top:12px">' +
            'auth_index 是 CPA 对凭据做的哈希标识，面板只显示前 8 位，不接触凭据本身。</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-h"><h3>CC Switch 供应商</h3>' +
            '<span class="sub">当前生效、故障转移队列与连续失败计数</span></div>' +
          '<div class="rows">' + (provs.length ? provs.map(function (p) {
            return '<div class="row-item' + (!p.healthy ? ' fail' : '') +
              '" style="grid-template-columns:auto minmax(0,1fr) auto auto auto">' +
              '<span class="status-tag ' + (p.healthy ? 'up' : 'down') + '"><span class="d"></span></span>' +
              '<div style="min-width:0">' +
                '<div class="ellip" style="font-weight:700;font-size:13px">' + esc(p.name) + '</div>' +
                '<div class="ellip tiny muted">' + esc(p.app) +
                  (p.last_error ? ' · ' + esc(String(p.last_error).slice(0, 70)) : '') + '</div>' +
              '</div>' +
              (p.current ? '<span class="tag ok">当前生效</span>' : '<span></span>') +
              (p.failover ? '<span class="tag">故障转移</span>' : '<span></span>') +
              '<span class="tiny muted mono">' + (p.failures ? p.failures + ' 次连败' : '正常') + '</span>' +
            '</div>';
          }).join('') : '<div class="empty">无供应商记录</div>') + '</div>' +
        '</div>';

      FV.bindRange();
    });
  };

  function kpiCard(label, v, unit, color) {
    return '<div class="card">' +
      '<div class="status-tag" style="margin-bottom:10px"><span class="d" style="background:' + color + '"></span>' + label + '</div>' +
      '<div class="bignum sm">' + v + '<small>' + unit + '</small></div></div>';
  }

  /* ---------------------------------------------------------- 错误告警 */
  FV.views.errors = function (root) {
    root.innerHTML = FV.head('错误告警', '失败请求的状态码、上游归因与集中度', null, FV.rangeSeg()) +
      '<div class="empty">加载中…</div>';
    FV.bindRange();

    FV.get('/api/errors?range=' + S.range).then(function (r) {
      S.alertCount = r.total;
      FV.renderNav();
      var st = r.by_status || [];
      var mx = st.length ? st[0].n : 1;

      root.innerHTML = FV.head('错误告警',
        '失败请求的状态码分布、上游归因与集中在哪些模型 / 供应商', r.total, FV.rangeSeg()) +

        (r.total === 0
          ? '<div class="card"><div class="empty">该时间段没有失败请求 🎉</div></div>'
          : '<div class="grid g-hero" style="margin-bottom:var(--gap-lg)">' +
              '<div class="card">' +
                '<div class="card-h"><h3>按状态码</h3>' +
                  '<span class="sub">附上游返回的原始报错片段</span></div>' +
                '<div class="rows">' + st.map(function (s) {
                  return '<div class="row-item fail" style="grid-template-columns:64px minmax(0,1fr) 1fr 54px">' +
                    '<span class="tag bad" style="text-align:center;font-size:12px;padding:5px 8px">' +
                      (s.status || 'ERR') + '</span>' +
                    '<div style="min-width:0">' +
                      '<div style="font-weight:700;font-size:12.5px">' + esc(s.hint) + '</div>' +
                      (s.sample ? '<div class="ellip tiny muted">' + esc(s.sample) + '</div>' : '') +
                    '</div>' +
                    '<div><div class="bar-track"><div class="bar-fill" style="width:' +
                      Math.max(4, 100 * s.n / mx) + '%"></div></div></div>' +
                    '<span class="tnum" style="font-size:14px;text-align:right">' + s.n + '</span>' +
                  '</div>';
                }).join('') + '</div>' +
              '</div>' +

              '<div class="card">' +
                '<div class="card-h"><h3>上游归因</h3>' +
                  '<span class="sub">来自响应头 error_kind</span></div>' +
                '<div class="rows">' + (r.by_kind || []).map(function (k) {
                  var isLimit = k.kind === 'rate_limit';
                  return '<div class="row-item" style="grid-template-columns:minmax(0,1fr) auto auto">' +
                    '<span class="ellip tiny" style="font-weight:650">' +
                      esc(k.kind === 'unclassified' ? '未分类（上游未带归因头）' :
                          k.kind === 'rate_limit' ? '限流 rate_limit' : k.kind) + '</span>' +
                    (isLimit ? '<span class="tag bad">限流</span>' : '<span></span>') +
                    '<span class="tnum" style="font-size:13px">' + k.n + '</span>' +
                  '</div>';
                }).join('') + '</div>' +
                '<div class="divider"></div>' +
                '<div class="tiny muted">限流类错误说明号池并发打满，可考虑扩号或降速；' +
                  '未分类多为上游 5xx，通常是对端服务本身抖动。</div>' +
              '</div>' +
            '</div>' +

            '<div class="grid g-2">' +
              listCard('失败集中的模型', r.by_model || [], 'model') +
              listCard('失败集中的供应商', r.by_provider || [], 'provider') +
            '</div>');

      FV.bindRange();
    });
  };

  function listCard(title, items, key) {
    var mx = items.length ? items[0].n : 1;
    return '<div class="card">' +
      '<div class="card-h"><h3>' + title + '</h3><span class="sub">Top ' + items.length + '</span></div>' +
      '<div class="rows">' + (items.length ? items.map(function (it, i) {
        return '<div class="row-item" style="grid-template-columns:26px minmax(0,1.2fr) 1fr 46px">' +
          '<span class="rank">' + (i + 1) + '</span>' +
          '<span class="ellip tiny" style="font-weight:650">' + esc(it[key]) + '</span>' +
          '<div><div class="bar-track"><div class="bar-fill" style="width:' +
            Math.max(4, 100 * it.n / mx) + '%"></div></div></div>' +
          '<span class="tnum tiny" style="text-align:right">' + it.n + '</span>' +
        '</div>';
      }).join('') : '<div class="empty">无记录</div>') + '</div></div>';
  }
})(window, document);
