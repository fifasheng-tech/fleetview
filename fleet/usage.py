"""调用量与首词(TTFT)聚合 —— 数据全部来自三个真实落库的数据源。

CPA        ~/cpa-manager-plus/data/usage.sqlite  usage_events.ttft_ms
CC Switch  ~/.cc-switch/cc-switch.db             proxy_request_logs.first_token_ms
Hermes     ~/.hermes/state.db                    session_model_usage.api_call_count
"""

import os
import sqlite3
import time

CPA_DB = os.path.expanduser("~/cpa-manager-plus/data/usage.sqlite")
CCS_DB = os.path.expanduser("~/.cc-switch/cc-switch.db")
HERMES_DB = os.path.expanduser("~/.hermes/state.db")

RANGES = {"1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "30d": 2592000}


def _open(path):
    if not os.path.exists(path):
        return None
    try:
        con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=3.0)
        con.row_factory = sqlite3.Row
        return con
    except sqlite3.Error:
        return None


def _rows(path, sql, args=()):
    con = _open(path)
    if con is None:
        return []
    try:
        return [dict(r) for r in con.execute(sql, args).fetchall()]
    except sqlite3.Error:
        return []
    finally:
        con.close()


def pct(values, p):
    """百分位。values 需已排序。"""
    if not values:
        return None
    k = (len(values) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return round(values[lo] + (values[hi] - values[lo]) * (k - lo))


def _stats(values):
    vs = sorted(v for v in values if v is not None and v > 0)
    if not vs:
        return {"n": 0, "avg": None, "p50": None, "p90": None, "p95": None, "min": None, "max": None}
    return {
        "n": len(vs),
        "avg": round(sum(vs) / len(vs)),
        "p50": pct(vs, 0.50),
        "p90": pct(vs, 0.90),
        "p95": pct(vs, 0.95),
        "min": vs[0],
        "max": vs[-1],
    }


def _since(rng):
    return int(time.time()) - RANGES.get(rng, 86400)


APP_CN = {
    "claude": "Claude Code", "codex": "Codex CLI",
    "claude-desktop": "Claude Desktop", "cline": "Cline",
}


def cpa_channel(path, source):
    """CPA 侧没有客户端名，用 API 形态 + 掩码 key 区分调用方。"""
    p = path or ""
    if "/v1/messages" in p:
        fam = "Anthropic 格式"
    elif "chat/completions" in p:
        fam = "OpenAI 格式"
    elif "/v1/completions" in p:
        fam = "Completions"
    else:
        fam = p or "未知"
    key = (source or "").replace("m:", "")
    return fam, key


# 这些 data_source 不是真的经过代理，而是从日志 / 会话记录同步进库，库里没有计时。
SESSION_SOURCES = ("session_log", "codex_session")


def ccs_channel(app_type, data_source):
    name = APP_CN.get(app_type, app_type or "未知")
    if data_source == "session_log":
        return name, "会话回写"
    if data_source == "codex_session":
        return name, "Codex 会话"
    return name, "代理转发"


def pretty_provider(name):
    """供应商展示名：去掉冗长前缀，给内部标识起中文名。"""
    if not name:
        return "未知"
    if name == "_session":
        return "会话日志回写"
    for prefix in ("openai-compatible-", "openai-compat-"):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


# ---------------------------------------------------------------- CPA

def cpa_events(rng="24h", limit=None):
    since_ms = _since(rng) * 1000
    sql = """select timestamp_ms, provider, model, requested_model, endpoint,
                    ttft_ms, latency_ms, failed, fail_status_code, fail_summary,
                    total_tokens, input_tokens, output_tokens, auth_index,
                    path, source
             from usage_events where timestamp_ms > ? order by timestamp_ms desc"""
    if limit:
        sql += " limit %d" % int(limit)
    return _rows(CPA_DB, sql, (since_ms,))


def cpa_summary(rng="24h"):
    ev = cpa_events(rng)
    ok = [e for e in ev if not e["failed"]]
    return {
        "source": "CPA Manager Plus",
        "calls": len(ev),
        "failed": sum(1 for e in ev if e["failed"]),
        "tokens": sum(e["total_tokens"] or 0 for e in ev),
        "ttft": _stats([e["ttft_ms"] for e in ok]),
        "latency": _stats([e["latency_ms"] for e in ok]),
    }


# ---------------------------------------------------------------- CC Switch

def ccs_events(rng="24h", limit=None):
    since = _since(rng)
    sql = """select created_at, provider_id, app_type, model, request_model,
                    latency_ms, first_token_ms, duration_ms, status_code, error_message,
                    input_tokens, output_tokens, cache_read_tokens, is_streaming,
                    total_cost_usd, data_source
             from proxy_request_logs where created_at > ? order by created_at desc"""
    if limit:
        sql += " limit %d" % int(limit)
    return _rows(CCS_DB, sql, (since,))


def ccs_summary(rng="24h"):
    ev = ccs_events(rng)
    ok = [e for e in ev if (e["status_code"] or 0) < 400]
    return {
        "source": "CC Switch",
        "calls": len(ev),
        "failed": sum(1 for e in ev if (e["status_code"] or 0) >= 400),
        "tokens": sum((e["input_tokens"] or 0) + (e["output_tokens"] or 0) for e in ev),
        "ttft": _stats([e["first_token_ms"] for e in ok]),
        "latency": _stats([e["latency_ms"] for e in ok]),
    }


def ccs_providers():
    """当前生效的供应商 + 健康状态。"""
    provs = _rows(CCS_DB, """select p.id, p.app_type, p.name, p.is_current, p.in_failover_queue,
                                    p.provider_type, p.category
                             from providers p order by p.app_type, p.sort_index""")
    health = {(h["provider_id"], h["app_type"]): h for h in
              _rows(CCS_DB, "select * from provider_health")}
    out = []
    for p in provs:
        h = health.get((p["id"], p["app_type"]), {})
        out.append({
            "id": p["id"], "app": p["app_type"], "name": p["name"],
            "current": bool(p["is_current"]), "failover": bool(p["in_failover_queue"]),
            "healthy": bool(h.get("is_healthy", 1)),
            "failures": h.get("consecutive_failures", 0),
            "last_error": h.get("last_error"),
            "last_success": h.get("last_success_at"),
        })
    return out


# ---------------------------------------------------------------- Hermes

def hermes_summary():
    r = _rows(HERMES_DB, """select count(distinct session_id) sessions,
                                   coalesce(sum(api_call_count),0) calls,
                                   coalesce(sum(input_tokens+output_tokens),0) tokens,
                                   max(last_seen) last_seen
                            from session_model_usage""")
    base = r[0] if r else {"sessions": 0, "calls": 0, "tokens": 0, "last_seen": None}
    base["source"] = "Hermes"
    return base


def hermes_models(limit=12):
    return _rows(HERMES_DB, """select model, billing_provider,
                                      sum(api_call_count) calls,
                                      sum(input_tokens+output_tokens) tokens,
                                      max(last_seen) last_seen
                               from session_model_usage
                               group by model, billing_provider
                               order by calls desc limit ?""", (limit,))


def hermes_recent_sessions(limit=12):
    return _rows(HERMES_DB, """select id, source, model, started_at, ended_at, end_reason,
                                      message_count, tool_call_count,
                                      input_tokens, output_tokens, billing_provider
                               from sessions order by started_at desc limit ?""", (limit,))


# ---------------------------------------------------------------- 合并视图

def timeseries(rng="24h", buckets=48):
    """调用量 + 首词 时间序列，CPA 与 CC Switch 合并分桶。"""
    span = RANGES.get(rng, 86400)
    now = int(time.time())
    start = now - span
    width = max(1, span // buckets)
    slots = [{"t": start + i * width, "cpa": 0, "ccs": 0, "fail": 0,
              "_ttft": []} for i in range(buckets)]

    def put(ts, key, failed, ttft):
        i = (ts - start) // width
        if 0 <= i < buckets:
            slots[i][key] += 1
            if failed:
                slots[i]["fail"] += 1
            elif ttft:
                slots[i]["_ttft"].append(ttft)

    for e in cpa_events(rng):
        put(e["timestamp_ms"] // 1000, "cpa", e["failed"], e["ttft_ms"])
    for e in ccs_events(rng):
        put(e["created_at"], "ccs", (e["status_code"] or 0) >= 400, e["first_token_ms"])

    for s in slots:
        vs = sorted(s.pop("_ttft"))
        s["calls"] = s["cpa"] + s["ccs"]
        s["ttft_p50"] = pct(vs, 0.5)
    return {"range": rng, "bucket_seconds": width, "points": slots}


def by_model(rng="24h", limit=15):
    """按模型聚合调用量与首词，两个来源统一口径。"""
    agg = {}

    def slot(model, src):
        return agg.setdefault(model, {"model": model, "calls": 0, "failed": 0,
                                      "tokens": 0, "sources": set(), "_ttft": [],
                                      "_lat": []})

    for e in cpa_events(rng):
        m = slot(e["model"] or "unknown", "cpa")
        m["calls"] += 1
        m["sources"].add("CPA")
        m["tokens"] += e["total_tokens"] or 0
        if e["failed"]:
            m["failed"] += 1
        else:
            m["_ttft"].append(e["ttft_ms"])
            m["_lat"].append(e["latency_ms"])
    for e in ccs_events(rng):
        m = slot(e["model"] or "unknown", "ccs")
        m["calls"] += 1
        m["sources"].add("CC Switch")
        m["tokens"] += (e["input_tokens"] or 0) + (e["output_tokens"] or 0)
        if (e["status_code"] or 0) >= 400:
            m["failed"] += 1
        else:
            m["_ttft"].append(e["first_token_ms"])
            m["_lat"].append(e["latency_ms"])

    out = []
    for m in agg.values():
        m["ttft"] = _stats(m.pop("_ttft"))
        m["latency"] = _stats(m.pop("_lat"))
        m["sources"] = sorted(m["sources"])
        m["success_rate"] = round(100.0 * (m["calls"] - m["failed"]) / m["calls"], 1) if m["calls"] else 0.0
        out.append(m)
    out.sort(key=lambda x: -x["calls"])
    return out[:limit]


def by_provider(rng="24h"):
    agg = {}
    for e in cpa_events(rng):
        p = e["provider"] or "unknown"
        d = agg.setdefault(p, {"provider": p, "source": "CPA", "calls": 0,
                               "failed": 0, "_ttft": []})
        d["calls"] += 1
        if e["failed"]:
            d["failed"] += 1
        else:
            d["_ttft"].append(e["ttft_ms"])
    names = {p["id"]: p["name"] for p in ccs_providers()}
    for e in ccs_events(rng):
        pid = e["provider_id"] or "unknown"
        p = names.get(pid, pid)
        d = agg.setdefault("ccs:" + p, {"provider": p, "source": "CC Switch",
                                        "calls": 0, "failed": 0, "_ttft": []})
        d["calls"] += 1
        if (e["status_code"] or 0) >= 400:
            d["failed"] += 1
        else:
            d["_ttft"].append(e["first_token_ms"])
    out = []
    for d in agg.values():
        d["ttft"] = _stats(d.pop("_ttft"))
        d["success_rate"] = round(100.0 * (d["calls"] - d["failed"]) / d["calls"], 1) if d["calls"] else 0.0
        d["raw_provider"] = d["provider"]
        d["provider"] = pretty_provider(d["provider"])
        out.append(d)
    out.sort(key=lambda x: -x["calls"])
    return out


def ttft_histogram(rng="24h"):
    """首词延迟分布直方图，单位毫秒。"""
    edges = [0, 200, 500, 1000, 2000, 4000, 8000, 15000, 30000]
    labels = ["<0.2s", "0.2–0.5s", "0.5–1s", "1–2s", "2–4s", "4–8s", "8–15s", "15–30s", ">30s"]
    counts = [0] * len(labels)
    vals = []
    for e in cpa_events(rng):
        if not e["failed"] and e["ttft_ms"]:
            vals.append(e["ttft_ms"])
    for e in ccs_events(rng):
        if (e["status_code"] or 0) < 400 and e["first_token_ms"]:
            vals.append(e["first_token_ms"])
    for v in vals:
        i = len(edges) - 1
        for j in range(1, len(edges)):
            if v < edges[j]:
                i = j - 1
                break
        counts[i] += 1
    return {"labels": labels, "counts": counts, "stats": _stats(vals)}


def recent_calls(rng="24h", limit=60, only_fail=False, proxy_only=False):
    out = []
    for e in cpa_events(rng, limit=400):
        failed = bool(e["failed"])
        if only_fail and not failed:
            continue
        ch, key = cpa_channel(e.get("path"), e.get("source"))
        out.append({
            "ts": e["timestamp_ms"] // 1000, "source": "CPA",
            "model": e["model"], "provider": pretty_provider(e["provider"]),
            "channel": ch, "channel_key": key, "kind": "proxy",
            "ttft": e["ttft_ms"], "latency": e["latency_ms"],
            "tokens": e["total_tokens"], "failed": failed,
            "status": e["fail_status_code"],
            "error": (e["fail_summary"] or "")[:160] if failed else "",
        })
    names = {p["id"]: p["name"] for p in ccs_providers()}
    for e in ccs_events(rng, limit=400):
        failed = (e["status_code"] or 0) >= 400
        if only_fail and not failed:
            continue
        if proxy_only and e.get("data_source") in SESSION_SOURCES:
            continue
        ch, key = ccs_channel(e.get("app_type"), e.get("data_source"))
        out.append({
            "ts": e["created_at"], "source": "CC Switch",
            "model": e["model"],
            "provider": pretty_provider(names.get(e["provider_id"], e["provider_id"])),
            "channel": ch, "channel_key": key,
            "kind": "session" if e.get("data_source") in SESSION_SOURCES else "proxy",
            "ttft": e["first_token_ms"],
            "latency": e["latency_ms"] or e.get("duration_ms"),
            "tokens": (e["input_tokens"] or 0) + (e["output_tokens"] or 0),
            "failed": failed, "status": e["status_code"],
            "error": (e["error_message"] or "")[:160] if failed else "",
        })
    out.sort(key=lambda x: -x["ts"])
    return out[:limit]


def cursor():
    """当前游标：CPA 用自增 id，CC Switch 用 rowid。"""
    a = _rows(CPA_DB, "select coalesce(max(id),0) v from usage_events")
    b = _rows(CCS_DB, "select coalesce(max(rowid),0) v from proxy_request_logs")
    return {"cpa": a[0]["v"] if a else 0, "ccs": b[0]["v"] if b else 0}


def delta(cur, limit=60):
    """取游标之后的新调用，用于实时推流。"""
    out = []
    rows = _rows(CPA_DB, """select id, timestamp_ms, provider, model, ttft_ms, latency_ms,
                                   failed, fail_status_code, fail_summary, total_tokens,
                                   path, source
                            from usage_events where id > ? order by id limit ?""",
                 (cur.get("cpa", 0), limit))
    for e in rows:
        ch, key = cpa_channel(e["path"], e["source"])
        out.append({
            "cursor_id": e["id"], "ts": e["timestamp_ms"] // 1000, "source": "CPA",
            "model": e["model"], "provider": pretty_provider(e["provider"]),
            "channel": ch, "channel_key": key, "kind": "proxy",
            "ttft": e["ttft_ms"], "latency": e["latency_ms"],
            "tokens": e["total_tokens"], "failed": bool(e["failed"]),
            "status": e["fail_status_code"],
            "error": (e["fail_summary"] or "")[:140] if e["failed"] else "",
        })

    names = {p["id"]: p["name"] for p in ccs_providers()}
    rows = _rows(CCS_DB, """select rowid rid, created_at, provider_id, model, latency_ms,
                                   first_token_ms, duration_ms, status_code, error_message,
                                   input_tokens, output_tokens, app_type, data_source
                            from proxy_request_logs where rowid > ? order by rowid limit ?""",
                 (cur.get("ccs", 0), limit))
    for e in rows:
        failed = (e["status_code"] or 0) >= 400
        ch, key = ccs_channel(e["app_type"], e["data_source"])
        out.append({
            "cursor_id": e["rid"], "ts": e["created_at"], "source": "CC Switch",
            "model": e["model"],
            "provider": pretty_provider(names.get(e["provider_id"], e["provider_id"])),
            "channel": ch, "channel_key": key,
            "kind": "session" if e["data_source"] in SESSION_SOURCES else "proxy",
            "ttft": e["first_token_ms"],
            "latency": e["latency_ms"] or e["duration_ms"],
            "tokens": (e["input_tokens"] or 0) + (e["output_tokens"] or 0),
            "failed": failed, "status": e["status_code"],
            "error": (e["error_message"] or "")[:140] if failed else "",
        })
    out.sort(key=lambda x: x["ts"])
    return out


def live_stats():
    """实时窗口指标：近 1/5/15 分钟调用量与首词。"""
    now = int(time.time())

    def window(sec):
        ms_since = (now - sec) * 1000
        a = _rows(CPA_DB, """select count(*) n, sum(failed) f,
                                    avg(nullif(ttft_ms,0)) t, sum(total_tokens) tk
                             from usage_events where timestamp_ms > ?""", (ms_since,))
        b = _rows(CCS_DB, """select count(*) n,
                                    sum(case when status_code>=400 then 1 else 0 end) f,
                                    avg(nullif(first_token_ms,0)) t,
                                    sum(input_tokens+output_tokens) tk
                             from proxy_request_logs where created_at > ?""", (now - sec,))
        a = a[0] if a else {}
        b = b[0] if b else {}
        n = (a.get("n") or 0) + (b.get("n") or 0)
        ts = [x for x in (a.get("t"), b.get("t")) if x]
        return {
            "calls": n,
            "failed": (a.get("f") or 0) + (b.get("f") or 0),
            "tokens": (a.get("tk") or 0) + (b.get("tk") or 0),
            "ttft": round(sum(ts) / len(ts)) if ts else None,
            "per_min": round(60.0 * n / sec, 1),
        }

    return {"at": now, "m1": window(60), "m5": window(300), "m15": window(900)}


def overview(rng="24h"):
    cpa, ccs, her = cpa_summary(rng), ccs_summary(rng), hermes_summary()
    calls = cpa["calls"] + ccs["calls"]
    failed = cpa["failed"] + ccs["failed"]
    hist = ttft_histogram(rng)
    return {
        "range": rng,
        "calls": calls,
        "failed": failed,
        "success_rate": round(100.0 * (calls - failed) / calls, 1) if calls else 100.0,
        "tokens": cpa["tokens"] + ccs["tokens"],
        "ttft": hist["stats"],
        "sources": [cpa, ccs, her],
    }


# ---------------------------------------------------------------- 账号池

def accounts(rng="24h"):
    """CPA 号池按 auth_index 维度的健康度。"""
    since_ms = _since(rng) * 1000
    rows = _rows(CPA_DB, """select auth_index, auth_label_snapshot, auth_provider_snapshot,
                                   account_snapshot, provider,
                                   count(*) n, sum(failed) f,
                                   sum(total_tokens) tk,
                                   max(timestamp_ms) last_ms
                            from usage_events
                            where timestamp_ms > ? and auth_index is not null
                            group by auth_index order by n desc""", (since_ms,))
    out = []
    for r in rows:
        ttft = _rows(CPA_DB, """select ttft_ms from usage_events
                                where auth_index = ? and timestamp_ms > ?
                                  and failed = 0 and ttft_ms > 0""",
                     (r["auth_index"], since_ms))
        n, f = r["n"], r["f"] or 0
        rate = round(100.0 * (n - f) / n, 1) if n else 0.0
        out.append({
            "key": r["auth_index"],
            "short": (r["auth_index"] or "")[:8],
            "label": r["auth_label_snapshot"] or r["account_snapshot"] or "",
            "provider": pretty_provider(r["auth_provider_snapshot"] or r["provider"]),
            "calls": n, "failed": f, "success_rate": rate,
            "tokens": r["tk"] or 0,
            "last_seen": (r["last_ms"] or 0) // 1000,
            "ttft": _stats([x["ttft_ms"] for x in ttft]),
            "health": "dead" if rate == 0 and n >= 3 else
                      ("degraded" if rate < 70 else
                       ("watch" if rate < 92 else "ok")),
        })
    return out


# ---------------------------------------------------------------- 错误

ERR_HINT = {
    429: "上游限流，触发速率上限",
    500: "上游内部错误或连接被取消",
    502: "网关无法从上游取得有效响应",
    503: "上游服务繁忙 / 鉴权服务不可用",
    504: "上游响应超时",
    400: "请求被上游判定为非法",
    401: "凭据无效或已过期",
    403: "无访问权限或被风控拦截",
}


def errors(rng="24h"):
    since_ms = _since(rng) * 1000
    since = _since(rng)

    by_status = {}
    by_kind = {}
    by_model = {}
    by_provider = {}

    for r in _rows(CPA_DB, """select fail_status_code sc, header_error_kind kind,
                                     header_error_code code, model, provider,
                                     fail_summary, timestamp_ms
                              from usage_events
                              where failed = 1 and timestamp_ms > ?""", (since_ms,)):
        sc = r["sc"] or 0
        d = by_status.setdefault(sc, {"status": sc, "n": 0,
                                      "hint": ERR_HINT.get(sc, "未分类失败"),
                                      "sample": ""})
        d["n"] += 1
        if not d["sample"] and r["fail_summary"]:
            d["sample"] = r["fail_summary"][:180]
        k = r["kind"] or "unclassified"
        by_kind[k] = by_kind.get(k, 0) + 1
        by_model[r["model"] or "unknown"] = by_model.get(r["model"] or "unknown", 0) + 1
        p = pretty_provider(r["provider"])
        by_provider[p] = by_provider.get(p, 0) + 1

    names = {p["id"]: p["name"] for p in ccs_providers()}
    for r in _rows(CCS_DB, """select status_code sc, model, provider_id, error_message
                              from proxy_request_logs
                              where created_at > ? and status_code >= 400""", (since,)):
        sc = r["sc"] or 0
        d = by_status.setdefault(sc, {"status": sc, "n": 0,
                                      "hint": ERR_HINT.get(sc, "未分类失败"),
                                      "sample": ""})
        d["n"] += 1
        if not d["sample"] and r["error_message"]:
            d["sample"] = r["error_message"][:180]
        by_model[r["model"] or "unknown"] = by_model.get(r["model"] or "unknown", 0) + 1
        p = pretty_provider(names.get(r["provider_id"], r["provider_id"]))
        by_provider[p] = by_provider.get(p, 0) + 1

    def top(d, key):
        return sorted([{key: k, "n": v} for k, v in d.items()],
                      key=lambda x: -x["n"])[:10]

    st = sorted(by_status.values(), key=lambda x: -x["n"])
    return {
        "total": sum(x["n"] for x in st),
        "by_status": st,
        "by_kind": top(by_kind, "kind"),
        "by_model": top(by_model, "model"),
        "by_provider": top(by_provider, "provider"),
    }


# ---------------------------------------------------------------- token

def tokens(rng="24h"):
    since_ms = _since(rng) * 1000
    since = _since(rng)

    a = _rows(CPA_DB, """select coalesce(sum(input_tokens),0) inp,
                                coalesce(sum(output_tokens),0) outp,
                                coalesce(sum(reasoning_tokens),0) reason,
                                coalesce(sum(cache_read_tokens),0) cread,
                                coalesce(sum(cache_creation_tokens),0) cwrite
                         from usage_events where timestamp_ms > ?""", (since_ms,))
    b = _rows(CCS_DB, """select coalesce(sum(input_tokens),0) inp,
                                coalesce(sum(output_tokens),0) outp,
                                coalesce(sum(cache_read_tokens),0) cread,
                                coalesce(sum(cache_creation_tokens),0) cwrite
                         from proxy_request_logs where created_at > ?""", (since,))
    a = a[0] if a else {}
    b = b[0] if b else {}
    total = {
        "input": (a.get("inp") or 0) + (b.get("inp") or 0),
        "output": (a.get("outp") or 0) + (b.get("outp") or 0),
        "reasoning": a.get("reason") or 0,
        "cache_read": (a.get("cread") or 0) + (b.get("cread") or 0),
        "cache_write": (a.get("cwrite") or 0) + (b.get("cwrite") or 0),
    }
    total["all"] = total["input"] + total["output"]
    billed = total["input"] + total["cache_read"]
    total["cache_hit_rate"] = round(100.0 * total["cache_read"] / billed, 1) if billed else 0.0

    per_model = _rows(CPA_DB, """select model,
                                        sum(input_tokens) inp, sum(output_tokens) outp,
                                        sum(reasoning_tokens) reason,
                                        count(*) calls
                                 from usage_events where timestamp_ms > ?
                                 group by model order by (sum(input_tokens)+sum(output_tokens)) desc
                                 limit 12""", (since_ms,))
    for m in per_model:
        m["total"] = (m["inp"] or 0) + (m["outp"] or 0)
        m["per_call"] = round(m["total"] / m["calls"]) if m["calls"] else 0
        m["ratio"] = round((m["outp"] or 0) / m["inp"], 4) if m["inp"] else 0
    return {"total": total, "models": per_model}


# ---------------------------------------------------------------- Hermes 平台

import json as _json

HERMES_STATE = os.path.expanduser("~/.hermes/gateway_state.json")

PLATFORM_CN = {
    "feishu": "飞书", "discord": "Discord", "weixin": "微信",
    "telegram": "Telegram", "bluebubbles": "iMessage",
    "api_server": "API 服务", "whatsapp": "WhatsApp", "slack": "Slack",
}


def hermes_platforms():
    try:
        with open(HERMES_STATE) as f:
            d = _json.load(f)
    except (OSError, ValueError):
        return {"gateway_state": None, "platforms": []}
    plats = []
    for k, v in (d.get("platforms") or {}).items():
        st = (v or {}).get("state") or "unknown"
        plats.append({
            "id": k, "name": PLATFORM_CN.get(k, k), "state": st,
            "ok": st == "connected",
            "severity": "bad" if st == "fatal" else ("warn" if st != "connected" else "ok"),
            "error_code": (v or {}).get("error_code"),
            "error": ((v or {}).get("error_message") or "")[:200],
            "updated_at": (v or {}).get("updated_at"),
        })
    order = {"ok": 2, "warn": 1, "bad": 0}
    plats.sort(key=lambda p: (order.get(p["severity"], 3), p["name"]))
    return {"gateway_state": d.get("gateway_state"), "pid": d.get("pid"),
            "exit_reason": d.get("exit_reason"), "platforms": plats}


def hermes_sources(days=7):
    return _rows(HERMES_DB, """select source, count(*) sessions,
                                      coalesce(sum(message_count),0) messages,
                                      coalesce(sum(tool_call_count),0) tools,
                                      coalesce(sum(input_tokens+output_tokens),0) tokens,
                                      max(started_at) last_at
                               from sessions where started_at > strftime('%s','now') - ?
                               group by source order by sessions desc""", (days * 86400,))
