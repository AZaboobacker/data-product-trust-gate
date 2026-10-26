# Data Product Trust Gate

A lightweight, explainable demo for validating fictional data-product metadata against a declared readiness policy. It pairs a deterministic Python validator with an animated browser demo.

## Demo

Open `index.html` in a browser. Choose Ready, Review, or Blocked and run the checks to see the evidence for each result.

## Validator

Run the standard-library test suite:

```bash
python3 -m unittest discover -s tests -v
```

Evaluate the sample products:

```bash
python3 trustgate.py examples/ready.json
python3 trustgate.py examples/review.json
python3 trustgate.py examples/blocked.json
```

The validator returns `READY`, `REVIEW`, or `BLOCKED` and lists each check, its evidence, and the policy version. It uses only Python's standard library.

## Project boundary

This is an independent portfolio demonstration using synthetic data. It validates declared metadata against a sample policy. It does not authenticate users, grant access, certify production data, or connect to external systems.
