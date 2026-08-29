/* FleetView 图表 —— 纯 canvas，无外部依赖，离线可用 */
(function (w) {
  'use strict';

  /* 主题色从 CSS 变量实时读取，切换主题后重绘即可跟随 */
  function cv_(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || '').trim() || fallback;
  }
  function T() {
    return {
      ink: cv_('--ink', '#0b0e13'),
      muted: cv_('--muted', '#7c8899'),
      line: cv_('--line', '#e6eaef'),
      faint: cv_('--faint', '#a8b2bf'),
      track: cv_('--track', '#e6eaef'),
      red: cv_('--red', '#f5333f'),
      green: cv_('--green', '#22b04b'),
      amber: cv_('--amber', '#ff9500'),
      blue: cv_('--blue', '#2f6bff'),
      dark: document.documentElement.getAttribute('data-theme') === 'dark'
    };
  }

  function hidpi(cv, h) {
    var dpr = w.devicePixelRatio || 1;
    var cssW = cv.clientWidth || cv.parentNode.clientWidth || 600;
    cv.style.height = h + 'px';
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(h * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, h);
    return { g: g, W: cssW, H: h };
  }

  function roundRect(g, x, y, wd, ht, r) {
    r = Math.min(r, wd / 2, ht / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + wd, y, x + wd, y + ht, r);
    g.arcTo(x + wd, y + ht, x, y + ht, r);
    g.arcTo(x, y + ht, x, y, r);
    g.arcTo(x, y, x + wd, y, r);
    g.closePath();
  }

  function hhmm(ts) {
    var d = new Date(ts * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function mdhh(ts) {
    var d = new Date(ts * 1000);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + 'h';
  }

  /* ---------------------------------------------- 调用量柱 + 首词折线 */
  function callsChart(cv, points, opts) {
    opts = opts || {};
    var H = opts.height || 250, PL = 46, PR = 48, PT = 16, PB = 26;
    var d = hidpi(cv, H), g = d.g, W = d.W, t = T();
    var iw = W - PL - PR, ih = H - PT - PB;
    if (!points.length || iw < 20) return;

    var maxC = Math.max(1, Math.max.apply(null, points.map(function (p) { return p.calls; })));
    var ttfts = points.map(function (p) { return p.ttft_p50; }).filter(function (v) { return v; });
    var maxT = ttfts.length ? Math.max.apply(null, ttfts) : 0;

    // 网格
    g.strokeStyle = t.line; g.lineWidth = 1; g.setLineDash([3, 5]);
    g.font = '600 10.5px -apple-system, sans-serif'; g.textBaseline = 'middle';
    for (var i = 0; i <= 4; i++) {
      var y = PT + ih - (ih * i / 4);
      g.beginPath(); g.moveTo(PL, y + .5); g.lineTo(PL + iw, y + .5); g.stroke();
      g.fillStyle = t.faint; g.textAlign = 'right';
      g.fillText(Math.round(maxC * i / 4), PL - 9, y);
      if (maxT) {
        g.fillStyle = t.red; g.globalAlpha = .6; g.textAlign = 'left';
        g.fillText(((maxT * i / 4) / 1000).toFixed(1) + 's', PL + iw + 9, y);
        g.globalAlpha = 1;
      }
    }
    g.setLineDash([]);

    // 柱
    var bw = iw / points.length, pad = Math.min(3, bw * .22);
    points.forEach(function (p, k) {
      var x = PL + k * bw + pad / 2, bwid = Math.max(1.5, bw - pad);
      if (p.calls > 0) {
        var ht = Math.max(2, ih * p.calls / maxC), y = PT + ih - ht;
        var ok = p.calls - p.fail;
        if (ok > 0) {
          var hOk = ih * ok / maxC;
          var gr = g.createLinearGradient(0, PT + ih - hOk, 0, PT + ih);
          gr.addColorStop(0, t.blue); gr.addColorStop(1, t.dark ? '#26324a' : '#dbe6ff');
          g.fillStyle = gr;
          roundRect(g, x, PT + ih - hOk, bwid, hOk, Math.min(4, bwid / 2)); g.fill();
        }
        if (p.fail > 0) {
          var hF = ih * p.fail / maxC, yF = PT + ih - ht;
          g.fillStyle = t.red;
          roundRect(g, x, yF, bwid, hF, Math.min(4, bwid / 2)); g.fill();
        }
      }
    });

    // 首词折线
    if (maxT) {
      var pts = [];
      points.forEach(function (p, k) {
        if (p.ttft_p50) pts.push([PL + k * bw + bw / 2, PT + ih - ih * p.ttft_p50 / maxT]);
      });
      if (pts.length > 1) {
        g.strokeStyle = t.red; g.lineWidth = 2.2;
        g.lineJoin = 'round'; g.lineCap = 'round';
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
        for (var j = 1; j < pts.length; j++) {
          var a = pts[j - 1], b = pts[j], mx = (a[0] + b[0]) / 2;
          g.bezierCurveTo(mx, a[1], mx, b[1], b[0], b[1]);
        }
        g.stroke();
      }
      pts.forEach(function (p) {
        g.fillStyle = cv_('--card', '#fff'); g.strokeStyle = t.red; g.lineWidth = 2;
        g.beginPath(); g.arc(p[0], p[1], 2.8, 0, 6.284); g.fill(); g.stroke();
      });
    }

    // x 轴
    g.fillStyle = t.faint; g.textAlign = 'center'; g.textBaseline = 'top';
    var step = Math.max(1, Math.round(points.length / 7));
    var wide = (points[points.length - 1].t - points[0].t) > 86400 * 1.2;
    points.forEach(function (p, k) {
      if (k % step === 0) g.fillText(wide ? mdhh(p.t) : hhmm(p.t), PL + k * bw + bw / 2, PT + ih + 8);
    });

    // 交互
    cv.onmousemove = function (e) {
      var r = cv.getBoundingClientRect();
      var k = Math.floor((e.clientX - r.left - PL) / bw);
      if (k < 0 || k >= points.length) return w.FVtip.hide();
      var p = points[k];
      w.FVtip.show(e.clientX, e.clientY,
        (wide ? mdhh(p.t) : hhmm(p.t)) + '\n调用 ' + p.calls + ' 次  失败 ' + p.fail +
        '\nCPA ' + p.cpa + ' · CC Switch ' + p.ccs +
        (p.ttft_p50 ? '\n首词 p50 ' + (p.ttft_p50 / 1000).toFixed(2) + 's' : ''));
    };
    cv.onmouseleave = function () { w.FVtip.hide(); };
  }

  /* ---------------------------------------------- 迷你 sparkline */
  function spark(cv, values, color, height) {
    var H = height || 26;
    var d = hidpi(cv, H), g = d.g, W = d.W;
    var vs = values.filter(function (v) { return v !== null && v !== undefined; });
    if (vs.length < 2) {
      g.strokeStyle = T().line; g.lineWidth = 2; g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      return;
    }
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    var rng = mx - mn || 1, n = values.length;
    var pts = [];
    values.forEach(function (v, i) {
      if (v === null || v === undefined) return;
      pts.push([i / (n - 1) * W, H - 3 - (H - 6) * (v - mn) / rng]);
    });
    var gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, color + '38'); gr.addColorStop(1, color + '00');
    g.beginPath(); g.moveTo(pts[0][0], H);
    pts.forEach(function (p) { g.lineTo(p[0], p[1]); });
    g.lineTo(pts[pts.length - 1][0], H); g.closePath();
    g.fillStyle = gr; g.fill();

    g.strokeStyle = color; g.lineWidth = 1.8; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); });
    g.stroke();

    var last = pts[pts.length - 1];
    g.fillStyle = color;
    g.beginPath(); g.arc(last[0], last[1], 2.2, 0, 6.284); g.fill();
  }

  /* ---------------------------------------------- 甜甜圈 */
  function donut(cv, slices, opts) {
    opts = opts || {};
    var H = opts.height || 190;
    var d = hidpi(cv, H), g = d.g, W = d.W, t = T();
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 6, r0 = R * .66;
    var total = slices.reduce(function (a, s) { return a + s.v; }, 0);
    if (!total) {
      g.strokeStyle = t.line; g.lineWidth = R - r0;
      g.beginPath(); g.arc(cx, cy, (R + r0) / 2, 0, 6.284); g.stroke();
      return;
    }
    var a0 = -Math.PI / 2;
    slices.forEach(function (s) {
      if (!s.v) return;
      var a1 = a0 + 6.28318 * s.v / total;
      g.beginPath();
      g.arc(cx, cy, R, a0 + .012, a1 - .012);
      g.arc(cx, cy, r0, a1 - .012, a0 + .012, true);
      g.closePath();
      g.fillStyle = s.c; g.fill();
      a0 = a1;
    });
    g.fillStyle = t.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 21px -apple-system, sans-serif';
    g.fillText(opts.center != null ? opts.center : total, cx, cy - 5);
    g.font = '650 10px -apple-system, sans-serif'; g.fillStyle = t.muted;
    g.fillText(opts.label || '', cx, cy + 12);
  }

  /* ---------------------------------------------- 横向条形 */
  function hbars(cv, items, opts) {
    opts = opts || {};
    var rowH = 30, H = Math.max(40, items.length * rowH + 8);
    var d = hidpi(cv, H), g = d.g, W = d.W, t = T();
    var LW = opts.labelWidth || 168, VW = 62;
    var iw = W - LW - VW;
    if (!items.length) return;
    var mx = Math.max.apply(null, items.map(function (i) { return i.v; })) || 1;
    items.forEach(function (it, k) {
      var y = k * rowH + 6;
      g.font = '650 12px -apple-system, sans-serif'; g.textBaseline = 'middle';
      g.fillStyle = t.ink; g.textAlign = 'left';
      var name = it.k.length > 26 ? it.k.slice(0, 25) + '…' : it.k;
      g.fillText(name, 0, y + 9);
      g.fillStyle = t.track;
      roundRect(g, LW, y + 3, iw, 12, 6); g.fill();
      var bw = Math.max(3, iw * it.v / mx);
      var gr = g.createLinearGradient(LW, 0, LW + bw, 0);
      gr.addColorStop(0, it.c0 || '#8fb6ff'); gr.addColorStop(1, it.c1 || '#2f6bff');
      g.fillStyle = gr;
      roundRect(g, LW, y + 3, bw, 12, 6); g.fill();
      g.fillStyle = t.ink; g.textAlign = 'right';
      g.font = '750 12px -apple-system, sans-serif';
      g.fillText(it.label != null ? it.label : it.v, W, y + 9);
    });
  }

  /* ---------------------------------------------- 半环仪表 */
  function gauge(cv, value, cap) {
    var box = cv.parentNode.clientWidth || 118;
    var dpr = w.devicePixelRatio || 1;
    cv.width = Math.round(box * dpr); cv.height = Math.round(box * dpr);
    cv.style.width = box + 'px'; cv.style.height = box + 'px';
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, box, box);

    var cx = box / 2, cy = box / 2, R = box / 2 - 8, lw = 11;
    var a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.lineCap = 'round';
    g.strokeStyle = T().track; g.lineWidth = lw;
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();

    var frac = Math.max(0, Math.min(1, cap ? value / cap : 0));
    if (frac > 0.001) {
      var end = a0 + (a1 - a0) * frac;
      var gr = g.createLinearGradient(0, 0, box, box);
      var tt = T();
      if (frac < .5) { gr.addColorStop(0, '#7fdc9c'); gr.addColorStop(1, tt.green); }
      else if (frac < .8) { gr.addColorStop(0, '#ffd08a'); gr.addColorStop(1, tt.amber); }
      else { gr.addColorStop(0, '#ff8a4c'); gr.addColorStop(1, tt.red); }
      g.strokeStyle = gr; g.lineWidth = lw;
      g.beginPath(); g.arc(cx, cy, R, a0, end); g.stroke();
    }
  }

  /* ---------------------------------------------- 速率条带 */
  function bars(cv, values, height) {
    var H = height || 54;
    var d = hidpi(cv, H), g = d.g, W = d.W;
    var n = Math.max(1, values.length);
    var slots = 90;
    var bw = W / slots;
    var mx = Math.max(1, Math.max.apply(null, values.concat([1]))), t = T();
    var start = slots - n;
    values.forEach(function (v, i) {
      var x = (start + i) * bw;
      var ht = v ? Math.max(2.5, (H - 4) * v / mx) : 1.5;
      g.fillStyle = v ? (v >= mx * .75 ? t.red : v >= mx * .4 ? t.amber : t.blue) : t.track;
      roundRect(g, x + bw * .18, H - ht, Math.max(1.5, bw * .64), ht, Math.min(2.5, bw / 3));
      g.fill();
    });
    for (var k = 0; k < start; k++) {
      g.fillStyle = t.track;
      roundRect(g, k * bw + bw * .18, H - 1.5, Math.max(1.5, bw * .64), 1.5, .7);
      g.fill();
    }
  }

  w.FVChart = { callsChart: callsChart, spark: spark, donut: donut, hbars: hbars,
                gauge: gauge, bars: bars, hhmm: hhmm };
})(window);
