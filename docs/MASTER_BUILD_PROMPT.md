# MASTER BUILD PROMPT — Project Let It Be

> **Document Type:** Product Requirements Document + Technical Design Specification + Execution Contract
> **Audience:** Codex + Project Specialist Personas
> **Status:** Build-Ready, subject to explicit Execution Gates
> **Primary Market:** USA
> **MVP Product:** DTG T-shirts
> **Primary Persona:** Consumer
> **Target Launch:** Q4 2026

---

# 1. Role and Operating Mode

You are Codex acting as the principal implementation agent for **Project Let It Be**, supported by the following specialist personas:

- Founder / CEO
- CTO / Founding Engineer
- AI/ML Engineer — Generative Imaging
- Senior Frontend Engineer — Canvas / WebGL
- Product Designer — UX/UI
- Print Production / Prepress Specialist
- Performance Marketing & Growth Manager
- Email & SMS Marketing Specialist
- Customer Experience & Order Operations Associate
- Fractional CFO
- Fractional IP Counsel

You must behave as an engineering execution team, not as a generic coding assistant.

Your task is to design, implement, test, document and incrementally deliver the MVP according to the requirements below.

You MUST NOT:
- invent product decisions that contradict this specification,
- silently replace business requirements with personal assumptions,
- hardcode external providers when the architecture requires adapters,
- build non-MVP features unless required as enabling infrastructure,
- skip required validation, security or test steps,
- submit production orders to Printify without passing the required review gates,
- expose production-resolution assets to the browser,
- allow downloadable/exportable customer design files,
- treat a passing visual preview as equivalent to a print-ready production asset.

When an unresolved detail blocks implementation:
1. classify it as `IMPLEMENTATION DETAIL`, `EXECUTION GATE`, or `PRODUCT DECISION REQUIRED`;
2. continue with all non-blocked work;
3. create a documented assumption only if the requirement permits it;
4. never silently choose a product/business policy on behalf of the CEO.

---

# 2. Product Vision

Build an AI-powered custom apparel platform that allows a consumer to:

1. select a T-shirt,
2. select its color,
3. describe an idea using a text prompt and/or uploaded image,
4. generate a high-quality printable design,
5. edit it using a constrained merchandise editor,
6. preview it accurately on the selected product,
7. approve the final design and placement,
8. pay,
9. have the platform validate, route and submit the order to an approved Printify fulfillment path,
10. receive the physical product.

The platform is NOT primarily an image-generation tool.

The product is the complete transition:

**Idea → Guided Style → AI T-shirt Design → Simple Editing → Print Validation → Product Preview → Checkout → Production → Delivery**

---

# 3. Core Product Principles

## 3.1 Consumer First
The MVP is for a normal independent consumer, not a professional graphic designer or merchandise business.

The intended user may have:
- no design experience,
- no knowledge of print production,
- no knowledge of Printify,
- no knowledge of DPI, bleed, transparency, underbase, DTG or provider routing.

The product must hide production complexity behind simple UX.

## 3.2 Physical Product, Not Export Tool
The platform exists to sell physical merchandise.

Users MUST NOT be able to:
- download generated designs,
- export production-ready designs,
- directly access original production assets,
- obtain public permanent URLs for full-resolution production files.

OS-level screenshots cannot be technically guaranteed to be prevented. The platform should deter theft via preview-resolution assets, watermarking where applicable and server-side protection of production masters.

## 3.3 Print-Aware AI
AI output is not considered final until it has passed print-specific processing and validation.

## 3.4 Provider-Agnostic Architecture
AI providers, payment providers, fulfillment providers and notification providers must be abstracted behind internal interfaces.

## 3.5 Human Review First, Automation Later
Initial paid orders must pass manual production review.

The system must collect structured operational data so that manual review can gradually be replaced by safe automation.

## 3.6 Guided Consumer Creation and Competitive Positioning
Kittl is a Tier-1 benchmark for the AI creation/editor experience, not a feature checklist for this product. Project Let It Be remains a consumer-focused AI merchandise commerce platform, not a general-purpose design platform.

The product should be powerful because a consumer barely has to do anything: it should guide an idea through curated visual direction, merchandise-specific AI generation, constrained editing, print intelligence, and commerce. Do not add a Kittl-, Canva-, Photoshop-, or Illustrator-style feature explosion.

Internal differentiation is the combination of zero-skill consumer creation, a structured curated style system, print intelligence and validation, commerce integration, fulfillment/provider routing, conversion-oriented UX, and accumulated generation-to-purchase data. It is not merely “AI generation + editor + POD”.

---

# 4. MVP Scope

## 4.1 MUST HAVE

### Product & Catalog
- USA market
- DTG T-shirt
- one primary T-shirt model
- core colors
- core sizes
- approved Printify provider set
- product-first user journey

### AI
- text-to-design
- image + text generation
- reference images
- uploaded image as print artwork
- uploaded image with light AI modifications
- prompt enhancement
- provider-agnostic multi-model orchestration
- one result per successful generation
- exact user-requested typography via deterministic text rendering where possible
- background removal where required
- internal output validation
- selected-element controlled regeneration
- structured, versioned guided Style Family → Substyle presets with visual metadata and provider-neutral conditioning
- prompt and upload moderation
- final production moderation

