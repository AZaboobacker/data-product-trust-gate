"""TrustGate local demo server and read-only OpenMetadata adapter.

OpenMetadata credentials are read only from the server process environment. They
are never returned to the browser or persisted by the application.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
MOCK_ASSETS = [
    {
        "id": "demo.weather.observations",
        "product_id": "weather.city.observations",
        "name": "City Weather Observations",
        "fullyQualifiedName": "demo.weather.city.observations",
        "owner": "Climate Data Team",
        "description": "Hourly weather data for a selected city, including temperature, humidity, and precipitation.",
        "refreshAgeHours": 2,
        "fields": ["city", "observed_at", "temperature_c", "humidity_pct", "precipitation_mm", "wind_speed_kph", "weather_code", "source"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "TrustGate synthetic catalog",
        "sourceType": "Mock catalog record",
        "sourceEvidence": ["owner", "description", "schema", "refresh age", "catalog origin"],
    },
    {
        "id": "demo.weather.incomplete",
        "product_id": "weather.station.raw",
        "name": "Station Weather Feed (incomplete example)",
        "fullyQualifiedName": "demo.weather.station_raw",
        "owner": "",
        "description": "",
        "refreshAgeHours": 41,
        "fields": ["station_id", "observed_at", "temperature_c"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "TrustGate synthetic catalog",
        "sourceType": "Mock catalog record",
        "sourceEvidence": ["schema", "refresh age", "catalog origin"],
    },
]


def openmetadata_base() -> str:
    raw = os.getenv("OPENMETADATA_URL", "").strip().rstrip("/")
    if not raw:
        return ""
    if raw.endswith("/api/v1"):
        return raw
    if raw.endswith("/api"):
        return raw + "/v1"
    return raw + "/api/v1"


def openmetadata_request(path: str) -> dict[str, Any]:
    base = openmetadata_base()
    if not base:
        raise RuntimeError("OPENMETADATA_URL is not configured on the local server.")
    request = urllib.request.Request(base + path, headers={"Accept": "application/json"})
    token = os.getenv("OPENMETADATA_TOKEN", "").strip()
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise RuntimeError("OpenMetadata rejected the configured token (HTTP 401). Check OPENMETADATA_TOKEN.") from exc
        if exc.code == 403:
            raise RuntimeError("OpenMetadata denied this read-only request (HTTP 403). Check the token's role.") from exc
        raise RuntimeError(f"OpenMetadata returned HTTP {exc.code}.") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("Could not reach the configured OpenMetadata server.") from exc
    if not isinstance(data, dict):
        raise RuntimeError("OpenMetadata returned an unexpected response.")
    return data


def _owner_name(owner: Any) -> str:
    if isinstance(owner, str):
        return owner
    if isinstance(owner, dict):
        return str(owner.get("displayName") or owner.get("name") or "")
    if isinstance(owner, list) and owner:
        return _owner_name(owner[0])
    return ""


def _to_iso(value: Any) -> str:
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(seconds, timezone.utc).isoformat()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        except ValueError:
            return ""
    return ""


def normalize_openmetadata(entity: dict[str, Any]) -> dict[str, Any]:
    updated_at = _to_iso(entity.get("updatedAt") or entity.get("updated_at"))
    age_hours = None
    if updated_at:
        age_hours = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(updated_at)).total_seconds() / 3600)
    columns = entity.get("columns") or []
    field_names = [str(col.get("name", "")) for col in columns if isinstance(col, dict) and col.get("name")]
    fully_qualified_name = str(entity.get("fullyQualifiedName") or entity.get("name") or entity.get("id") or "")
    return {
        "id": fully_qualified_name,
        "product_id": fully_qualified_name,
        "name": str(entity.get("displayName") or entity.get("name") or fully_qualified_name),
        "fullyQualifiedName": fully_qualified_name,
        "owner": _owner_name(entity.get("owners") or entity.get("owner")),
        "description": str(entity.get("description") or ""),
        "refreshAgeHours": round(age_hours, 2) if age_hours is not None else "",
        "fields": field_names,
        "updatedAt": updated_at,
        "source": "OpenMetadata",
        "sourceType": str(entity.get("entityType") or "Table"),
        "sourceEvidence": ["OpenMetadata owner", "OpenMetadata description", "OpenMetadata columns", "OpenMetadata updatedAt"],
        "catalogVersion": str(entity.get("updatedAt") or entity.get("version") or ""),
        "tags": entity.get("tags") or [],
        "domains": entity.get("domains") or [],
    }


def list_openmetadata_assets() -> list[dict[str, Any]]:
    fields = "owner,description,columns,updatedAt,tags,domains,service,database,schema"
    payload = openmetadata_request("/tables?limit=50&fields=" + urllib.parse.quote(fields, safe=","))
    return [normalize_openmetadata(item) for item in payload.get("data", []) if isinstance(item, dict)]


def get_openmetadata_asset(fqn: str) -> dict[str, Any]:
    fields = "owner,description,columns,updatedAt,tags,domains,service,database,schema"
    path = "/tables/name/" + urllib.parse.quote(fqn, safe="") + "?fields=" + urllib.parse.quote(fields, safe=",")
    return normalize_openmetadata(openmetadata_request(path))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[TrustGate] " + fmt % args)

    def _json(self, status: int, payload: Any) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/status":
            configured = bool(openmetadata_base())
            self._json(200, {
                "mode": "connected" if configured else "demo",
                "catalog": "OpenMetadata" if configured else "Synthetic demo catalog",
                "readOnly": True,
                "tokenConfigured": bool(os.getenv("OPENMETADATA_TOKEN", "").strip()),
                "tokenExposed": False,
            })
            return
        if parsed.path == "/api/policies":
            self._json(200, json.loads((ROOT / "examples" / "policies.json").read_text(encoding="utf-8")))
            return
        if parsed.path == "/api/assets":
            source = query.get("source", ["mock"])[0]
            asset_id = query.get("id", [""])[0]
            try:
                if source == "mock":
                    assets = MOCK_ASSETS
                    selected = next((x for x in assets if x["id"] == asset_id or x["fullyQualifiedName"] == asset_id), None) if asset_id else None
                    self._json(200, {"source": "mock", "assets": assets, "asset": selected})
                elif source == "openmetadata":
                    if asset_id:
                        selected = get_openmetadata_asset(asset_id)
                        self._json(200, {"source": "openmetadata", "assets": [selected], "asset": selected})
                    else:
                        self._json(200, {"source": "openmetadata", "assets": list_openmetadata_assets()})
                else:
                    self._json(400, {"error": "Unknown source. Use mock or openmetadata."})
            except (RuntimeError, ValueError, KeyError) as exc:
                self._json(502, {"error": str(exc)})
            return
        return super().do_GET()


def main() -> None:
    host = os.getenv("TRUSTGATE_HOST", "127.0.0.1")
    port = int(os.getenv("TRUSTGATE_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    mode = "connected OpenMetadata (read-only)" if openmetadata_base() else "demo mode (synthetic catalog)"
    print(f"TrustGate running in {mode} at http://{host}:{port}")
    print("Press Ctrl+C to stop. OpenMetadata tokens remain in this server process only.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping TrustGate.")
    finally:
        # serve_forever has already unwound after KeyboardInterrupt. Calling
        # shutdown() from this same thread would wait on itself.
        server.server_close()


if __name__ == "__main__":
    main()
