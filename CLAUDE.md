# Client Intake & Pricing Quiz — Project Brief

A client-facing chat widget ("let's talk business") that asks a business
owner a few casual questions, classifies their business into a pricing
band, and shows them a matched marketing-retainer pricing plan.

## Files
- `lets-talk-business-v6.html` — the live app (self-contained, images
  embedded as base64 data URIs)
- `lets-talk-business-demo.html` — same app, but skips the chat and
  jumps straight to the results page with sample data (for previewing)
- `api/chat.js` — Vercel serverless function (Node runtime) that proxies
  the chat to the Anthropic API. Holds the API key, system prompt, model
  ID, and max_tokens server-side; also does basic per-IP rate limiting
  and CORS restriction. See "API architecture" below.

## How it works
1. A chat UI asks the visitor a handful of questions, one per turn. Each
   turn, the client posts the conversation-so-far to `/api/chat`
   (same-origin), which calls the Anthropic API (model: claude-sonnet-4-6)
   server-side and returns the parsed JSON.
2. Once enough is known, the model returns structured JSON classifying
   the business and recommending a plan.
3. The results screen renders the matched tier, a content-examples
   gallery, and an add-ons menu.

## API architecture
`callClaude()` in both HTML files calls `/api/chat` — a relative,
same-origin path, never `api.anthropic.com` directly. `api/chat.js`:
- Reads `ANTHROPIC_API_KEY` from a Vercel environment variable (Settings
  → Environment Variables, or `vercel env add ANTHROPIC_API_KEY`). The
  key never appears in any HTML/JS file or repo.
- Restricts CORS to `ALLOWED_ORIGIN` (env var). **Currently a
  placeholder** (`https://REPLACE_ME_YOUR_DOMAIN.com`) — the widget
  won't accept cross-origin requests from the real site until this is
  set to the actual production domain.
- Does a best-effort, in-memory per-IP rate limit (20 req / 10 min).
  Resets on cold start / differs per warm instance — a basic abuse
  deterrent, not a hard guarantee. Upgrade to Vercel KV/Upstash if
  stricter limiting is ever needed.
- Owns the system prompt, model ID, and `max_tokens` — the client only
  ever sends `{historyForPrompt, forceDone}`.

## Pricing structure — three industry bands + one cross-industry tier

Each band has two tiers: **Starter Push** (light touch) and
**Full Growth Partner** (full management). Pricing is monthly with an
annual option (~10% discount), and the annual price is hidden by
default — revealed only via a small "ⓘ" info button in the corner of
each price.

| Band | Who it's for | Starter Push | Full Growth Partner |
|---|---|---|---|
| **A — Trade & Home Services** | contractors, HVAC/plumbing/electrical, roofing, auto dealers/repair, real estate, legal, medical | $1,750/mo · $18,900/yr | $4,200/mo · $45,400/yr |
| **B — Local & Small Business** | retail, restaurants, salons, barbers, detailers, general local service (default fallback band) | $600/mo · $6,500/yr | $1,900/mo · $20,500/yr |
| **C — Creative & Independent** | artists, musicians, photographers, designers, small studios | $400/mo · $4,300/yr | $1,100/mo · $11,900/yr |

Band A pricing was benchmarked against a real construction-focused
competitor (Faithworks Marketing Services, CA market: $2,500–$5,000/mo)
and intentionally priced just below that range.

**Foundation** — a cross-industry entry tier, not tied to any band.
For solo operators or brand-new/pre-revenue businesses regardless of
industry. $300/mo · $3,200/yr. When someone qualifies for Foundation,
the second card shown is their actual industry band's Starter Push, as
a visible upgrade path.

## Add-ons (standalone menu, bundled or stand-alone)
- Videography — $225/video, or $650/mo for weekly video content
- Custom Digital Post Design — $65/post, or $220/mo for a 4-post bundle
- Extra Platform Management — $150/mo per additional platform

The chat asks whether the visitor wants videography and/or custom
graphics; if yes, that add-on gets a "worth adding" tag on the results
page — but all add-ons are always visible to everyone.

## Content examples gallery
Real reference images (uploaded by the business owner, Canva-template
style mockups) shown per band so a lead can see example content for
their industry. Clickable thumbnails open a lightbox. Mapped:
- Band A: HVAC repair promo, used-cars promo
- Band B: hair salon promo, fashion retail "hot sale" promo
- Band C: outdoor apparel brand promo, clothing designer portfolio drop,
  musician album release, photographer portfolio spotlight, graphic
  designer poster design, product/interior designer catalog spotlight

## Classification logic (in the system prompt)
The model silently classifies band (A/B/C) and Foundation eligibility
— never reveals this process or band letters to the visitor. Tactic
menus for the "tailored_includes" bullets are band-specific (e.g. Band
A can mention lead-site profiles like Thumbtack/Angi; Band C mentions
portfolio/EPK optimization) so recommendations sound native to the
industry, not generic.

## Style
Accent color is a horizontal gradient (cream → orange/red → purple →
blue), applied via `--accent-gradient` CSS variable, used as
background-clip text on prices/labels and as solid backgrounds on
badges — not a flat orange like the original draft.

## Known placeholders still to fill in
- `CALENDLY_BOOKING_LINK` in the `<script>` — currently
  `https://calendly.com/REPLACE_ME/intro-call`. Needs a real Calendly
  (or Acuity) event with Stripe payment attached for the $5 intro call,
  so payment happens as part of booking rather than as a separate step.
- `INSTAGRAM_HANDLE` — currently `yourhandle`.
- `ALLOWED_ORIGIN` in `api/chat.js` — currently a placeholder
  (`https://REPLACE_ME_YOUR_DOMAIN.com`). Set the real Vercel env var
  once the production domain is known, or the deployed widget will get
  CORS-blocked calling its own backend.

## Open questions / likely next steps
- Decide whether Foundation tier pricing needs adjustment once real
  client feedback comes in.
- Wire the real Calendly link in once the scheduling account is set up.
- Set `ANTHROPIC_API_KEY` and `ALLOWED_ORIGIN` in Vercel once the
  project is deployed and the domain is known.
