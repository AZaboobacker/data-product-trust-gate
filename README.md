# Data Product Trust Gate

TrustGate is a portfolio demo that distinguishes a metadata attestation, a live source check, and a purpose-specific readiness certificate. It uses a city-weather example and fictional product metadata.

## Run the browser demo

No installation is needed. Clone or download the repository, then open `index.html` in a modern browser. Edit the metadata and observe the attestation update. Choose **Animate metadata checks** to see the checks run. Select **Check live Open-Meteo source** to call the public weather API for New York. After metadata checks pass, the source check passes, and all five declared controls are selected, choose **Issue readiness certificate**. Download the issued certificate as JSON.

The live check requires internet access. If direct local-file browser requests are blocked, run a simple local server from the repository directory with `python3 -m http.server 8000` and open `http://localhost:8000`.

## Three evidence layers

1. **Metadata attestation** checks owner, description, declared refresh age (24-hour limit), and at least eight named fields. These values are edited in the demo and are not fetched from the API.
2. **Live source verification** calls Open-Meteo and checks response success, expected hourly fields, and recency of the returned observation. It is a read-only request and needs no API key.
3. **Readiness certificate** requires passing metadata and live-source checks plus five explicitly self-declared controls: intended use, sensitivity, access policy, lineage, and quality expectations. It creates a downloadable JSON record with a unique ID, issue and expiry times, policy version, evidence, and scope.

Changing metadata or controls invalidates an issued certificate. The sample certificate expires after 24 hours. Governance controls are self-declared; they are not independently verified.

## Python validator and tests

Requires Python 3.10 or newer; no third-party packages are needed.

```bash
python3 trustgate.py examples/ready.json
python3 trustgate.py examples/review.json
python3 trustgate.py examples/blocked.json
python3 -m unittest discover -s tests -v
```

On Windows, replace `python3` with `python` if needed. The Python validator checks JSON contracts independently from the browser UI; it does not call the live API.

## Important scope limits

This demo is not a production control, access grant, or regulatory certification. The live check verifies only API availability, selected response fields, and returned observation recency. It does not establish correctness or safety of all source data. Governance controls are declarations, not verified evidence. No employer systems, credentials, or private data are used.
