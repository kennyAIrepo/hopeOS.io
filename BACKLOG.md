# hopeOS — Backlog & Recommendations

Prioritized engineering recommendations from a full repository review. Each item lists the
problem, the impact, a proposed action, and the primary files involved. See
[ARCHITECTURE.md](ARCHITECTURE.md) for system context and [CONCEPT.md](CONCEPT.md) for the
product vision.

**Priority legend:** 🔴 P0 critical · 🟠 P1 high · 🟡 P2 medium · 🟢 P3 low / nice-to-have
**Effort:** S (hours) · M (1–2 days) · L (multi-day)

---

## 🔴 P0 — Critical (do first)

### P0-1 · Harden the AI proxies (open relays to paid APIs) — `M`
**Problem.** [api/claude.js](api/claude.js) and [api/openai.js](api/openai.js) forward any
request body to Anthropic/OpenAI with no authentication, rate limiting, origin check, or
request-shape validation. Any visitor (or a scraper) can drive unbounded spend on your keys.
**Impact.** Direct financial exposure; potential abuse, key-quota exhaustion, denial of
wallet.
**Action.**
- Enforce an **origin/referer allow-list** (your domains only) and reject others.
- Add **per-IP / per-session rate limiting** (e.g. a token bucket backed by Blob or a KV/
  Upstash store).
- **Validate and cap** the request: max `max_tokens`, allowed `model` ids only, max body
  size, max messages.
- Optionally require a lightweight signed session token issued by the page.
**Files.** [api/claude.js](api/claude.js), [api/openai.js](api/openai.js),
[api/sketchfab.js](api/sketchfab.js) (same exposure for the Sketchfab quota).

