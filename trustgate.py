"""Deterministic metadata readiness checks for fictional data products."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

POLICY_VERSION = "1.0"
REQUIRED_FIELDS = ("product_id", "owner", "description", "refreshed_at", "fields")


def evaluate(product: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Evaluate a product and return an explainable readiness decision."""
    now = now or datetime.now(timezone.utc)
    issues: list[str] = []
    checks: list[dict[str, str]] = []

    missing = [key for key in REQUIRED_FIELDS if key not in product]
    checks.append({"name": "Contract structure", "status": "FAIL" if missing else "PASS",
                   "evidence": "Missing: " + ", ".join(missing) if missing else "All required keys are present."})
    if missing:
        issues.append("Required contract keys are missing.")

    owner_ok = bool(str(product.get("owner", "")).strip())
    checks.append({"name": "Ownership declared", "status": "PASS" if owner_ok else "FAIL",
                   "evidence": f"Owner: {product.get('owner') or 'not declared'}"})
    if not owner_ok:
        issues.append("An accountable owner is required.")

    desc_ok = bool(str(product.get("description", "")).strip())
    checks.append({"name": "Business description", "status": "PASS" if desc_ok else "FAIL",
                   "evidence": "Description is present." if desc_ok else "Description is missing."})
    if not desc_ok:
        issues.append("A business description is required.")

    stale = False
    refreshed = product.get("refreshed_at")
    try:
        stamp = datetime.fromisoformat(str(refreshed).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        age_hours = max(0, (now - stamp.astimezone(timezone.utc)).total_seconds() / 3600)
        stale = age_hours > 24
        freshness_evidence = f"Refresh age: {age_hours:.1f} hours; policy limit: 24 hours."
    except (TypeError, ValueError):
        stale = True
        freshness_evidence = "Refresh timestamp is missing or invalid."
    checks.append({"name": "Freshness policy", "status": "REVIEW" if stale else "PASS", "evidence": freshness_evidence})
    if stale:
        issues.append("Freshness needs review against the 24-hour sample policy.")

    fields = product.get("fields")
    fields_ok = isinstance(fields, list) and len(fields) >= 8 and all(isinstance(x, str) and x.strip() for x in fields)
    checks.append({"name": "Required fields", "status": "PASS" if fields_ok else "FAIL",
                   "evidence": f"{len(fields) if isinstance(fields, list) else 0} of 8 required fields present."})
    if not fields_ok:
        issues.append("At least eight named fields are required by the sample policy.")

    if any(c["status"] == "FAIL" for c in checks):
        decision = "BLOCKED"
    elif stale:
        decision = "REVIEW"
    else:
        decision = "READY"
    return {"decision": decision, "policy_version": POLICY_VERSION, "checks": checks, "issues": issues}


def main() -> int:
    parser = argparse.ArgumentParser(description="Check a fictional data product against the sample readiness policy.")
    parser.add_argument("product", type=Path, help="Path to a JSON product contract")
    args = parser.parse_args()
    try:
        product = json.loads(args.product.read_text(encoding="utf-8"))
        if not isinstance(product, dict):
            raise ValueError("The contract must be a JSON object.")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(evaluate(product), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