### Editor
- move
- resize / scale
- rotate
- crop
- edit text
- choose font
- text color
- basic artwork color adjustment
- layers
- layer visibility
- layer ordering
- lock layer
- delete layer
- snapping
- center guides
- alignment
- print boundaries
- safe area
- bleed display where applicable
- effective DPI indicator
- low-resolution warnings
- print-quality status
- product-color contrast warning
- autosave
- undo/redo
- desktop keyboard shortcuts
- mobile gestures
- simple mode
- advanced mode
- selected-element AI regeneration
- 2D accurate placement editor
- photorealistic product mockup preview

### Projects & Identity
- anonymous/guest creative session
- guest checkout
- optional account creation
- persistent projects for accounts
- account-based credit balance
- shareable project URLs with reduced-resolution/watermarked previews
- project/version snapshots

### Commerce
- cart
- Stripe-based custom checkout
- cards
- Apple Pay
- Google Pay
- quantity discounts capability
- free-shipping threshold capability
- tax engine abstraction
- Stripe Tax as initial candidate
- proof approval before payment
- order state machine
- refund/reprint workflows

### Production
- production master separate from editable master
- provider-specific production derivative
- prepress validation
- printability score
- provider compatibility rules
- manual order review
- approved provider matrix
- fulfillment routing engine
- Printify catalog sync
- shipping calculation
- Printify order creation
- explicit send-to-production step
- order status synchronization

### Moderation / IP
- no fan art
- no copyrighted characters
- no brand logos
- no explicit adult content
- no graphic violent/weapons content
- no celebrity likeness merchandise in MVP
- no recognizable public-person likeness merchandise in MVP
- political expression only within policy
- trademark/logo/character risk detection architecture
- final compliance gate before production
- human review for flagged items

### Admin / Operations
- admin dashboard
- review queue
- order management
- project/customer lookup
- provider matrix
- moderation flags
- reprints/refunds
- generation credits
- system failures
- audit trail for critical actions

### Analytics / Growth
- server-side product events where meaningful
- full creation-to-purchase funnel tracking
- campaign attribution fields
- generation-cost metrics
- provider defect metrics
- lifecycle email integration
- Klaviyo recommended for MVP

### Non-Functional
- 99.9% application availability target
- secure private asset storage
- idempotent external writes where possible
- retries
- structured error handling
- observability
- automated tests
- backups
- restore validation

---

# 5. Explicitly NOT MVP

Do not implement the following unless required purely as future-compatible abstractions:

- hoodies
- embroidery
- DTF expansion
- mugs
- posters
- all-over print
- back printing
- sleeve printing
- 3D garment preview
- marketplace
- designer revenue sharing
- public gallery remixing
- collaboration
- downloadable designs
- asset export
- high-resolution customer exports
- full vector editor
- freehand drawing
- Bézier/path editing
- Photoshop-style filter suite
- subscription monetization
- SMS marketing
- PayPal
- proprietary LoRA training
- third-party merchant Printify accounts
- Shopify embedded editor
- wholesale/bulk ordering
- generic Canva-style editor

---

# 6. Primary User Journey

The MVP journey should have approximately five major user-facing steps.

## Step 1 — Choose Product
User selects:
- T-shirt model
- color
- starting price is visible

## Step 2 — Describe Idea
User can:
- enter prompt
- upload one or more reference images within configured limits
- upload artwork intended for direct print
- choose a Style Family, then a Substyle, through visual examples, concise names, and optional consumer-friendly descriptions
- select optional typography preferences
- select pose/composition reference options where supported

CTA language should focus on the physical outcome.

Preferred primary CTA:
**Create Your T-Shirt**

Preferred prompt CTA:
**Describe Your Idea**

## Step 3 — Generate
- prompt is enhanced internally
- enhanced prompt is NOT shown to the user by default
- prompt/upload moderation occurs
- model router selects generation provider
- output is validated internally
- user sees one valid result
- failed internal outputs do not consume credits

## Step 4 — Make It Yours
User enters constrained merchandise editor.

Simple Mode exposes only essential controls.

Advanced Mode exposes layer-aware controls and controlled AI regeneration.

## Step 5 — Order
User:
- confirms size
- confirms quantity
- sees product preview
- sees shipping/delivery estimate
- approves proof
- enters checkout
- pays

---

# 7. Product UX Requirements

## 7.1 Avoid Blank Canvas
Use:
- example prompts
- visual Style Family → Substyle choices with example artwork
- starter ideas
- gift-oriented prompts
- context-aware ideas based on product/color

Do not require the user to understand design terminology.

## 7.6 Guided Style Selection
Style selection supplements the user’s idea; it never replaces it. The consumer journey is approximately:

```text
Choose T-shirt / color
  → Describe the idea
  → Choose Style Family
  → Choose Substyle
  → Generate
  → Edit
  → Validate / preview
  → Order
```

Style Families and Substyles are primarily visual choices. Show a thumbnail or example artwork, concise name, and optional short description. Do not expose model names, samplers, lighting or perspective parameters, rendering engines, prompt weights, or other prompt-engineering controls.

## 7.2 Contextual Recommendations
The platform may suggest:
- “This design has low contrast on Navy.”
- “Try Black or White.”
- “This artwork may print better at a larger size.”

Do not automatically modify the user’s design without explicit action.

## 7.3 Pricing Display
Show product pricing from product selection onward using “from …” where necessary.

Generation-credit cost should not dominate the physical product UI.

## 7.4 Delivery
Show an approximate delivery range before checkout where reliable.

Show exact available shipping options and price at checkout.

## 7.5 Proof Approval
Before payment, persist:
- approved project version ID
- approved mockup version
- production preview hash/reference
- timestamp
- user approval event

