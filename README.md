# TrustGate — Data Product Readiness Demo

TrustGate is an independent portfolio project that makes data-product readiness decisions inspectable. It supports fictional metadata, a public city-weather API, and a read-only OpenMetadata catalog adapter; it has no employer branding or private data.

## Run the demo

Requirements: Python 3.10+ and a modern browser. No package install is needed. OpenMetadata connection requires a Personal Access Token with read access.

From the repository directory, run:

```bash
python3 trustgate_server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop the server with **Ctrl+C**. Use `python` instead of `python3` on Windows if needed. The local server binds only to loopback. Metadata checks and scenario presets work offline.

### Demo walkthrough

1. Choose **Ready**, **Needs review**, or **Blocked** to see how the metadata decision changes.
2. Edit the owner, business description, declared refresh age, or comma-separated schema fields. The attestation recalculates immediately.
3. Choose **Run animated checks** to watch each metadata rule execute.
4. Choose **Check live source** to call Open-Meteo for current conditions in New York. A passing result requires an HTTP success, the expected current fields and numeric values, and a recent timestamp. Source evidence must be refreshed after 15 minutes.
5. With ready metadata, fresh passing source evidence, and all five self-declared controls selected, choose **Issue readiness certificate** and **Download JSON**.
6. Edit metadata or a control after issuance: the certificate is invalidated. The demo certificate expires after 24 hours.

### Connect an OpenMetadata catalog

1. Open **Connect a catalog**. The endpoint defaults to the public OpenMetadata sandbox (`https://sandbox.open-metadata.org`).
2. Paste a Personal Access Token for an account that can read tables, then choose **Connect and load assets**. The shared sandbox requires authentication for catalog data. Create the token in your OpenMetadata profile's access-token settings.
3. Choose a table and select **Load asset into TrustGate**. TrustGate maps its catalog owner, description, and columns into the editable metadata checks. The catalog's `updatedAt` value is shown as metadata context; it is not treated as the table's data refresh time.
4. Choose **Check live source** to re-fetch the asset by ID. This verifies that the catalog entry is still present; it does not test the underlying table data or prove its quality.

The integration is read-only. The token is sent to the local TrustGate server, held in process memory only, and cleared when the server stops. It is not saved in browser storage or written to disk. The generic adapter currently targets OpenMetadata's REST API; other catalogs need an adapter implementation.

## What the three evidence layers mean

1. **Metadata attestation** — deterministic checks for an owner, a business description, a declared refresh age of no more than 24 hours, and at least eight distinct schema field names. Missing/invalid essentials block; over-limit freshness requires review.
2. **Live source verification** — a read-only check against Open-Meteo's current-conditions endpoint. It checks response success, required fields, numeric values, and timestamp recency. It does not prove the full dataset's correctness or quality.
3. **Purpose-specific readiness certificate** — a downloadable record containing the metadata snapshot, live-source evidence, policy version, timestamps, and five author-declared readiness controls. The controls are not independently verified; this is not a production, access, security, regulatory, or compliance certification.

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

The tests cover Python contract decisions, browser-side metadata and source evidence rules, missing/stale/future source data, 15-minute evidence freshness, readiness gating, and certificate scope and expiration. The UI is designed to run locally; a real live source check requires browser internet access.