### P0-2 · Constrain `run_script` agent escape hatch — `M`
**Problem.** The agent's `run_script` tool ([sdk/world/ai-agent.js](sdk/world/ai-agent.js))
executes model-generated code with `world/scene/camera/THREE/hope/nav` in scope. Combined
with P0-1's open proxy, untrusted input can reach code execution in the user's session.
**Impact.** Prompt-injection → arbitrary client-side script execution (DOM, fetch, storage).
**Action.** Keep the feature (it's core to the "game-maker" vision) but: gate it behind the
origin/rate limits from P0-1, scope it to same-origin only, strip/deny `fetch`,
`import()`, `eval`, `XMLHttpRequest`, and `document`/`window` access inside the sandbox, and
log every executed snippet. Consider a capability allow-list instead of full scope.
**Files.** [sdk/world/ai-agent.js](sdk/world/ai-agent.js).

---

## 🟠 P1 — High

### P1-1 · Add Subresource Integrity (SRI) + a single source of truth for deps — `M`
**Problem.** Every 3D/ML/physics library is a version-pinned CDN URL with **no integrity
hash** ([index.html](index.html), [play.html](play.html), [world.html](world.html),
[sdk/core/physics.js](sdk/core/physics.js)). A CDN compromise or hijack executes arbitrary
code in every session. Versions are also string-managed across multiple files, inviting
drift.
**Impact.** Supply-chain risk; runtime availability depends on third-party CDNs; upgrade
friction.
**Action.** Add `integrity` + `crossorigin` to static `<script>` tags; centralize the
import map (one shared snippet or generated block); document the exact pinned versions in
one place. Consider self-hosting the most critical payloads (Rapier WASM, MediaPipe WASM)
on Blob to remove the boot-time CDN dependency the SDK already defensively guards against.
**Files.** [index.html](index.html), [play.html](play.html), [world.html](world.html),
[sdk/core/physics.js](sdk/core/physics.js).

### P1-2 · Resolve the Three.js version split (r128 vs 0.160) — `M`
**Problem.** The landing page loads the global UMD **r128** build while runtimes use the
**0.160** ESM module. r128 is years old (security + API drift) and uses a different module
system.
**Impact.** Maintenance liability, inconsistent APIs, a stale global `THREE`.
**Action.** Migrate [index.html](index.html)'s holo-mirror to the 0.160 ESM module + import
map, matching the runtime pages, and remove the global script.
**Files.** [index.html](index.html).

### P1-3 · Add abuse/cost guardrails to Blob writes — `M`
**Problem.** [api/asset.js](api/asset.js), [api/blob-upload.js](api/blob-upload.js), and
[api/world/[name]/index.js](api/world/[name]/index.js) accept public writes with only size
limits. There's no auth, rate limit, content-type verification beyond headers, or quota.
**Impact.** Storage abuse, junk worlds, cost growth, name-squatting on `worlds/<name>`.
**Action.** Rate-limit writes, validate that uploaded bytes are actually GLB (magic-number
check: `glTF` header), cap per-session world count, and consider a publish token or
captcha for the public publish path.
**Files.** [api/asset.js](api/asset.js), [api/blob-upload.js](api/blob-upload.js),
[api/world/[name]/index.js](api/world/[name]/index.js).

### P1-4 · Consolidate the two physics engines (or formalize the boundary) — `L`
**Problem.** cannon-es (core/AR, [sdk/core/physics.js](sdk/core/physics.js)) and Rapier
(world layer, [sdk/world/template.js](sdk/world/template.js)) both ship. Two WASM payloads,
two collision models, double the surface area.
**Impact.** Larger bundles/boot time, duplicated mental model, harder maintenance.
**Action.** Short term — document the layer boundary explicitly (which engine owns what).
Long term — migrate the core body capsules to Rapier and retire cannon-es to standardize on
one engine.
**Files.** [sdk/core/physics.js](sdk/core/physics.js), [sdk/world/template.js](sdk/world/template.js).

---

## 🟡 P2 — Medium

### P2-1 · Merge `config.js` and `dei_config.js` — `S`
**Problem.** Two near-identical client configs ([config.js](config.js),
[dei_config.js](dei_config.js)); the model-tier names exist only in `config.js`, inviting
drift.
**Action.** Merge into one config module; have the DEI page import the shared object.
**Files.** [config.js](config.js), [dei_config.js](dei_config.js).

### P2-2 · Fix the GitHub repo reference inconsistency — `S`
**Problem.** [api/bugs.js](api/bugs.js) defaults `GITHUB_REPO` to `kennyAIrepo/hopeOSEngine`,
but the active repository is `kennyAIrepo/hopeOS.io`. Auto-filed issues may land in the
wrong repo.
**Action.** Confirm the intended target and update the default (or require the env var).
**Files.** [api/bugs.js](api/bugs.js).

### P2-3 · Add a health/diagnostics surface — `S`
**Problem.** There's no single way to verify which env keys/services are configured
(Anthropic, OpenAI, Sketchfab, Blob, GitHub, Admin) on a deployment.
**Action.** Add a small `/api/health` that reports booleans (configured / not) without
leaking values, to speed up "why isn't X working" triage.
**Files.** new `api/health.js`.

### P2-4 · Document & test the graceful-degradation paths — `M`
**Problem.** The codebase has excellent fallback behavior (no camera, no AI key, slow CDN),
but it's implicit and untested.
**Action.** Add a short "degradation matrix" to [ARCHITECTURE.md](ARCHITECTURE.md) and a few
smoke tests / manual QA checklist covering: camera blocked, key missing, CDN slow, GLB
import fails.
**Files.** docs + a lightweight test/QA checklist.

### P2-5 · SAM2 silhouette pipeline — finish or feature-flag — `L`
**Problem.** The body-embedded embodiment references an optional SAM2 silhouette provider
(ONNX Runtime Web / WebGPU worker) that is currently a hook, not an implementation.
**Action.** Either implement the worker behind a clear feature flag or document it as a
roadmap extension point so the fallback (skeleton) is the documented default.
**Files.** [sdk/world/embodiment.js](sdk/world/embodiment.js), [WORLD_LAYER.md](WORLD_LAYER.md).

---

## 🟢 P3 — Low / nice-to-have

### P3-1 · Centralize tuning constants — `S`
Surface `NAV_DEFAULTS` (avatar-nav) and `DEFAULTS` (template) tuning knobs in one documented
place so designers can adjust feel without hunting across modules.
**Files.** [sdk/world/avatar-nav.js](sdk/world/avatar-nav.js), [sdk/world/template.js](sdk/world/template.js).

### P3-2 · Per-user world ownership / sync — `L`
`world-store.js` notes "cloud per-user sync swaps in behind this same API later." Plan the
auth + ownership model so published worlds can be edited/deleted by their creator.
**Files.** [sdk/world/world-store.js](sdk/world/world-store.js), [api/world/](api/world/).

### P3-3 · World snapshot schema versioning — `S`
Add a `schemaVersion` field to the world snapshot so future format changes can migrate
cleanly when reopening old worlds.
**Files.** [sdk/world/world-store.js](sdk/world/world-store.js), [api/world/[name]/index.js](api/world/[name]/index.js).

### P3-4 · Accessibility & input fallbacks — `M`
Ensure full keyboard/mouse parity and clear affordances for users who can't or won't enable
a camera; add captions/labels for voice-driven actions.
**Files.** [world.html](world.html), [play.html](play.html), [sdk/world/avatar-nav.js](sdk/world/avatar-nav.js).

### P3-5 · Add a LICENSE and dependency attribution — `S`
The repo has no license file; the README is a stub. Add a license and attribute the CDN
dependencies (Three.js, Rapier, cannon-es, MediaPipe) and asset sources (Sketchfab terms).
**Files.** new `LICENSE`, [README.md](README.md).

### P3-6 · Flesh out the README — `S`
[README.md](README.md) is currently one line. Add quick-start (local `vercel dev`), the env
var list, the route map, and links to [CONCEPT.md](CONCEPT.md) / [ARCHITECTURE.md](ARCHITECTURE.md).
**Files.** [README.md](README.md).

---

## Quick-reference matrix

| ID | Title | Priority | Effort | Theme |
|---|---|---|---|---|
| P0-1 | Harden AI proxies | 🔴 P0 | M | Security/Cost |
| P0-2 | Constrain `run_script` | 🔴 P0 | M | Security |
| P1-1 | SRI + dep source of truth | 🟠 P1 | M | Supply chain |
| P1-2 | Three.js version split | 🟠 P1 | M | Maintainability |
| P1-3 | Blob write guardrails | 🟠 P1 | M | Security/Cost |
| P1-4 | Consolidate physics engines | 🟠 P1 | L | Architecture |
| P2-1 | Merge config files | 🟡 P2 | S | Maintainability |
| P2-2 | Fix GitHub repo default | 🟡 P2 | S | Correctness |
| P2-3 | Health/diagnostics endpoint | 🟡 P2 | S | Operability |
| P2-4 | Document/test degradation | 🟡 P2 | M | Reliability |
| P2-5 | SAM2 pipeline finish/flag | 🟡 P2 | L | Feature |
| P3-1 | Centralize tuning constants | 🟢 P3 | S | DX |
| P3-2 | Per-user world ownership | 🟢 P3 | L | Feature |
| P3-3 | Snapshot schema versioning | 🟢 P3 | S | Data |
| P3-4 | Accessibility/input fallbacks | 🟢 P3 | M | UX |
| P3-5 | LICENSE + attribution | 🟢 P3 | S | Compliance |
| P3-6 | Flesh out README | 🟢 P3 | S | Docs |

---

## Suggested sequencing

1. **Stop the bleeding (P0):** lock down the proxies and the script sandbox — these are
   live financial and security exposures.
2. **Shore up the supply chain & writes (P1-1, P1-3):** SRI + Blob guardrails.
3. **Pay down platform debt (P1-2, P1-4):** unify Three.js, then plan the physics merge.
4. **Operability & polish (P2):** config merge, repo fix, health endpoint, degradation docs.
5. **Roadmap (P3):** ownership/sync, schema versioning, accessibility, licensing, README.