---

# 8. System Architecture

Use a **modular monolith** for MVP.

Avoid unnecessary microservices.

## 8.1 Recommended Technology Direction

### Frontend
- Next.js
- React
- TypeScript

### Backend
- TypeScript
- modular domain-oriented application layer

### Database
- PostgreSQL

### Asset Storage
- S3-compatible private object storage

### Jobs
- Redis-backed queue or equivalent managed asynchronous job system

### Observability
- structured logs
- error tracking
- OpenTelemetry-compatible instrumentation
- metrics for generation, checkout, order processing and provider failures

### Infrastructure
Prefer managed services and simple operational topology.

## 8.2 Domain Modules

- Identity
- Sessions
- Users
- Projects
- Project Versions
- Assets
- AI Orchestration
- Moderation
- Editor
- Product Catalog
- Product Profiles
- Prepress
- Mockups
- Pricing
- Cart
- Checkout
- Payments
- Taxes
- Orders
- Fulfillment
- Printify Adapter
- Routing
- Credits
- Notifications
- Analytics
- Admin
- Audit Log

---

# 9. External Provider Abstraction

Do not bind business logic directly to vendors.

Create internal interfaces.

```ts
interface ImageGenerationService {
  generate(request: GenerationRequest): Promise<GenerationResult>;
  edit(request: EditRequest): Promise<GenerationResult>;
}

interface PaymentService {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
  refund(request: RefundRequest): Promise<RefundResult>;
}

interface FulfillmentService {
  getCatalog(): Promise<CatalogSnapshot>;
  calculateShipping(request: ShippingRequest): Promise<ShippingQuote[]>;
  createOrder(request: FulfillmentOrderRequest): Promise<FulfillmentOrder>;
  submitToProduction(orderId: string): Promise<void>;
  getOrderStatus(orderId: string): Promise<FulfillmentStatus>;
}

interface LifecycleMessagingService {
  trackEvent(event: LifecycleEvent): Promise<void>;
}
```

Initial adapters may include:
- OpenAI
- Google
- Stripe
- Printify
- Klaviyo

---

# 10. Canonical Project Data Model

The canonical editor/project schema MUST belong to the platform.

Do not store editor state only as opaque serialized state from a canvas library.

Conceptual model:

```ts
Project {
  id
  ownerType
  ownerId?
  sessionId?
  productSelection
  activeVersionId
  status
  createdAt
  updatedAt
  expiresAt?
}

ProjectVersion {
  id
  projectId
  versionNumber
  editorDocument
  sourceAssetRefs[]
  generationMetadata
  createdAt
  createdBy
}

EditorDocument {
  canvas
  printArea
  layers[]
}

Layer =
  ImageLayer
  | TextLayer
  | GeneratedLayer
```

The final implementation may refine the schema but must preserve these boundaries.

---

# 11. Asset Model

Separate:

## Source Asset
Original upload or original AI result.

## Preview Asset
Reduced-resolution browser-safe asset.

## Editable Master
Canonical composition/document.

## Production Master
High-resolution canonical production render.

## Provider Derivative
Specific to:
- product
- Printify blueprint
- Print Provider
- print area
- decoration method
- physical dimensions
- placement

The browser must not receive the production master unless strictly required.

---

# 12. AI Orchestration

The AI layer must be task-oriented, not provider-oriented.

Tasks:
- prompt understanding
- structured preset resolution and provider-neutral conditioning
- prompt enhancement
- text-to-artwork
- reference-to-artwork
- image editing
- selected-element edit
- background removal
- upscale
- prompt-alignment validation
- visual artifact detection
- safety classification
- IP-risk classification

Model routing may consider:
- task
- quality
- latency
- cost
- provider availability
- previous failure
- image/reference inputs
- policy compatibility

---

# 13. AI Provider Benchmark — EXECUTION GATE G1

Do not permanently hardcode final generation routing before benchmark completion.

Benchmark at least two current suitable providers/models and optionally a third meaningful candidate.

Dataset:
- 20 typography-heavy concepts
- 15 vintage
- 15 illustrated
- 10 photorealistic
- 10 cartoon
- 10 dark-garment optimized
- 10 light-garment optimized
- 10 reference-image/editing
- at least 20 controlled-edit tests

Scoring:
- Prompt adherence: 20%
- Visual quality: 20%
- Print suitability: 15%
- Composition control: 10%
- Reference adherence: 10%
- Edit consistency: 10%
- Text handling: 5%
- Latency: 5%
- Cost: 5%

Output:
- score table
- sample gallery
- cost table
- latency distribution
- task-by-task winner
- primary provider recommendation
- fallback recommendation
- editing-provider recommendation

General application development must continue while G1 is pending.

---

# 14. Prompt Pipeline

```text
Raw User Input
  ↓
Intent Parsing
  ↓
Product Context Injection
  ↓
Color Context Injection
  ↓
Structured Preset Resolution (Style Family → Substyle → version)
  ↓
Style Conditioning
  ↓
Required Exact Text Extraction
  ↓
Prompt Enhancement
  ↓
Safety / IP Pre-check
  ↓
Generation
  ↓
Deterministic Typography
  ↓
Image Cleanup
  ↓
Prompt Alignment Validation
  ↓
Print Validation
  ↓
User Preview
```

The enhanced prompt remains internal by default.

