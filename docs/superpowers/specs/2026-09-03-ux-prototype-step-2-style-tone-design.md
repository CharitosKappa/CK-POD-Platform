# UX Prototype — Step 2: Style, Tone, and Default-first Look

## Purpose and boundary

Evolve only `apps/ux-prototype` from its Step 1 boundary to a reviewable Step 2. The consumer flow is `Idea → Style + Tone → Color / Size → Generate`. Step 2 is one mobile-first page; it must not start generation or access a backend, database, provider, payment, fulfillment, or production application service.

Step 1 retains its approved rendering, behavior, shell, drawer, garment treatment, A/B/C theme architecture, responsive rules, spacing, typography, card treatment, and CTA styling. The `2 / 4` progress indicator remains an open UX item and is retained for this prototype revision.

## Consumer page

The page keeps its established hierarchy:

1. Heading and short supporting copy.
2. **Choose a style**: exactly one of six visual cards is required: Vintage & Retro, Illustrated, Streetwear & Y2K, Typography, Minimal & Modern, or Dark & Alternative.
3. **Set the tone**: Auto (the default), Funny, Sarcastic, Bold, Cute, Dark, or Heartfelt. The controls wrap cleanly to two or more rows at narrow mobile widths; no target is shrunk merely to fit a single row.
4. A visible, low-emphasis default-first recommendation card: `AI-PICKED LOOK`, the current recommended consumer-facing look name, `We think this fits your idea best.`, and secondary `Change look →` affordance.
5. `Continue to color & size →` remains the primary CTA and is blocked only until a Style is chosen.

The consumer never sees the terms *Substyle*, *visual recipe*, or *AI routing*. They can continue with Tone set to Auto and the recommendation untouched.

## Optional Look control

`Change look →` expands inline within the current page. This preserves the current one-page mobile composition and avoids introducing a new navigation surface. The expansion is labelled `Choose a look` and offers:

- `Let AI choose — Recommended` (the default);
- only the four consumer-facing look names associated with the selected Style.

When untouched or reset, the collapsed card says `AI-PICKED LOOK` and explains that the system selected it. A manual choice changes the card to `YOUR LOOK`, displays the chosen name, and says `Chosen by you.` A low-emphasis return to `Let AI choose` is available inside the expansion. The user must never infer rather than see whether the result is automatic or manual.

## Local deterministic model

The isolated client holds the Step 1 prompt, selected Style, selected Tone, `aiRecommendedSubstyle`, optional `manualSubstyleOverride`, and `effectiveSubstyle`.

`effectiveSubstyle = manualSubstyleOverride ?? aiRecommendedSubstyle`.

Each Style owns four local fixtures:

| Style | Available looks |
| --- | --- |
| Vintage & Retro | 70s Retro; 80s/90s Throwback; Heritage; Bootleg & Distressed |
| Illustrated | Bold Cartoon; Hand Drawn; Comic / Manga; Surreal / Psychedelic |
| Streetwear & Y2K | Cyber Y2K; Grunge Streetwear; Racing / Motorsport; Pop / Coquette Y2K |
| Typography | Bold Statement; Retro Type; Hand Lettered; Experimental Type |
| Minimal & Modern | Line Art; Geometric / Bauhaus; Minimal Symbol; Clean Type |
| Dark & Alternative | Gothic Engraving; Tattoo Flash; Heavy Metal; Dark Fantasy |

The mock resolver is deterministic, inspectable, and semantic rather than ordinal. Each explicit Tone maps to a named look within its Style family:

| Style | Funny | Sarcastic | Bold | Cute | Dark | Heartfelt | Auto fallback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vintage & Retro | 80s/90s Throwback | Bootleg & Distressed | Bootleg & Distressed | 70s Retro | Bootleg & Distressed | Heritage | Heritage |
| Illustrated | Bold Cartoon | Bold Cartoon | Comic / Manga | Hand Drawn | Surreal / Psychedelic | Hand Drawn | Hand Drawn |
| Streetwear & Y2K | Pop / Coquette Y2K | Grunge Streetwear | Racing / Motorsport | Pop / Coquette Y2K | Grunge Streetwear | Cyber Y2K | Cyber Y2K |
| Typography | Bold Statement | Retro Type | Bold Statement | Hand Lettered | Experimental Type | Hand Lettered | Clean Type |
| Minimal & Modern | Minimal Symbol | Clean Type | Geometric / Bauhaus | Line Art | Geometric / Bauhaus | Line Art | Minimal Symbol |
| Dark & Alternative | Tattoo Flash | Gothic Engraving | Heavy Metal | Dark Fantasy | Dark Fantasy | Tattoo Flash | Gothic Engraving |

For Auto, a small keyword rule set first infers a consumer tone from the Step 1 prompt: dark/horror/metal/skull/night terms infer Dark; ironic/sarcastic/obviously/Monday terms infer Sarcastic; joke/funny/comedy terms infer Funny; love/family/tribute/memory terms infer Heartfelt; cute/sweet/pet/flower terms infer Cute; and power/strong/racing/street terms infer Bold. The resolver then uses that Style's explicit semantic mapping. If no rule matches, it uses the Style-specific Auto fallback. Thus the raccoon, Monday, and “Obviously” example with Illustrated + Sarcastic resolves to Bold Cartoon without a prompt hash.

A Style change clears the manual override and recomputes the recommendation. A Tone change always recomputes the recommendation in the background, but retains a compatible manual override. `Let AI choose` removes the override and immediately makes the latest recommendation effective.

Prototype Controls expose selected Style, selected Tone, recommendation, manual override, and effective look outside the consumer UI.

## Visual preservation and verification

Only the final optional-control section changes. Existing Style card placeholders remain replaceable presentation fixtures for future representative artwork; no asset-generation task is included. The page stays horizontally safe at 360×800, 390×844, and 430×932.

Verification covers visual and functional preservation of Step 1; single Style and Tone selection; Auto default; usable wrapped Tone targets; recommendation visibility; inline Change look expansion; Style-specific look lists; default/reset/manual override behavior; resolver recomputation; blocked CTA without Style; no API/generation side effects; format, lint, typecheck, and build.
