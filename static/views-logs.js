/* 视图：调用日志 / 设置 */
(function (w, D) {
  'use strict';
  var FV = w.FV, S = FV.state, esc = FV.esc, num = FV.num, ms = FV.ms;

  /* ---------------------------------------------------------- 调用日志 */
  FV.views.logs = function (root) {
    var onlyFail = S.logFail ? 1 : 0;
    root.innerHTML = FV.head('调用日志', '最近的模型请求明细，含首词、耗时与失败原因', null, FV.rangeSeg()) +
      '<div class="empty">加载中…</div>';
    FV.bindRange();

    FV.get('/api/calls?range=' + S.range + '&limit=120&fail=' + onlyFail).then(function (r) {
      var calls = r.calls || [];
      if (S.logProxyOnly) calls = calls.filter(function (c) { return c.kind !== 'session'; });
      var failN = calls.filter(function (c) { return c.failed; }).length;

      root.innerHTML = FV.head('调用日志', '最近的模型请求明细，含首词、耗时与失败原因', calls.length,
        FV.rangeSeg() +
        '<button class="chip' + (S.logProxyOnly ? ' on' : '') + '" id="fProxy">只看代理请求</button>' +
        '<button class="chip' + (onlyFail ? ' on' : '') + '" id="fFail"><svg><use href="#i-filter"/></svg>只看失败' +
          (failN && !onlyFail ? '<span class="dot-alert"></span>' : '') + '</button>') +

        '<div class="card">' +
          '<div class="card-h">' +
            '<h3>' + (onlyFail ? '失败请求' : '全部请求') + '</h3>' +
            '<span class="sub">按时间倒序，最多 120 条</span>' +
            '<div class="r legend">' +
              '<span><i style="background:#2f6bff"></i>CPA</span>' +
              '<span><i style="background:#6b3fd4"></i>CC Switch</span>' +
            '</div>' +
          '</div>' +
          '<div class="feed-head">' +
            '<span>时间</span><span>来源</span><span>模型 / 供应商</span>' +
            '<span>调用方 / 渠道</span><span style="text-align:right">首词</span>' +
            '<span style="text-align:right">总耗时</span><span style="text-align:center">结果</span>' +
          '</div>' +
          '<div class="rows">' + (calls.length ? calls.map(function (c) {
            var sess = c.kind === 'session';
            return '<div class="feed-row' + (c.failed ? ' fail' : '') + '">' +
              '<span class="tiny faint mono">' + w.FVChart.hhmm(c.ts) + '</span>' +
              '<span class="tag ' + (c.source === 'CPA' ? 'cpa' : 'ccs') + '">' +
                (c.source === 'CPA' ? 'CPA' : 'CCS') + '</span>' +
              '<div style="min-width:0">' +
                '<div class="ellip" style="font-weight:700;font-size:12.5px">' + esc(c.model || '—') + '</div>' +
                (c.error ? '<div class="ellip tiny" style="color:var(--red)">' + esc(c.error) + '</div>'
                         : '<div class="ellip tiny faint">' + esc(c.provider || '') + '</div>') +
              '</div>' +
              '<div style="min-width:0">' +
                '<div class="ellip tiny" style="font-weight:650">' + esc(c.channel || '—') + '</div>' +
                '<div class="ellip tiny ' + (sess ? 'faint' : 'muted') + '">' + esc(c.channel_key || '') + '</div>' +
              '</div>' +
              '<span class="tnum tiny" style="text-align:right" title="首词延迟">' +
                (c.ttft ? '⚡' + ms(c.ttft) : '<span class="faint">—</span>') + '</span>' +
              '<span class="tnum tiny muted" style="text-align:right" title="总耗时">' +
                (c.latency ? ms(c.latency) : '<span class="faint">—</span>') + '</span>' +
              (c.failed
                ? '<span class="tag bad" style="text-align:center">' + (c.status || 'ERR') + '</span>'
                : '<span class="tag ok" style="text-align:center">' + num(c.tokens || 0) + 'tk</span>') +
            '</div>';
          }).join('') : '<div class="empty">该时间段没有' + (onlyFail ? '失败' : '') + '记录</div>') + '</div>' +
          '<div class="tiny muted" style="margin-top:12px">' +
            '渠道标「会话回写」的是 CC Switch 从 Claude Code 会话文件同步的计费记录，' +
            '不经过代理转发，因此没有首词与耗时；标「代理转发」和 CPA 的记录才有真实计时。' +
            'CPA 侧不带客户端名，用 API 形态加掩码 key 区分调用方。</div>' +
        '</div>';

      FV.bindRange();
      D.getElementById('fFail').onclick = function () { S.logFail = !S.logFail; FV.render(); };
      D.getElementById('fProxy').onclick = function () { S.logProxyOnly = !S.logProxyOnly; FV.render(); };
    });
  };

  /* ---------------------------------------------------------- 设置 */
  FV.views.settings = function (root) {
    FV.get('/api/config').then(function (cfg) {
      root.innerHTML = FV.head('设置', '轮询间隔与监控项配置，保存后立即生效', cfg.services.length,
        '<button class="btn-dark" id="saveCfg"><svg><use href="#i-check"/></svg>保存配置</button>') +

        '<div class="grid g-3" style="margin-bottom:var(--gap-lg)">' +
          '<div class="card">' +
            '<div class="card-h"><h3>轮询间隔</h3></div>' +
            '<input type="number" id="cfgPoll" min="5" max="600" value="' + cfg.poll_interval + '">' +
            '<div class="tiny muted" style="margin-top:8px">秒。前端每 30 秒自动拉取一次快照。</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>监听地址</h3></div>' +
            '<div class="bignum sm">127.0.0.1<small>:' + cfg.port + '</small></div>' +
            '<div class="tiny muted" style="margin-top:8px">仅绑定回环地址，不要反代到公网。</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>数据来源</h3></div>' +
            '<div class="rows">' +
              '<div class="row-item" style="padding:8px 12px"><span class="tiny">CPA <code>usage.sqlite</code></span></div>' +
              '<div class="row-item" style="padding:8px 12px"><span class="tiny">CC Switch <code>cc-switch.db</code></span></div>' +
              '<div class="row-item" style="padding:8px 12px"><span class="tiny">Hermes <code>state.db</code></span></div>' +
            '</div>' +
            '<div class="tiny muted" style="margin-top:8px">全部只读打开，不写入原库。</div>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-h"><h3>监控项</h3>' +
            '<span class="sub">端口、健康检查路径与启停开关</span>' +
            '<div class="r"><button class="chip" id="addSvc">+ 新增</button></div></div>' +
          '<div class="rows" id="cfgRows">' + cfg.services.map(function (s, i) {
            return '<div class="row-item" style="grid-template-columns:minmax(0,1.1fr) 88px 108px auto auto;gap:var(--gap-md)" data-i="' + i + '">' +
              '<input type="text" data-f="name" value="' + esc(s.name) + '" placeholder="名称">' +
              '<input type="text" data-f="port" value="' + (s.port || '') + '" placeholder="端口">' +
              '<input type="text" data-f="health_path" value="' + esc(s.health_path || '') + '" placeholder="/health">' +
              '<label class="switch' + (s.controllable ? ' on' : '') + '" data-f="controllable">' +
                '<span class="track"></span><span class="tiny muted">可启停</span></label>' +
              '<button class="mini-btn danger" data-del="' + i + '"><svg><use href="#i-x"/></svg></button>' +
            '</div>';
          }).join('') + '</div>' +
          '<div class="tiny muted" style="margin-top:14px">' +
            '进程匹配规则 <code>match</code> 与启动命令 <code>start</code> 请直接编辑 ' +
            '<code>~/fleet-panel/config.json</code>，保存后重启服务生效。</div>' +
        '</div>';

      var draft = JSON.parse(JSON.stringify(cfg.services));

      function bindRows() {
        var rows = D.getElementById('cfgRows');
        Array.prototype.forEach.call(rows.querySelectorAll('input[data-f]'), function (inp) {
          inp.oninput = function () {
            var i = +inp.closest('[data-i]').dataset.i, f = inp.dataset.f;
            draft[i][f] = f === 'port' ? (inp.value ? +inp.value : null) : inp.value;
          };
        });
        Array.prototype.forEach.call(rows.querySelectorAll('.switch'), function (sw) {
          sw.onclick = function () {
            var i = +sw.closest('[data-i]').dataset.i;
            draft[i].controllable = !draft[i].controllable;
            sw.className = 'switch' + (draft[i].controllable ? ' on' : '');
          };
        });
        Array.prototype.forEach.call(rows.querySelectorAll('[data-del]'), function (b) {
          b.onclick = function () {
            var i = +b.dataset.del;
            if (!confirm('删除监控项「' + draft[i].name + '」？')) return;
            draft.splice(i, 1);
            reflow();
          };
        });
      }

      function reflow() {
        D.getElementById('cfgRows').innerHTML = draft.map(function (s, i) {
          return '<div class="row-item" style="grid-template-columns:minmax(0,1.1fr) 88px 108px auto auto;gap:var(--gap-md)" data-i="' + i + '">' +
            '<input type="text" data-f="name" value="' + esc(s.name) + '">' +
            '<input type="text" data-f="port" value="' + (s.port || '') + '">' +
            '<input type="text" data-f="health_path" value="' + esc(s.health_path || '') + '">' +
            '<label class="switch' + (s.controllable ? ' on' : '') + '"><span class="track"></span><span class="tiny muted">可启停</span></label>' +
            '<button class="mini-btn danger" data-del="' + i + '"><svg><use href="#i-x"/></svg></button>' +
          '</div>';
        }).join('');
        bindRows();
      }

      bindRows();

      D.getElementById('addSvc').onclick = function () {
        draft.push({ id: 'svc-' + Date.now(), name: '新监控项', group: '其他',
                     desc: '', port: null, health_path: '/', expect: [200], controllable: false });
        reflow();
      };

      D.getElementById('saveCfg').onclick = function () {
        FV.post('/api/config', {
          poll_interval: +D.getElementById('cfgPoll').value,
          services: draft
        }).then(function (r) {
          FV.toast(r.ok ? '配置已保存' : '保存失败', r.ok ? 'good' : 'bad');
          return FV.refreshData();
        });
      };
    });
  };

  FV.boot();
})(window, document);