## 14.1 Structured Preset Engine
Meeting #004 supersedes any prior flat “approximately 6–10 style presets” requirement. The platform must use a hierarchical Style Family → Substyle catalog whose entries can evolve without application logic being coupled to display names or a fixed list.

Each versioned preset configuration must support at minimum:
- stable Style Family ID, preset ID, and preset version
- display name, consumer-friendly description, and visual thumbnail/example artwork metadata
- prompt conditioning
- composition guidance
- typography guidance
- color strategy
- texture/detail guidance
- print-oriented constraints
- optional provider-neutral AI routing hints

The user’s prompt remains central. Provider-specific prompt translation belongs behind the existing task-oriented AI boundary; no preset may be encoded solely as a provider-specific hardcoded prompt suffix.

---

# 15. Exact Typography

Required text must preserve:
- exact spelling
- capitalization
- punctuation
- selected font
- selected color
- selected placement

Prefer deterministic text layers over generation-model text whenever possible.

---

# 16. Generation Credits

**1 credit = 1 successful generation delivered to the user.**

Do not consume a credit when:
- provider fails
- provider times out
- internal validation rejects output
- internal moderation rejects a generated result before delivery

Consume when:
- validated output is delivered
- user asks for another generation due to preference

Free usage:
- guest: 1 free generation
- registered user: additional configurable allowance after G2

Implement rate limiting and abuse protection.

---

# 17. AI Economics — EXECUTION GATE G2

Measure:
- cost per successful generation
- validation retry rate
- generations per converted order
- edit/upscale/background processing cost
- AI cost/session
- AI cost/order

Output:
- free-credit recommendation
- credit pack pricing
- routing cost guardrails
- abuse threshold

Do not separately charge for required:
- background removal
- upscaling
- prepress
- validation

---

# 18. Editor Requirements

## Simple Mode
- move
- resize
- rotate
- crop
- edit text
- font
- text color
- simple color adjustment
- alignment
- center
- print boundaries
- safe area
- print-quality status

## Advanced Mode
- layers
- reorder
- visibility
- lock
- selected-element AI regeneration
- limited outline/stroke
- limited object-level editing

## Later / Out
- freehand masks
- distress suite
- vector paths
- drawing tools
- generic full-feature design environment

---

# 19. Canvas / Rendering

Use a 2D scene-graph-style editor.

A library such as Konva or equivalent may be used, but:
- the platform owns the canonical project model,
- server-side production rendering must be possible,
- transforms must be deterministic,
- editor and production renderer must share coordinate semantics.

---

# 20. Printify Catalog and Product Profiles

Maintain normalized local metadata for:
- ProductModel
- ProductVariant
- PrintifyBlueprint
- PrintProvider
- ProviderVariant
- PrintAreaProfile
- DecorationMethod
- ShippingProfile
- ProviderQualification

Support scheduled synchronization and manual refresh.

---

# 21. Approved Production Matrix — EXECUTION GATE G3

Before production launch, define:

**Product + Print Provider + Decoration Method → Qualification Status**

Statuses:
- CANDIDATE
- TESTING
- APPROVED
- DEGRADED
- DISABLED

Evaluate:
- product quality
- placement consistency
- print quality
- reliability
- shipping performance
- defects/reprints
- cost
- supported variants

Never assume two providers using the same blank are equivalent.

---

# 22. Prepress Pipeline

```text
Editable Master
  ↓
High-Resolution Render
  ↓
Background / Alpha Cleanup
  ↓
Target Product Profile
  ↓
Effective DPI
  ↓
Transparency Validation
  ↓
Edge Validation
  ↓
Contrast Validation
  ↓
Placement Validation
  ↓
Provider Compatibility
  ↓
Provider Derivative
  ↓
Printability Score
```

---

# 23. Effective DPI

Calculate effective DPI from rendered pixels and physical print dimensions.

General target:
- 300 effective DPI where appropriate

Hard minimum:
- profile-dependent
- configurable

Do not implement one universal rule for all future products.

---

# 24. Prepress Checks

MVP checks:
- dimensions
- effective DPI
- print-area fit
- clipping
- alpha
- problematic transparency
- edge quality
- background correctness
- contrast
- obvious artifacts
- fine-detail compatibility where detectable
- provider compatibility
- placement
- moderation/IP status

---

# 25. Printability Score

0–100.

Initial weighting:
- effective resolution: 25
- placement/clipping: 20
- alpha/transparency: 15
- edge/background: 10
- contrast: 10
- production compatibility: 10
- artifact detection: 10

State:
- 90–100 GREEN
- 75–89 AMBER
- below 75 RED

At initial launch, ALL paid orders still receive human review.

---

# 26. Mockups

Use:
- accurate 2D placement editor
- photorealistic garment preview

Do not build 3D or lifestyle mockup generation for MVP.

---

# 27. Fulfillment Routing

Own the routing decision layer.

## Eligibility
Exclude when:
- unavailable
- incompatible
- unapproved
- unsupported destination
- shipping unavailable
- margin below floor
- disabled
- print method incompatible

## Ranking Priority
1. production compatibility
2. availability
3. quality/reliability
4. delivery
5. total landed cost

Do not route solely by lowest cost.

---

# 28. Printify Integration

Implement:
- catalog sync
- blueprint/provider mapping
- variant availability
- shipping quotes
- order creation
- explicit production submission
- order status synchronization
- webhooks where available
- polling fallback
- error capture
- idempotent write strategy

---

# 29. Order State Machine

