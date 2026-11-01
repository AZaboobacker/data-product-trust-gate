# TrustGate — Runtime Data Product Readiness

TrustGate is an independent portfolio demo for policy-driven, evidence-backed data product readiness. Each evaluation is a time-stamped decision against the active policy and current metadata—not a permanent certification. A policy change, asset change, expired evaluation, or expired required evidence makes the prior decision stale.

The project uses synthetic catalog records by default and can optionally read OpenMetadata tables. It has no employer branding or private data. OpenMetadata integration is read-only, and credentials remain in the local server process.

## Quick start

Requirements: Python 3.10+ and a modern browser. No package install is required.

```bash
python3 app.py
```

Open [http://localhost:8000](http://localhost:8000). Ctrl+C stops the server. On Windows, use `python app.py`.

## Try the complete demo

1. Confirm the banner says **Demo mode · synthetic catalog**. Load either fictional example from the catalog selectors.
2. Edit owner, description, refresh age, or schema. Metadata attestation updates immediately.
3. Use **Active certification policy** to choose a sample policy or edit required metadata, thresholds, failure outcomes, required evidence, and validity period. Apply changes to create a new policy version. **Reset to defaults** restores the baseline policy.
4. Compare the synthetic record and OpenMetadata side by side. The OpenMetadata side is available only in connected mode; the UI labels each field's evidence source.
5. Select **Evaluate current asset**. Review the pass/review/block checks, plain-language reasons, policy version, evidence, timestamps, and evaluation ID.
6. Only a current **READY** evaluation can produce a decision certificate. Download the certificate and decision trace separately. Editing metadata/policy, seeing the connected asset change, or allowing validity/evidence to expire makes the result stale and disables downloads until re-evaluated.
7. **Check live source** optionally verifies a current Open-Meteo response. It is evidence of a recent successful source response only—not proof of dataset quality or correctness. It counts only when selected as required evidence in the policy.

## Connect a read-only OpenMetadata catalog (optional)

Set the base URL and a read-only service account token in the environment where the local server runs, then start TrustGate. For example, in macOS/Linux:

```bash
export OPENMETADATA_URL="https://your-openmetadata-host/api"
export OPENMETADATA_TOKEN="your-read-only-token"
python3 app.py
```

PowerShell:

```powershell
$env:OPENMETADATA_URL = "https://your-openmetadata-host/api"
$env:OPENMETADATA_TOKEN = "your-read-only-token"
python app.py
```

The server performs read-only table-list and table-detail requests. The browser never receives the token, and TrustGate does not persist it. Do not commit credentials or use a broadly privileged token. If the URL is configured but the token is missing/invalid or lacks permission, the UI reports the catalog error; demo mode remains available when no URL is configured.

## What a TrustGate decision means

- **Policy evaluation:** editable deterministic metadata thresholds, configurable BLOCK/REVIEW outcomes, required evidence, and policy version fingerprint.
- **Evidence:** records source and capture/expiry times. Optional source-response evidence expires after 15 minutes; catalog reads are refreshed and checked for changes.
- **Decision certificate:** a downloadable record of a current READY evaluation, valid only until its expiry and only for the referenced policy, evidence, and asset snapshot.
- **Decision trace:** JSON with the active policy, evaluation checks/reasons, evidence provenance, timestamps, fingerprints, and optional issued certificate.

This is a portfolio demonstration, not a production certification authority, signature, access grant, data-quality guarantee, security approval, regulatory attestation, or compliance certification. A certificate is not cryptographically signed; verify the source system and controls independently before relying on decisions operationally.

## Python metadata validator

The standalone validator checks JSON product contracts; it is independent of the browser demo and does not call the live API.

```bash
python3 trustgate.py examples/ready.json
python3 trustgate.py examples/review.json
python3 trustgate.py examples/blocked.json
```

The `ready.json` fixture contains a fixed synthetic refresh timestamp and will naturally age into `REVIEW` after 24 hours. The tests use a controlled clock for repeatable results.

## Tests

Requirements: Python 3.10+ and Node.js 18+. Both test suites use built-in libraries; no dependencies need to be installed.

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_trustgate_ui.mjs
node --check trustgate-core.mjs
node --check trustgate-ui.mjs
```

The tests cover Python contract decisions and OpenMetadata normalization, browser-side metadata/source checks, policy evaluation, evidence requirements, staleness, readiness gating, and certificate scope/expiration. A real OpenMetadata connection and live source check require network access and a configured service.
