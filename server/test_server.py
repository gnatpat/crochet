"""
Run with: .venv/bin/python test_server.py
Uses a temp SQLite file so it doesn't touch your real data.
"""
import os
import sys
import tempfile

tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
tmp_db.close()
os.environ["CROCHET_DB"] = tmp_db.name
os.environ["CROCHET_NO_STATIC"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

import server as srv  # noqa: E402

client = TestClient(srv.app)

results = []
def check(cond, msg):
    results.append((cond, msg))
    print(("PASS" if cond else "FAIL"), msg)


# --- merge() unit tests ---
def t_merge():
    a = [{"id": "1", "updatedAt": 100, "name": "old"}]
    b = [{"id": "1", "updatedAt": 200, "name": "new"}]
    check(srv.merge(a, b)[0]["name"] == "new", "merge: newer client wins")
    check(srv.merge(b, a)[0]["name"] == "new", "merge: newer server wins (client older)")
    out = srv.merge(a, [{"id": "2", "updatedAt": 1, "name": "fresh"}])
    ids = sorted(p["id"] for p in out)
    check(ids == ["1", "2"], "merge: union of ids")

t_merge()


# --- /api/sync round-trip ---
KEY = "test_key_" + "a" * 16

def t_first_sync():
    r = client.post("/api/sync",
                    json={"projects": [{"id": "p1", "name": "Otto", "rawText": "1: 6 sc",
                                        "cursor": {"rowIndex": 0, "stepIndex": 0, "history": []},
                                        "updatedAt": 1000}]},
                    headers={"X-Sync-Key": KEY})
    check(r.status_code == 200, f"first push: 200 ({r.status_code})")
    data = r.json()
    check(len(data["projects"]) == 1, "first push: one project echoed back")
    check(data["projects"][0]["id"] == "p1", "first push: id preserved")

t_first_sync()

def t_second_device_pull():
    r = client.post("/api/sync", json={"projects": []}, headers={"X-Sync-Key": KEY})
    data = r.json()
    check(len(data["projects"]) == 1, "second device empty push: gets server's projects")
    check(data["projects"][0]["name"] == "Otto", "second device sees Otto")

t_second_device_pull()

def t_lww():
    # Device B updates with later timestamp
    r = client.post("/api/sync",
                    json={"projects": [{"id": "p1", "name": "Otto v2", "rawText": "1: 8 sc",
                                        "cursor": {"rowIndex": 1, "stepIndex": 0, "history": []},
                                        "updatedAt": 2000}]},
                    headers={"X-Sync-Key": KEY})
    check(r.json()["projects"][0]["name"] == "Otto v2", "LWW: newer client overwrites")
    # Device A tries to push an OLDER version
    r = client.post("/api/sync",
                    json={"projects": [{"id": "p1", "name": "Otto stale", "rawText": "1: 1 sc",
                                        "cursor": {"rowIndex": 0, "stepIndex": 0, "history": []},
                                        "updatedAt": 500}]},
                    headers={"X-Sync-Key": KEY})
    check(r.json()["projects"][0]["name"] == "Otto v2", "LWW: older client is rejected; server keeps newer")

t_lww()

def t_tombstone():
    r = client.post("/api/sync",
                    json={"projects": [{"id": "p1", "name": "Otto v2", "rawText": "1: 8 sc",
                                        "cursor": {"rowIndex": 0, "stepIndex": 0, "history": []},
                                        "updatedAt": 3000, "deletedAt": 3000}]},
                    headers={"X-Sync-Key": KEY})
    p = r.json()["projects"][0]
    check(p.get("deletedAt") == 3000, "tombstone: deletedAt preserved")

t_tombstone()

def t_isolation():
    # Different key = totally separate data
    other = "other_key_" + "b" * 16
    r = client.post("/api/sync", json={"projects": []}, headers={"X-Sync-Key": other})
    check(r.json()["projects"] == [], "isolation: different key sees no data")

t_isolation()

def t_invalid_key():
    r = client.post("/api/sync", json={"projects": []}, headers={"X-Sync-Key": "short"})
    check(r.status_code == 400, f"invalid key: 400 ({r.status_code})")
    r = client.post("/api/sync", json={"projects": []}, headers={"X-Sync-Key": "bad chars!"})
    check(r.status_code == 400, "invalid key chars: 400")
    r = client.post("/api/sync", json={"projects": []})
    check(r.status_code in (400, 422), "missing key: 400 or 422")

t_invalid_key()

def t_health():
    r = client.get("/api/health")
    check(r.status_code == 200 and r.json() == {"ok": True}, "health: 200 OK")

t_health()

passed = sum(1 for ok, _ in results if ok)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