```text
DRAFT
PAYMENT_PENDING
PAID
PREPRESS_REVIEW
COMPLIANCE_REVIEW
ROUTING
READY_FOR_PRODUCTION
SUBMITTED_TO_PRINTIFY
IN_PRODUCTION
SHIPPED
DELIVERED
```

Exceptions:
```text
ON_HOLD
FAILED
CANCELLED
REPRINT_REQUIRED
REFUND_REQUIRED
```

Every transition must be auditable.

---

# 30. Manual Review

Initial launch:
- all paid orders enter review
- reviewer sees printability
- reviewer sees moderation status
- reviewer sees routing candidate
- reviewer can approve / hold / reject
- reviewer can change provider
- reviewer can regenerate derivative
- reviewer can initiate reprint/refund workflow

---

# 31. Exception Reason Codes

At minimum:
- LOW_DPI
- ALPHA_ERROR
- TRANSPARENCY_ERROR
- BACKGROUND_ERROR
- PLACEMENT_ERROR
- CONTENT_POLICY
- IP_RISK
- PROVIDER_UNAVAILABLE
- PROVIDER_DISABLED
- SHIPPING_FAILURE
- ADDRESS_ERROR
- PRINT_DEFECT
- WRONG_ITEM
- CUSTOMER_COMPLAINT
- AI_MISMATCH
- PAYMENT_ERROR
- CATALOG_MISMATCH

---

# 32. Commerce

Custom Stripe-based checkout abstraction.

MVP:
- card
- Apple Pay
- Google Pay
- cart
- quantity
- size
- color
- product/design reference
- discounts capability
- shipping threshold capability

Payment success must NOT automatically equal production submission.

---

# 33. Financial Model

Track:

```text
Revenue
- product cost
- shipping subsidy
- payment fees
- AI variable cost
- reprint/refund allowance
- variable SaaS/API cost
= Contribution Margin Before Ads

Contribution Margin Before Ads
- CAC
= Contribution Margin After Acquisition
```

Planning guardrails:
- gross margin target ≥ 50% where feasible
- contribution margin before ads target ≥ 40%
- long-term LTV:CAC target ≥ 3:1

---

# 34. Shipping

Customer pays below configurable threshold.

Free-shipping threshold determined after actual cost/AOV analysis.

Show approximate delivery before checkout where reliable.

Show final shipping option/price at checkout.

---

# 35. Tax Architecture

Use tax-engine abstraction.

Initial candidate:
- Stripe Tax

Never hardcode assumptions about US sales tax liability.

---

# 36. US Tax — EXECUTION GATE G4

Qualified tax/accounting review must determine:
- nexus
- registrations
- filings
- product classification
- state configuration

The application consumes configuration; it does not invent tax policy.

---

# 37. IP and Content Policy

Outcomes:
- ALLOW
- BLOCK
- REVIEW
- UNKNOWN

Initial policy:
- generic original concept → ALLOW
- user-owned personal photo → ALLOW
- user-owned artwork → ALLOW
- brand logos → BLOCK
- copyrighted characters → BLOCK
- fan art → BLOCK
- celebrity likeness → BLOCK
- recognizable public-person likeness → BLOCK
- adult explicit → BLOCK
- graphic violence/weapons → BLOCK
- protected lyrics → BLOCK
- political text/opinion → REVIEW / ALLOW within policy
- ambiguous trademark → REVIEW
- suspected unknown IP → REVIEW

---

# 38. Moderation Pipeline

```text
Prompt
  ↓
Text Moderation
  ↓
Upload / Reference Screening
  ↓
Generation
  ↓
Editing
  ↓
Final Artwork
  ↓
Final IP / Content Gate
  ↓
Human Review if flagged
  ↓
Production
```

No final order bypasses final compliance.

---

# 39. Legal / Privacy — EXECUTION GATE G5

Before public launch, validate:
- Terms
- Privacy Policy
- user-content license
- marketing opt-in
- DMCA/takedown
- repeat-infringer process
- retention
- GDPR rights
- US privacy obligations
- AI provider commercial-use terms
- children/minor uploads
- facial/biometric implications

Do not use customer content for fine-tuning in MVP.

---

# 40. Data Retention

Initial product defaults:
- guest unfinished project: 7 days
- registered project: 90 days from last activity
- purchased project: retained for service/order needs
- source uploads: tied to project unless needed for evidence
- deleted assets: scheduled active-system deletion
- accounting/order records: separate legal retention

Final schedule requires G5.

---

# 41. Authentication

Allow guest flow.

Account required for:
- persistent projects
- credit balance
- persistent history
- easier order access

Support guest-to-account migration without losing project.

Do not force registration before first free generation.

---

# 42. Project History

MVP:
- autosave
- ~50 session undo/redo actions
- snapshot after generation/regeneration
- snapshot before major destructive edit
- ~20 persistent versions for authenticated users

Make limits configurable.

---

# 43. Shareable Links

Share page:
- reduced resolution
- watermark as appropriate
- no production master
- no source asset
- revocable sharing

---

# 44. Admin Panel

Sections:
- Dashboard
- Orders
- Review Queue
- Projects
- Customers
- Provider Matrix
- Printify Status
- Moderation Flags
- Reprints / Refunds
- Credits
- Generation Failures
- System Failures
- Audit Log

Roles:
- Admin
- CX/Ops
- Prepress Reviewer

---

# 45. CX / Operations

Support:
- failed orders
- holds
- provider issues
- address issues
- credit complaints
- damaged products
- wrong items
- incorrect prints
- reprints
- refunds
- chargeback evidence
- customer/order lookup

