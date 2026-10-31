"""Local TrustGate web server and read-only OpenMetadata adapter."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DEFAULT_CATALOG = "https://sandbox.open-metadata.org"
connection: dict[str, str] | None = None  # Local-process memory only; never persisted.


def _api_get(base_url: str, path: str, token: str = "") -> dict:
    request = Request(base_url.rstrip("/") + path, headers={
        "Accept": "application/json",
        **({"Authorization": f"Bearer {token}"} if token else {}),
    })
    try:
        with urlopen(request, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("Catalog API returned an unexpected response.")
            return data
    except HTTPError as exc:
        if exc.code == 401:
            raise PermissionError("OpenMetadata requires a valid access token for catalog data.") from exc
        if exc.code == 403:
            raise PermissionError("The token is valid but cannot read these catalog assets.") from exc
        raise RuntimeError(f"OpenMetadata returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError("Could not reach the OpenMetadata API. Check the URL and network.") from exc
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError("OpenMetadata returned invalid JSON.") from exc


def list_assets(base_url: str, token: str) -> tuple[str, list[dict]]:
    version = _api_get(base_url, "/api/v1/system/version").get("version", "unknown")
    query = urlencode({"limit": 50, "fields": "owners,description,columns,updatedAt,tags,domain"})
    payload = _api_get(base_url, f"/api/v1/tables?{query}", token)
    assets = []
    for row in payload.get("data", []):
        if not isinstance(row, dict):
            continue
        owners = row.get("owners") or []
        owner = ", ".join(filter(None, (x.get("displayName") or x.get("name", "") for x in owners if isinstance(x, dict))))
        columns = row.get("columns") or []
        updated = row.get("updatedAt")
        if isinstance(updated, (int, float)):
            updated = datetime.fromtimestamp(updated / 1000, timezone.utc).isoformat()
        assets.append({
            "id": str(row.get("id", "")), "name": str(row.get("name", "")),
            "fullyQualifiedName": str(row.get("fullyQualifiedName", row.get("name", ""))),
            "description": str(row.get("description") or ""), "owner": owner,
            "fields": [str(c.get("name", "")) for c in columns if isinstance(c, dict) and c.get("name")],
            "updatedAt": updated, "href": row.get("href"),
        })
    return str(version), assets


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global connection
        if self.path != "/api/catalog/connect":
            return self._json(404, {"error": "Not found"})
        connection = None
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 16_384)
            body = json.loads(self.rfile.read(length) or b"{}")
            base = str(body.get("baseUrl", DEFAULT_CATALOG)).strip().rstrip("/")
            token = str(body.get("token", "")).strip()
            parsed = urlparse(base)
            if parsed.scheme != "https" or not parsed.netloc:
                return self._json(400, {"error": "Catalog URL must use HTTPS."})
            if not token:
                return self._json(400, {"error": "Enter an OpenMetadata access token to read catalog assets."})
            version, assets = list_assets(base, token)
            connection = {"baseUrl": base, "token": token}
            return self._json(200, {"connected": True, "baseUrl": base, "version": version, "assets": assets})
        except PermissionError as exc:
            return self._json(401, {"error": str(exc)})
        except (RuntimeError, ValueError, TypeError, json.JSONDecodeError) as exc:
            return self._json(502, {"error": str(exc)})

    def do_GET(self):
        if self.path == "/api/catalog/status":
            return self._json(200, {"connected": bool(connection), "baseUrl": connection["baseUrl"] if connection else None})
        if self.path == "/api/health":
            return self._json(200, {"ok": True})
        if self.path.startswith("/api/catalog/asset?"):
            if not connection:
                return self._json(409, {"error": "Connect to a catalog first."})
            asset_id = parse_qs(urlparse(self.path).query).get("id", [""])[0]
            if not asset_id:
                return self._json(400, {"error": "Asset ID is required."})
            try:
                version, assets = list_assets(connection["baseUrl"], connection["token"])
                asset = next((item for item in assets if item["id"] == asset_id), None)
                if not asset:
                    return self._json(404, {"error": "Asset is no longer available in the catalog."})
                return self._json(200, {"asset": asset, "version": version, "checkedAt": datetime.now(timezone.utc).isoformat()})
            except PermissionError as exc:
                return self._json(401, {"error": str(exc)})
            except RuntimeError as exc:
                return self._json(502, {"error": str(exc)})
        return super().do_GET()

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("TRUSTGATE_PORT", "8000"))
    print(f"TrustGate running at http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
