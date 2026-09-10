# SIH2026-TRACE

The repository of team TRACE for Smart India Hackathon 2026.

# TRACE

An offline-first field app for documenting lead-acetate H₂S indicator strips alongside a reference strip. It samples both regions, converts their sRGB values to CIELAB, calculates normalized colour change, and uses a locally trained RBF ε-SVR to estimate H₂S concentration and shift dose (ppm·h).

## Run locally

This edited copy uses the DarkGlassAdmin theme (navy glass panels, violet–blue accents) plus hover, tilt, and inertia scroll. Open `index.html` in a current browser. For reliable camera access, serve this folder on localhost, for example:

```powershell
py -m http.server 8080
```

Then open `http://localhost:8080`. It can be installed as a local PWA from a supported browser. All data, calibration samples, worker records, and captures stay in browser storage on that device. Use **Backup** regularly to export a portable JSON archive.

## Field workflow

1. Create or select a worker and start a shift.
2. Expose a prepared test strip and a matched unexposed reference strip using one fixed, documented sampling method.
3. In **Capture**, select **Test strip** and click the reacted strip; select **Reference** and click the adjacent reference. Each click samples a robust 28×28-pixel median patch.
4. Capture and analyse. The app reports CIELAB values and ΔE₇₆ relative to the reference.
5. During validation, enter certified concentration and exposure duration, then save each sample. At least five varied, quality-controlled samples are needed to train the local ε-SVR.
6. With a trained model, analyse new frames and save the estimated ppm and ppm·h to the active shift.

## Important validation note

This is a decision-support prototype, **not a safety instrument**. Lead-acetate strip staining depends on strip formulation/age, humidity, temperature, airflow, exposure geometry, illumination, camera processing, interfering gases, and operator procedure. Do not use its estimate to clear a hazardous area, determine regulatory compliance, or replace a calibrated direct-reading H₂S monitor. Establish a controlled calibration set against a traceable H₂S reference, define acceptance/error limits, and have the workflow reviewed by a competent industrial-hygiene professional before operational use.

The included approach is informed by McBride & Edwards, *Lead Acetate Test for Hydrogen Sulphide in Gas* (NBS Technologic Paper 41, 1914), which documents the material effects of paper condition, gas flow, exposure time, and testing apparatus.

## Data model

- `workers`: local worker ID, name, role, optional employee ID, and historical shift doses.
- `shifts`: worker-linked sessions containing sampling events and cumulative estimated ppm·h.
- `calibration`: labeled feature vectors (`ΔL*`, `Δa*`, `Δb*`, `ΔE₇₆`, duration) and a serialized local SVR model.

No identifying data leaves the browser unless the operator exports a backup.

