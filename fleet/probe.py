"""服务存活探测 + 启停控制 + 主动首词探测。"""

import json
import os
import re
import signal
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request

STATE_DIR = os.path.expanduser("~/.local/fleet-panel")
HISTORY_DB = os.path.join(STATE_DIR, "history.sqlite")
_lock = threading.Lock()


# ---------------------------------------------------------------- 历史落盘

def init_history():
    os.makedirs(STATE_DIR, exist_ok=True)
    con = sqlite3.connect(HISTORY_DB)
    con.execute("""create table if not exists checks (
        id integer primary key autoincrement,
        ts integer not null, service_id text not null,
        up integer not null, latency_ms real, pid integer,
        http_status integer, note text)""")
    con.execute("create index if not exists idx_checks on checks(service_id, ts)")
    con.execute("""create table if not exists ttft_probes (
        id integer primary key autoincrement,
        ts integer not null, service_id text not null, model text,
        ok integer not null, ttft_ms real, total_ms real, note text)""")
    con.commit()
    con.close()


def record(rows):
    with _lock:
        con = sqlite3.connect(HISTORY_DB)
        con.executemany(
            "insert into checks(ts,service_id,up,latency_ms,pid,http_status,note) "
            "values(?,?,?,?,?,?,?)", rows)
        con.execute("delete from checks where ts < ?", (int(time.time()) - 7 * 86400,))
        con.commit()
        con.close()


def history(service_id, hours=24, buckets=48):
    since = int(time.time()) - hours * 3600
    con = sqlite3.connect(HISTORY_DB)
    rows = con.execute("select ts, up, latency_ms from checks where service_id=? and ts>? order by ts",
                       (service_id, since)).fetchall()
    con.close()
    if not rows:
        return {"points": [], "uptime": None, "checks": 0}
    width = max(1, (hours * 3600) // buckets)
    slots = {}
    for ts, up, lat in rows:
        i = (ts - since) // width
        s = slots.setdefault(i, {"up": 0, "n": 0, "lat": []})
        s["n"] += 1
        s["up"] += up
        if lat:
            s["lat"].append(lat)
    pts = []
    for i in range(buckets):
        s = slots.get(i)
        if not s:
            pts.append({"t": since + i * width, "uptime": None, "latency": None})
        else:
            pts.append({"t": since + i * width,
                        "uptime": round(100.0 * s["up"] / s["n"], 1),
                        "latency": round(sum(s["lat"]) / len(s["lat"]), 1) if s["lat"] else None})
    return {"points": pts, "checks": len(rows),
            "uptime": round(100.0 * sum(r[1] for r in rows) / len(rows), 2)}


def all_uptime(hours=24):
    since = int(time.time()) - hours * 3600
    con = sqlite3.connect(HISTORY_DB)
    rows = con.execute("select service_id, avg(up)*100.0, count(*) from checks "
                       "where ts>? group by service_id", (since,)).fetchall()
    con.close()
    return {r[0]: {"uptime": round(r[1], 2), "checks": r[2]} for r in rows}


# ---------------------------------------------------------------- 进程表

def process_table():
    """一次 ps 拿全部进程，避免每个服务 fork 一次 pgrep。"""
    try:
        out = subprocess.run(["ps", "-axo", "pid=,comm=,args="], capture_output=True,
                             text=True, timeout=8).stdout
    except Exception:
        return []
    procs = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 2)
        if len(parts) < 2:
            continue
        pid = parts[0]
        if not pid.isdigit():
            continue
        comm = os.path.basename(parts[1])
        args = parts[2] if len(parts) > 2 else parts[1]
        procs.append({"pid": int(pid), "comm": comm, "args": args})
    return procs


def match_procs(svc, procs):
    pat = svc.get("match")
    if not pat:
        return []
    mode = svc.get("match_mode", "args")
    hits = []
    for p in procs:
        target = p["comm"] if mode == "comm" else p["args"]
        try:
            if re.search(pat, target):
                hits.append(p)
        except re.error:
            if pat in target:
                hits.append(p)
    return hits


