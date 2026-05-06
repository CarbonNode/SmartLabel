"""Quick test script."""
import urllib.request
import json

data = json.dumps({"locations": [{"code": "K2-02-01-1", "arrow": "down"}]}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:5555/api/generate-direct",
    data=data,
    headers={"Content-Type": "application/json"},
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    print(f"OK: {len(resp.read())} bytes")
except urllib.error.HTTPError as e:
    print(f"Error {e.code}")
    raw = e.read().decode()
    print("Raw response:", raw[:3000])
