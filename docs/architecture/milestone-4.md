# Milestone 4 — Prepress & Production Rendering

## Scope

Milestone 4 converts the platform-owned `EditorDocumentV1` into a private DTG production master and records a structured prepress decision. It deliberately does not call Printify, create a provider derivative, qualify a provider/profile, submit an order, or expose a production file.

## Asset hierarchy

```text
Editable Master: immutable ProjectVersion.editorDocument + private source assets
  → Production Master: server-rendered 3600 × 4800 transparent PNG
  → Controlled Prepress Preview: browser-safe reduced derivative
  → Provider-specific Production Derivative: contract only; Milestone 5/G3
```

`assets` stores all private objects. `asset_lineage` links each production master to the original source assets. Consumer APIs return a constrained run summary and, where needed, a controlled preview asset ID. They never return production-master IDs, storage keys, source keys, source IDs, or permanent URLs.

## Deterministic rendering

`@let-it-be/prepress` owns `ProductionRenderer`. The Sharp/libvips implementation consumes canonical layers ordered by `zIndex`; Konva, browser layout, screenshots, and viewport size are not inputs.

Layers are normalized to the print area. For a profile with width `Wpx`, height `Hpx`, width `Win`, and height `Hin`:

```text
centrePx = (layer.x × Wpx, layer.y × Hpx)
sizePx   = (layer.width × Wpx, layer.height × Hpx)
sizeIn   = (layer.width × Win, layer.height × Hin)
```

Crop is applied to the source rectangle first, then resized to the layer dimensions, opacity is applied, and the layer is rotated clockwise about its centre before sequential composition. The master canvas starts fully transparent and is encoded as PNG. A hash of decoded RGBA pixels, not container metadata, verifies deterministic output for a fixed document, source bytes, font files, renderer version, and profile.

Text uses bundled Fontsource WOFF files resolved by stable Milestone 3 font IDs. OpenType glyph paths are composed into SVG and rasterized by Sharp. There is no system-font fallback: unavailable or unsupported fonts fail the run safely.
Deployments may set `PREPRESS_FONT_ROOT` to their bundled Fontsource directory; otherwise the renderer checks the explicit web/prepress package locations.

## Development DTG profile

`development-essential-dtg-front-v1` is a 12 × 16 inch, 3600 × 4800 pixel, 300-DPI DTG profile. It is explicitly `UNQUALIFIED / DEVELOPMENT`, is not a Printify specification, and has no provider ID. Its warning/block DPI thresholds (200/120) are pre-G3 development rules. The profile schema already separates product, optional provider, decoration method, and qualification status for Milestone 5/G3.

## Preflight and score

Deterministic checks validate output dimensions, profile dimensions, source availability, effective DPI, print bounds, safe bounds, transparency, controlled source-background signals, contrast against the selected garment color, and font availability. Findings are persisted as machine-readable category, code, severity, layer ID, message, and evidence.

Heuristic checks for background edges and fine detail remain conservative development hooks. The final moderation hook is also represented but remains `UNKNOWN` until the later moderation milestone. Neither heuristic nor future AI check is claimed as perfectly reliable.

The locked 100-point score is:

- Resolution: 25
- Placement/clipping: 20
- Alpha/transparency: 15
- Edge/background: 10
- Contrast: 10
- Provider compatibility: 10
- Artifact detection: 10

Bands are GREEN 90–100, AMBER 75–89, and RED below 75. BLOCKER findings always block readiness regardless of the numerical score. Warnings result in `REVIEW_REQUIRED`; the unqualified development profile intentionally produces a compatibility warning.

## Lifecycle

```text
ProjectVersion → PENDING → RENDERING → VALIDATING
  → PASSED | REVIEW_REQUIRED | BLOCKED
  ↘ FAILED → retry PENDING
```

Runs are queued through the existing queue contract with a version/profile/renderer idempotency key. A duplicate request returns the same non-failed run. Failed runs can be retried safely with an incremented queue key. A blocked draft is retained and editable; it is never deleted or overwritten.

## Consumer surface and reviewer foundation

The editor shows consumer-friendly Print Quality status, warnings, and a score only after an authorized server preflight request. It disables future continuation for an invalid placement or a BLOCKED prepress result. Future reviewers can query persisted project/version, product/color, profile, physical dimensions, score, findings, asset lineage, and controlled preview data; Milestone 4 does not build their queue.

## G3 boundary

Milestone 4 provides the profile schema, renderer, score, findings, and lineage needed to qualify a future Product + Print Provider + Decoration Method combination. G3 still requires real Printify/product/provider data, approved combinations, physical test prints, placement and quality comparison, threshold tuning, and an approval decision.