Use structured outcomes/reason codes.

---

# 46. Email Lifecycle

Use Klaviyo or equivalent through an internal adapter.

MVP flows:
- account welcome
- saved project
- generated/no purchase
- cart abandonment
- checkout abandonment
- order confirmation
- shipping
- delivery
- review
- reorder / revisit

SMS is NOT MVP.

---

# 47. Analytics Events

Core events:
- session_started
- product_viewed
- product_selected
- color_selected
- prompt_submitted
- style_family_selected
- substyle_selected
- generation_started
- generation_succeeded
- generation_rejected_internal
- generation_failed
- regeneration_started
- editor_opened
- editor_action
- design_saved
- proof_approved
- add_to_cart
- checkout_started
- payment_succeeded
- order_approved
- order_submitted
- order_shipped
- order_delivered
- refund
- reprint

Useful dimensions:
- anonymous_id
- user_id
- project_id
- order_id
- product_id
- provider_id
- campaign
- adset
- creative
- generation_number
- style_family_id
- preset_id
- preset_version
- device
- printability score

Respect consent/privacy rules.

---

# 48. Primary Funnel

```text
Visitor
→ Product Selection
→ Guided Style
→ Generation
→ Valid Design
→ Editor
→ Proof
→ Cart
→ Checkout
→ Purchase
→ Successful Fulfillment
```

---

# 49. Mandatory KPIs

Track:
- Visitor → Generation
- Generation Success Rate
- Generation → Purchase
- Generations by Style Family / Substyle / preset version
- Successful Generations by Style Family / Substyle / preset version
- Generations per Order by preset
- Generation → Purchase conversion by preset
- AOV by preset where useful
- Refund and reprint rate by preset
- Product/color × preset performance
- Add-to-cart → Purchase
- Generations / Order
- AI Cost / Successful Generation
- AI Cost / Order
- AOV
- Gross Margin
- Contribution Margin
- CAC
- LTV:CAC
- Reprint Rate
- Refund Rate
- Chargeback Rate
- D30 Return-to-Create
- Repeat Purchase
- Provider Defect Rate
- Production Rejection Rate

Do not invent success thresholds before baseline data.

---

# 50. Reliability

Target:
**99.9% core application availability**

External dependency failure must degrade gracefully.

Examples:
- AI unavailable → fallback or clear unavailable state
- email unavailable → order continues
- analytics unavailable → checkout continues
- Printify unavailable → safe queued fulfillment only if duplicate production cannot occur

---

# 51. Idempotency

Mandatory for:
- payment callbacks
- order creation
- Printify submission
- refunds
- reprints
- webhook processing

Use:
- idempotency keys
- external request IDs
- persisted operation states
- duplicate detection
- safe retries

---

# 52. Security Baseline

Required:
- HTTPS
- secure cookies
- CSRF protection where applicable
- XSS mitigation
- parameterized DB access / ORM safeguards
- upload validation
- MIME validation
- file size limits
- private asset storage
- server-side secrets
- encryption at rest via managed services
- least privilege
- rate limiting
- auth throttling
- generation abuse controls
- webhook validation
- audit logs
- backups
- restore testing
- dependency scanning
- no raw card storage

---

# 53. Asset Security

Production masters:
- private
- non-public
- no permanent browser URL
- server-side use only
- short-lived signed URL only when operationally necessary

Previews:
- reduced resolution
- watermark where appropriate
- no original embedded asset

---

# 54. Physical Test Prints — EXECUTION GATE G6

Before production automation:
- test primary blank
- test every approved provider combination
- compare mockup to print
- test placement
- test detail
- test transparency
- test dark/light garments
- document defects

G6 output:
- approved provider matrix
- print profile updates
- printability threshold updates
- production automation recommendation

---

# 55. Testing Strategy

## Unit
- pricing
- credits
- printability
- routing eligibility
- routing ranking
- state transitions
- policy outcomes
- coordinate transforms
- DPI

## Integration
- Stripe
- Printify
- AI providers
- storage
- queues
- Klaviyo
- webhooks

## E2E
1. guest → generation → editor → checkout
2. guest → account → saved project
3. paid order → review → Printify
4. flagged IP → hold
5. AI failure → fallback
6. Printify failure → recover
7. refund/reprint
8. project expiry
9. shareable preview
10. unauthorized production-asset access

---

# 56. Core Acceptance Criteria

MVP is not functionally complete until a test user can:

1. use desktop and mobile,
2. select T-shirt/color,
3. enter prompt,
4. upload image,
5. receive valid generated design,
6. see correct required text,
7. edit placement/scale/rotation,
8. edit text/font,
9. see print boundaries/quality,
10. save project,
11. preview product,
12. approve proof,
13. complete Stripe checkout,
14. create internal paid order,
15. route to approved provider candidate,
16. pass manual review,
17. create/submit Printify order,
18. sync production/shipping,
19. manage order in admin,
20. complete flow without exposing production assets.

---

# 57. Repository Structure

Suggested:

```text
/apps
  /web
  /worker

/packages
  /db
  /domain
  /editor-schema
  /ai
  /prepress
  /printify
  /payments
  /tax
  /analytics
  /notifications
  /ui
  /config
  /testing

/docs
  /architecture
  /decisions
  /runbooks
  /api
  /product

/scripts
```

Alternative is acceptable if modular boundaries are preserved and justified.

---

# 58. Documentation