def listening_ports(pid):
    try:
        out = subprocess.run(["lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN"],
                             capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return []
    ports = []
    for line in out.splitlines()[1:]:
        m = re.search(r":(\d+)\s+\(LISTEN\)", line)
        if m:
            ports.append(int(m.group(1)))
    return sorted(set(ports))


# ---------------------------------------------------------------- 探测

def port_open(port, timeout=1.5):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def http_check(port, path, expect, timeout=2.5):
    url = "http://127.0.0.1:%d%s" % (port, path or "/")
    req = urllib.request.Request(url, headers={"User-Agent": "fleet-panel"})
    t0 = time.time()
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as r:
            code = r.status
            r.read(512)
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        return {"ok": False, "status": None, "latency_ms": None, "note": type(e).__name__}
    dt = round((time.time() - t0) * 1000, 1)
    ok = code in (expect or [200])
    return {"ok": ok, "status": code, "latency_ms": dt,
            "note": "" if ok else "HTTP %s" % code}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe_one(svc, procs):
    pids = [p["pid"] for p in match_procs(svc, procs)]
    port = svc.get("port")
    res = {"id": svc["id"], "name": svc["name"], "group": svc.get("group", "其他"),
           "desc": svc.get("desc", ""), "port": port, "pids": pids,
           "pid": pids[0] if pids else None, "proc_count": len(pids),
           "controllable": bool(svc.get("controllable")),
           "featured": bool(svc.get("featured")),
           "checked_at": int(time.time())}

    if port:
        open_ = port_open(port)
        res["port_open"] = open_
        if open_ and svc.get("health_path") is not None:
            h = http_check(port, svc.get("health_path", "/"), svc.get("expect"))
            res.update({"http_status": h["status"], "latency_ms": h["latency_ms"]})
            res["up"] = h["ok"]
            res["note"] = h["note"]
        else:
            res["up"] = open_
            res["latency_ms"] = None
            res["note"] = "" if open_ else "端口未监听"
    else:
        res["port_open"] = None
        res["up"] = bool(pids)
        res["latency_ms"] = None
        res["note"] = "" if pids else "进程未运行"
        if pids:
            lp = listening_ports(pids[0])
            if lp:
                res["dynamic_ports"] = lp

    # 端口通但进程不匹配 / 进程在但端口不通 → 降级为 warn
    if res["up"] and svc.get("match") and not pids:
        res["state"] = "warn"
        res["note"] = res["note"] or "端口在但未匹配到进程"
    elif res["up"]:
        res["state"] = "up"
    elif pids:
        res["state"] = "warn"
        res["note"] = res["note"] or "进程在但服务不可达"
    else:
        res["state"] = "down"
    return res


def probe_all(services):
    procs = process_table()
    out = []
    threads = []
    slots = [None] * len(services)

    def run(i, svc):
        try:
            slots[i] = probe_one(svc, procs)
        except Exception as e:
            slots[i] = {"id": svc["id"], "name": svc["name"], "up": False,
                        "state": "down", "note": "探测异常: %s" % e,
                        "group": svc.get("group", "其他"), "pids": [],
                        "checked_at": int(time.time())}

    for i, svc in enumerate(services):
        t = threading.Thread(target=run, args=(i, svc), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join(timeout=8)
    out = [s for s in slots if s]
    record([(s["checked_at"], s["id"], 1 if s["up"] else 0, s.get("latency_ms"),
             s.get("pid"), s.get("http_status"), s.get("note", "")) for s in out])
    return out


# ---------------------------------------------------------------- 控制

def stop_service(svc):
    procs = process_table()
    pids = [p["pid"] for p in match_procs(svc, procs)]
    if not pids:
        return {"ok": False, "msg": "未找到匹配进程，可能已停止"}
    me = os.getpid()
    killed = []
    for pid in pids:
        if pid in (me, os.getppid()):
            continue
        try:
            os.kill(pid, signal.SIGTERM)
            killed.append(pid)
        except OSError as e:
            return {"ok": False, "msg": "kill %d 失败: %s" % (pid, e)}
    time.sleep(1.5)
    alive = [p["pid"] for p in match_procs(svc, process_table())]
    return {"ok": True, "msg": "已发送 SIGTERM 给 %s" % killed,
            "killed": killed, "still_alive": alive}


def start_service(svc):
    cmd = svc.get("start")
    if not cmd:
        return {"ok": False, "msg": "该服务未配置启动命令"}
    try:
        subprocess.Popen(["/bin/bash", "-lc", cmd], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    except Exception as e:
        return {"ok": False, "msg": "启动失败: %s" % e}
    time.sleep(3)
    res = probe_one(svc, process_table())
    return {"ok": res["up"], "msg": "已执行启动命令，当前状态: %s" % res["state"],
            "state": res["state"]}


# ---------------------------------------------------------------- 主动首词探测

CPA_CONFIG = os.path.expanduser("~/Projects/CLIProxyAPI/config.yaml")


def _cpa_key():
    """从 CLIProxyAPI 配置读取本地网关的 api-key，仅在进程内使用。"""
    try:
        with open(CPA_CONFIG) as f:
            lines = f.read().splitlines()
    except OSError:
        return None
    for i, line in enumerate(lines):
        if line.strip().startswith("api-keys:"):
            for nxt in lines[i + 1:]:
                s = nxt.strip()
                if s.startswith("- "):
                    return s[2:].strip().strip('"').strip("'")
                if s and not s.startswith("#"):
                    break
    return None


def probe_ttft(model="gpt-5", port=8317, timeout=30):
    """向本地网关发一次最小流式请求，实测首词到达时间。"""
    key = _cpa_key()
    if not key:
        return {"ok": False, "msg": "未能从 CLIProxyAPI 配置读取 api-key"}
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 8,
        "stream": True,
    }).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:%d/v1/chat/completions" % port, data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    t0 = time.time()
    first = None
    try:
        with opener.open(req, timeout=timeout) as r:
            for raw in r:
                if not raw.strip() or not raw.startswith(b"data:"):
                    continue
                chunk = raw[5:].strip()
                if chunk == b"[DONE]":
                    break
                try:
                    d = json.loads(chunk)
                except ValueError:
                    continue
                delta = (d.get("choices") or [{}])[0].get("delta") or {}
                if delta.get("content") or delta.get("reasoning_content"):
                    first = time.time()
                    break
    except urllib.error.HTTPError as e:
        return {"ok": False, "msg": "HTTP %s: %s" % (e.code, e.read()[:200].decode("utf-8", "ignore"))}
    except Exception as e:
        return {"ok": False, "msg": "%s: %s" % (type(e).__name__, e)}

    total = round((time.time() - t0) * 1000, 1)
    if first is None:
        return {"ok": False, "msg": "流式响应中未出现首个内容片段", "total_ms": total}
    ttft = round((first - t0) * 1000, 1)
    with _lock:
        con = sqlite3.connect(HISTORY_DB)
        con.execute("insert into ttft_probes(ts,service_id,model,ok,ttft_ms,total_ms,note)"
                    " values(?,?,?,?,?,?,?)",
                    (int(time.time()), "cli-proxy-api", model, 1, ttft, total, ""))
        con.commit()
        con.close()
    return {"ok": True, "model": model, "ttft_ms": ttft, "total_ms": total}


def recent_probes(limit=20):
    con = sqlite3.connect(HISTORY_DB)
    rows = con.execute("select ts,service_id,model,ok,ttft_ms,total_ms,note from ttft_probes"
                       " order by ts desc limit ?", (limit,)).fetchall()
    con.close()
    return [{"ts": r[0], "service": r[1], "model": r[2], "ok": bool(r[3]),
             "ttft_ms": r[4], "total_ms": r[5], "note": r[6]} for r in rows]
