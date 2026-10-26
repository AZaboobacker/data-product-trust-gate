# Data Product Trust Gate

A small portfolio demo that evaluates declared metadata for a fictional city-weather data product and issues a scoped **Metadata Readiness Attestation**. The browser UI lets you edit metadata and see the checks and decision update immediately, with an animated check run.

## Run the UI

Open `index.html` in a modern browser. Edit the owner, description, refresh age, or comma-separated schema fields. The status updates live; select **Issue readiness attestation** to watch each validation step.

## Run the Python validator

Requires Python 3.10+ and no third-party packages.

```bash
python3 -m unittest discover -s tests -v
python3 trustgate.py examples/ready.json
python3 trustgate.py examples/review.json
python3 trustgate.py examples/blocked.json
```

The validator returns `READY`, `REVIEW`, or `BLOCKED` with evidence for contract structure, ownership, description, freshness, and required fields.

## Attestation scope

This is an independent demo using synthetic metadata. The attestation verifies only the declared metadata checks in the demo policy. It does not verify live source records, authenticate users, grant access, or certify legal, regulatory, or production-data compliance. The UI currently does not call the Python validator or connect to the named public source.