Maintain:
- README
- local setup
- environment variables
- architecture
- domain model
- database schema
- provider adapters
- Printify notes
- order state machine
- AI pipeline
- prepress spec
- routing algorithm
- moderation policy
- admin workflows
- event taxonomy
- runbooks
- release process
- backup/restore

Use ADRs for major architecture decisions.

---

# 59. Database Coverage

Schema must cover at minimum:
- users
- sessions
- projects
- project_versions
- assets
- generations
- generation_attempts
- style_families
- style_presets
- preset_versions
- credit_accounts
- credit_ledger
- products
- product_variants
- print_providers
- provider_variants
- print_area_profiles
- provider_qualifications
- carts
- cart_items
- checkouts
- payments
- orders
- order_items
- order_state_history
- fulfillment_orders
- fulfillment_events
- prepress_checks
- printability_scores
- moderation_checks
- moderation_flags
- refunds
- reprints
- lifecycle_events
- analytics_events
- admin_actions
- audit_logs

---

# 60. Credit Ledger

Do not use only a mutable balance.

Ledger types:
- GRANT
- PURCHASE
- CONSUME
- REFUND
- ADJUSTMENT
- EXPIRATION

Every consumption should reference generation/project.

---

# 61. Payment / Order Separation

A paid order may still be:
- held
- rejected
- refunded
- manually reviewed

Never auto-submit solely because payment succeeded.

---

# 62. Error Handling

User-safe errors.

Never expose:
- raw provider JSON
- stack traces
- secrets

Admin diagnostics should include:
- provider
- operation
- error class
- retry count
- correlation ID
- timestamp

---

# 63. Auditability

Audit:
- manual approval
- provider override
- refund
- reprint
- moderation override
- credit adjustment
- account deletion
- production submission

Store actor + reason.

---

# 64. Feature Flags

Use configurable flags for:
- AI routing
- free credits
- style families, substyles, and preset versions
- provider eligibility
- auto-production
- future PayPal
- future SMS
- new products
- advanced editor features

---

# 65. Configuration

Configurable:
- retention
- undo depth
- snapshot count
- generation limits
- preset-catalog rollout and eligibility
- credit pricing
- free credits
- printability thresholds
- routing weights
- margin floor
- provider status
- shipping threshold
- supported geography
- moderation flags

---

# 66. Milestone Execution Model

Codex MUST implement sequentially.

Do NOT attempt the entire startup in one pass.

After each milestone:
1. run tests,
2. update documentation,
3. summarize implementation,
4. list limitations,
5. list blockers,
6. identify next milestone.

---

# 67. Milestone 0 — Foundation

Deliver:
- repository
- dev environment
- lint/format
- test framework
- CI
- base Next.js app
- domain package layout
- PostgreSQL
- migrations
- storage abstraction
- queue abstraction
- observability baseline
- env config
- ADR framework

Acceptance:
- local dev works
- CI works
- migration works
- storage test works
- queue test works
- structured logging works

---

# 68. Milestone 1 — Identity, Product & Projects

Deliver:
- guest sessions
- optional account
- guest-to-account migration
- project schema
- versions
- autosave
- product catalog abstraction
- initial MVP product seed
- product/color UI

Acceptance:
- guest creates project
- account saves project
- migration preserves project
- version persists
- product selection persists

---

# 69. Milestone 2 — AI Orchestration

Deliver:
- AI provider interface
- provider adapters/stubs
- prompt pipeline
- generation jobs
- attempt tracking
- credit ledger
- private output storage
- validation hooks
- moderation hooks
- G1 benchmark harness

Acceptance:
- generation queued
- output private
- failed attempt no credit
- valid delivered result consumes credit
- provider switch via config

---

# 70. Milestone 3 — Editor

Deliver:
- canonical editor schema
- canvas
- move/scale/rotate
- crop
- text
- fonts
- colors
- layers
- lock
- alignment/snapping
- boundaries
- undo/redo
- autosave
- mobile
- simple/advanced modes

Acceptance:
- state reloads correctly
- transforms persist
- schema is library-independent
- production asset never exposed
- mobile core works

---

# 71. Milestone 4 — Prepress

Deliver:
- server-side render
- production master
- provider derivative
- effective DPI
- transparency checks
- placement checks
- printability
- preflight UI
- cleanup interfaces

Acceptance:
- deterministic render
- DPI calculation correct
- invalid placement blocked
- result persisted
- production asset private

---

# 71.5 Milestone 4.5 — Guided Creation & Structured Preset Engine

Milestone 4.5 follows the approved Milestone 4 prepress work and precedes Milestone 5. It extends the approved Milestone 2 provider-neutral AI architecture; it does not replace the editor or prepress architecture.

Deliver:
- structured Style Family and Substyle schema
- versioned preset configuration
- visual preset metadata (thumbnail/example artwork, concise name, optional consumer description)
- generation-request integration with product/color-aware preset context
- provider-neutral prompt-conditioning integration
- guided consumer generation UX
- persistence of style family ID, preset ID, and preset version with generations
- analytics-ready preset dimensions
- deterministic local/fake-provider support
- compatibility with existing project, project-version, generation, editor, and prepress models

Do not deliver:
- a generic template marketplace
- Kittl-style general design features
- Printify API integration
- fulfillment routing
- checkout
- changes to the approved Milestone 4 prepress architecture

