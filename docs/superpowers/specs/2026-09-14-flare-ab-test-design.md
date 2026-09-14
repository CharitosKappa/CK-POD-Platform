# GPT-Image 2.5 Flare Temporary A/B Test

## Goal

Compare `gpt-image-2.5-flare` with the current `gpt-image-2.5-sunburst` path for apparel artwork quality and end-to-end generation speed without changing the store's permanent model default.

## Experiment design

- Keep `gpt-image-2.5-sunburst` as the configured default.
- Allow `gpt-image-2.5-flare` as a validated image-model override.
- Start the local development server with a temporary `OPENAI_IMAGE_MODEL=gpt-image-2.5-flare` process override.
- Keep every other generation variable unchanged:
  - quality `medium`;
  - output size `1024x1024`;
  - PNG output with transparent background;
  - prompt pipeline `m4.5-v2`;
  - the same style, tone, garment, and color context;
  - the same alpha/transparency validation;
  - no automatic paid provider retry.

## Comparison method

The user will create the Flare sample through the existing mobile flow. The result will be compared with the recent Sunburst medium samples using:

- database-recorded end-to-end duration;
- provider latency;
- queue and validation/storage duration;
- recorded `model_identifier` to prove which model ran;
- alpha-validation outcome;
- visual quality of composition, typography, detail, and garment suitability.

For the fairest visual comparison, the user should reuse the same prompt and configuration as the Sunburst sample. Image generation remains stochastic, so one sample is directional; multiple samples are required before choosing a permanent default.

## Failure and rollback

- A provider or transparency-validation failure remains visible and does not consume a Design Credit.
- No fallback may silently replace a paid Flare request with deterministic artwork.
- Restarting the local server without the temporary override restores Sunburst immediately.
- The experiment adds no customer-facing model selector and makes no permanent product decision.

## Out of scope

- Permanently replacing Sunburst.
- Building an admin or customer model selector.
- Changing prompt design, quality, dimensions, pricing, credit rules, or print-area behavior.
