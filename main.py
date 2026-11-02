"""FastAPI entrypoint for TrustGate's Vercel deployment."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse

from app import MOCK_ASSETS, get_openmetadata_asset, list_openmetadata_assets, openmetadata_base

ROOT = Path(__file__).resolve().parent
app = FastAPI(title="TrustGate", docs_url=None, redoc_url=None)


@app.get("/api/status")
def status():
    connected = bool(openmetadata_base())
    return {
        "mode": "connected" if connected else "demo",
        "catalog": "OpenMetadata" if connected else "Synthetic demo catalog",
        "readOnly": True,
        "tokenConfigured": bool(os.getenv("OPENMETADATA_TOKEN", "").strip()),
        "tokenExposed": False,
    }


@app.get("/api/policies")
def policies():
    return json.loads((ROOT / "examples" / "policies.json").read_text(encoding="utf-8"))


@app.get("/api/assets")
def assets(
    source: str = Query(default="mock"),
    asset_id: str | None = Query(default=None, alias="id"),
):
    if source == "mock":
        selected = next(
            (item for item in MOCK_ASSETS if asset_id in (item["id"], item["fullyQualifiedName"])),
            None,
        ) if asset_id else None
        return {"source": "mock", "assets": MOCK_ASSETS, "asset": selected}
    if source == "openmetadata":
        try:
            if asset_id:
                selected = get_openmetadata_asset(asset_id)
                return {"source": "openmetadata", "assets": [selected], "asset": selected}
            return {"source": "openmetadata", "assets": list_openmetadata_assets()}
        except (RuntimeError, ValueError, KeyError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    raise HTTPException(status_code=400, detail="Unknown source. Use mock or openmetadata.")


@app.get("/")
def home():
    return FileResponse(ROOT / "index.html", media_type="text/html")


@app.get("/{asset_path:path}")
def static_asset(asset_path: str):
    # Only ship the browser modules; never expose Python source, examples, or repo files.
    allowed = {"trustgate-ui.mjs", "trustgate-core.mjs"}
    if asset_path not in allowed:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(ROOT / asset_path, media_type="text/javascript")
