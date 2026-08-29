#!/usr/bin/env python3
"""FleetView —— 本地智能体 / CLI / 管理平台监控面板 (仅绑定 127.0.0.1)。"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

from fleet import probe, usage  # noqa: E402

CONFIG_PATH = os.path.join(BASE, "config.json")
STATIC = os.path.join(BASE, "static")

_cfg_lock = threading.Lock()
_snapshot = {"services": [], "at": 0}
_snap_lock = threading.Lock()
_paused = set()


def load_config():
    with _cfg_lock:
        with open(CONFIG_PATH) as f:
            return json.load(f)


def save_config(cfg):
    with _cfg_lock:
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)


def find_service(sid):
    for s in load_config()["services"]:
        if s["id"] == sid:
            return s
    return None


def refresh(force=False):
    cfg = load_config()
    active = [s for s in cfg["services"] if s["id"] not in _paused]
    results = probe.probe_all(active)
    up = probe.all_uptime(24)
    for r in results:
        r["uptime_24h"] = up.get(r["id"], {}).get("uptime")
    for s in cfg["services"]:
        if s["id"] in _paused:
            results.append({"id": s["id"], "name": s["name"], "group": s.get("group", "其他"),
                            "desc": s.get("desc", ""), "port": s.get("port"),
                            "state": "paused", "up": False, "pids": [],
                            "controllable": bool(s.get("controllable")),
                            "note": "已暂停监控", "checked_at": int(time.time())})
    order = {s["id"]: i for i, s in enumerate(cfg["services"])}
    results.sort(key=lambda r: order.get(r["id"], 999))
    with _snap_lock:
        _snapshot["services"] = results
        _snapshot["at"] = int(time.time())
    return results


def poller():
    while True:
        try:
            refresh()
        except Exception as e:
            print("[poll] %s" % e, file=sys.stderr)
        time.sleep(max(5, load_config().get("poll_interval", 30)))


def services_now():
    with _snap_lock:
        if not _snapshot["services"]:
            return refresh()
        return _snapshot["services"]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # ------------------------------------------------------------ helpers
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False, default=str).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            return {}

    def _rng(self, q):
        r = (q.get("range") or ["24h"])[0]
        return r if r in usage.RANGES else "24h"

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path
        try:
            if p in ("/", "/index.html"):
                return self._file("index.html", "text/html; charset=utf-8")
            if p.startswith("/static/"):
                return self._file(p[len("/static/"):], self._ctype(p))

            if p == "/api/services":
                return self._send(200, {"services": services_now(),
                                        "at": _snapshot["at"],
                                        "paused": sorted(_paused)})
            if p == "/api/overview":
                rng = self._rng(q)
                svcs = services_now()
                ov = usage.overview(rng)
                ov["services"] = {
                    "total": len(svcs),
                    "up": sum(1 for s in svcs if s.get("state") == "up"),
                    "warn": sum(1 for s in svcs if s.get("state") == "warn"),
                    "down": sum(1 for s in svcs if s.get("state") == "down"),
                    "paused": sum(1 for s in svcs if s.get("state") == "paused"),
                }
                ov["at"] = _snapshot["at"]
                return self._send(200, ov)
            if p == "/api/timeseries":
                return self._send(200, usage.timeseries(self._rng(q)))
            if p == "/api/models":
                return self._send(200, {"models": usage.by_model(self._rng(q))})
            if p == "/api/providers":
                return self._send(200, {"providers": usage.by_provider(self._rng(q)),
                                        "ccswitch": usage.ccs_providers()})
            if p == "/api/ttft":
                rng = self._rng(q)
                return self._send(200, {"histogram": usage.ttft_histogram(rng),
                                        "models": usage.by_model(rng, limit=20),
                                        "probes": probe.recent_probes()})
            if p == "/api/calls":
                only_fail = (q.get("fail") or ["0"])[0] == "1"
                limit = min(300, int((q.get("limit") or ["60"])[0]))
                return self._send(200, {"calls": usage.recent_calls(
                    self._rng(q), limit=limit, only_fail=only_fail)})
            if p == "/api/hermes":
                return self._send(200, {"summary": usage.hermes_summary(),
                                        "models": usage.hermes_models(),
                                        "sessions": usage.hermes_recent_sessions()})
            if p == "/api/history":
                sid = (q.get("id") or [""])[0]
                return self._send(200, probe.history(sid, hours=24))
            if p == "/api/accounts":
                return self._send(200, {"accounts": usage.accounts(self._rng(q)),
                                        "providers": usage.ccs_providers()})
            if p == "/api/errors":
                return self._send(200, usage.errors(self._rng(q)))
            if p == "/api/tokens":
                return self._send(200, usage.tokens(self._rng(q)))
            if p == "/api/agents":
                return self._send(200, {"gateway": usage.hermes_platforms(),
                                        "sources": usage.hermes_sources(),
                                        "summary": usage.hermes_summary(),
                                        "models": usage.hermes_models(),
                                        "sessions": usage.hermes_recent_sessions()})
            if p == "/api/live":
                cur = {"cpa": int((q.get("cpa") or ["0"])[0] or 0),
                       "ccs": int((q.get("ccs") or ["0"])[0] or 0)}
                fresh = usage.cursor()
                first = not (cur["cpa"] or cur["ccs"])
                return self._send(200, {
                    "events": [] if first else usage.delta(cur),
                    "backlog": usage.recent_calls("24h", limit=10, proxy_only=True) if first else [],
                    "cursor": fresh, "first": first,
                    "stats": usage.live_stats()})
            if p == "/api/stream":
                return self._stream()
            if p == "/api/config":
                return self._send(200, load_config())
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        u = urlparse(self.path)
        b = self._json_body()
        try:
            if u.path == "/api/refresh":
                return self._send(200, {"services": refresh(force=True),
                                        "at": _snapshot["at"]})
            if u.path == "/api/control":
                sid, action = b.get("id"), b.get("action")
                svc = find_service(sid)
                if not svc:
                    return self._send(404, {"ok": False, "msg": "未知服务 %s" % sid})
                if action in ("start", "stop", "restart") and not svc.get("controllable"):
                    return self._send(403, {"ok": False,
                                            "msg": "%s 未开放启停控制（可在设置里改 controllable）" % svc["name"]})
                if action == "stop":
                    r = probe.stop_service(svc)
                elif action == "start":
                    r = probe.start_service(svc)
                elif action == "restart":
                    probe.stop_service(svc)
                    time.sleep(1)
                    r = probe.start_service(svc)
                elif action == "pause":
                    _paused.add(sid)
                    r = {"ok": True, "msg": "已暂停监控 " + svc["name"]}
                elif action == "resume":
                    _paused.discard(sid)
                    r = {"ok": True, "msg": "已恢复监控 " + svc["name"]}
                else:
                    return self._send(400, {"ok": False, "msg": "未知动作"})
                refresh()
                r["services"] = services_now()
                return self._send(200, r)
            if u.path == "/api/probe-ttft":
                model = b.get("model") or "gpt-5"
                return self._send(200, probe.probe_ttft(model=model))
            if u.path == "/api/config":
                cfg = load_config()
                if "poll_interval" in b:
                    cfg["poll_interval"] = max(5, int(b["poll_interval"]))
                if "services" in b:
                    cfg["services"] = b["services"]
                save_config(cfg)
                return self._send(200, {"ok": True, "config": cfg})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"ok": False, "msg": "%s: %s" % (type(e).__name__, e)})

    # ------------------------------------------------------------ SSE 实时推流
    def _stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def emit(event, payload):
            body = ("event: %s\ndata: %s\n\n"
                    % (event, json.dumps(payload, ensure_ascii=False, default=str))).encode()
            self.wfile.write(b"%x\r\n" % len(body) + body + b"\r\n")
            self.wfile.flush()

        cur = usage.cursor()
        try:
            emit("hello", {"cursor": cur, "stats": usage.live_stats(),
                           "backlog": usage.recent_calls("24h", limit=10, proxy_only=True)})
            ticks = 0
            while True:
                time.sleep(2)
                ticks += 1
                fresh = usage.cursor()
                if fresh != cur:
                    events = usage.delta(cur)
                    cur = fresh
                    if events:
                        emit("calls", {"events": events, "cursor": cur})
                if ticks % 3 == 0:
                    emit("stats", usage.live_stats())
                if ticks % 15 == 0:
                    emit("services", {"services": services_now(), "at": _snapshot["at"]})
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    # ------------------------------------------------------------ static
    def _ctype(self, path):
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        if path.endswith(".js"):
            return "application/javascript; charset=utf-8"
        if path.endswith(".svg"):
            return "image/svg+xml"
        return "application/octet-stream"

    def _file(self, rel, ctype):
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        with open(full, "rb") as f:
            return self._send(200, f.read(), ctype)


def main():
    probe.init_history()
    cfg = load_config()
    port = int(os.environ.get("FLEET_PORT") or cfg.get("port", 8790))
    threading.Thread(target=poller, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.daemon_threads = True
    print("FleetView → http://127.0.0.1:%d  (仅本机可访问)" % port, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