Acceptance:
- a consumer can describe an idea and make a visual Style Family → Substyle choice without technical AI controls
- generation records preserve stable style family, preset, and preset-version identifiers
- a preset is represented as structured, versioned configuration rather than a hardcoded provider prompt suffix
- provider-neutral generation contracts receive preset conditioning without provider SDK coupling
- product/color context and the selected preset survive request persistence and deterministic local-provider execution
- existing Milestone 0–4 behavior and tests remain healthy

---

# 72. Milestone 5 — Printify & Routing

Milestone 5 follows Milestone 4.5. It must consume the existing product, project, generation, editor, prepress, and structured-preset foundations without replacing them.

Deliver:
- Printify adapter
- catalog sync
- provider data
- qualification model
- routing eligibility
- routing scoring
- shipping adapter
- provider admin matrix

Acceptance:
- approved candidates returned
- disabled excluded
- routing deterministic/testable
- shipping quote integration works where environment permits

---

# 73. Milestone 6 — Mockup, Cart & Checkout

Deliver:
- mockup flow
- cart
- quantity
- proof
- Stripe abstraction
- checkout
- Apple Pay/Google Pay where supported
- tax abstraction
- events

Acceptance:
- sandbox payment works
- proof persisted
- paid order created
- payment does NOT auto-submit

---

# 74. Milestone 7 — Review & Fulfillment

Deliver:
- order state machine
- review queue
- approve/hold/reject
- provider selection
- Printify order creation
- explicit submit
- status sync
- retries/idempotency
- exceptions

Acceptance:
- paid order reviews
- approved submits once
- duplicate callback safe
- Printify failure recoverable

---

# 75. Milestone 8 — Moderation

Deliver:
- prompt moderation
- upload hooks
- final artwork moderation
- policy engine
- four outcomes
- admin queue
- audit override

Acceptance:
- blocked content cannot reach production
- flagged held
- override audited
- final gate mandatory

---

# 76. Milestone 9 — Analytics, Lifecycle & CX

Deliver:
- analytics pipeline
- funnel
- Klaviyo adapter
- lifecycle events
- CX admin
- refund/reprint
- provider defect tracking
- generation-cost reporting

Acceptance:
- funnel queryable
- provider defect attributable
- lifecycle event emitted
- reprint/refund auditable

---

# 77. Milestone 10 — Hardening

Deliver:
- rate limits
- security review
- upload hardening
- backup/restore test
- dashboards
- performance pass
- accessibility pass
- mobile QA
- E2E
- runbooks
- failure drills

Acceptance:
- security baseline complete
- critical E2E passes
- restore documented
- dependency failure cannot corrupt order state

---

# 78. Execution Gates

| Gate | Owner | Blocks |
|---|---|---|
| G1 AI Benchmark | AI/ML + CTO | final AI routing |
| G2 AI Economics | CFO + AI/ML | final credits/pricing |
| G3 Product/Provider Qualification | Prepress + CTO | production launch |
| G4 US Sales Tax | CFO + qualified tax specialist | commercial launch |
| G5 Legal/Privacy | IP Counsel / qualified counsel | public launch |
| G6 Physical Test Prints | Prepress | production automation |

Development may continue around pending gates where possible.

---

# 79. Definition of Done

A feature is not Done unless:
- implemented
- tested
- error states handled
- analytics added where relevant
- permissions/security applied
- docs updated
- MVP scope respected
- provider dependency abstracted
- admin/support behavior exists where required

---

# 80. Codex Milestone Report Format

For each milestone, report:

## Implemented
What was completed.

## Files Changed
Key files/modules.

## Architecture Decisions
Only new decisions.

## Tests
Executed tests + result.

## Remaining
Only current milestone remainder.

## Blockers / Gates
Explicit external dependency.

## Next
Next milestone.

Do not claim speculative work as completed.

---

# 81. Conflict Resolution Priority

1. latest explicit CEO decision, including Meeting #004 locked decisions
2. Meeting #003 locked decisions
3. Meeting #002 locked decisions
4. completed CEO questionnaire
5. specialist recommendation
6. implementation convenience

Implementation convenience never overrides product requirements.

---

# 82. Product Language

Prefer:
- Create Your T-Shirt
- Describe Your Idea
- Make It Yours
- Print Quality
- Ready to Print
- Your Design
- Product Preview

Avoid consumer-facing technical language such as:
- diffusion
- seed
- underbase
- alpha channel
- normalized coordinates
- blueprint ID
- provider ID
- prepress

---

# 83. Final Positioning

Internal:
**Consumer AI merchandise commerce platform with guided style selection, controlled editing, print intelligence, and intelligent fulfillment.**

Kittl remains a Tier-1 benchmark for quality of creation experience, not a mandate to reproduce a general-purpose design platform. The product optimizes for zero-skill guided creation, not feature parity.

Customer-facing:
**Create something uniquely yours and wear it.**

Do not use “Design once, wear anywhere” as an MVP promise while the launch catalog contains only T-shirts.

---

# 84. Final Instruction to Codex

Begin with **Milestone 0 — Foundation**.

Before implementation:
1. inspect the repository, if any;
2. produce a concise architecture plan mapped to this specification;
3. identify genuine blockers only;
4. create ADRs for major architecture choices;
5. implement Milestone 0;
6. run tests;
7. report using the milestone protocol.

Do not skip ahead unless explicitly instructed.

Do not redesign the product.

Do not collapse AI, prepress, commerce and fulfillment into one undifferentiated workflow.

Do not expose production-resolution customer assets.

Do not auto-submit paid orders to Printify during the initial manual-review phase.

Build the smallest architecture that correctly supports the locked product.
