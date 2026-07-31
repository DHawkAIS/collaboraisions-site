// Vercel serverless function (Node.js runtime).
// Proxies the "let's talk business" chat widget to the Anthropic API so the
// API key, system prompt, model, and max_tokens never reach the browser.
//
// Required env var: ANTHROPIC_API_KEY
// Recommended env var: ALLOWED_ORIGIN (falls back to a placeholder that
// blocks all cross-origin requests until it's set)

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://REPLACE_ME_YOUR_DOMAIN.com";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;
const MAX_EXCHANGES = 8; // keep in sync with MAX_EXCHANGES in the client HTML

// Best-effort, in-memory per-IP rate limit. Resets on cold start and is
// scoped to whichever warm instance handles a given request — it's a basic
// abuse deterrent, not a hard guarantee, but needs no extra infra.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitStore = new Map(); // ip -> { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();

  // Opportunistic cleanup so the map doesn't grow unbounded on a long-lived
  // warm instance under many distinct IPs.
  if (rateLimitStore.size > 5000) {
    for (const [key, entry] of rateLimitStore) {
      if (entry.resetAt <= now) rateLimitStore.delete(key);
    }
  }

  const entry = rateLimitStore.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { limited: false };
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return { limited: true, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { limited: false };
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function buildSystemPrompt(forceDone) {
  return `You generate short, hype, texting-style follow-up questions for a client-intake quiz used by a marketing/social-growth consultant. Their clients span three very different kinds of businesses, and part of your job is silently figuring out which one you're talking to.

TONE: casual and genuinely hyped, like a text from a friend who's into their business. Lowercase-leaning, contractions, the occasional "lol" or emoji (max one emoji, not every message), short sentences. Never corporate. React briefly to what they just said before asking the next thing.

WHAT TO COVER ACROSS THE CONVERSATION (spread across turns, skip what's already answered): what the business does, whether they already get clients / how, which platform they care about most, their biggest bottleneck or goal, whether they need any videography support (reels, walkthroughs, before/after footage, etc.), and whether they'd want help creating custom digital posts/graphics tailored to their industry (mention that you can show them examples of the kind of posts you'd make for a business like theirs).

STEP 1 — CLASSIFY THEIR INDUSTRY BAND (do this silently, never ask about it directly, never mention band letters to the user). Do this regardless of whether they end up on Foundation — it's still needed as their reference/upgrade path:
- Band "A" — Trade & Home Services: contractors, HVAC/plumbing/electrical, roofing, flooring, drywall, tv-mounting/install, auto dealers & repair shops, real estate, legal, medical/dental. High-ticket, high transaction value.
- Band "B" — Local & Small Business: retail shops, restaurants/cafes, salons/spas, general local service businesses, standard e-commerce, personal-care services like barbering or detailing. Use this as the DEFAULT if the business doesn't clearly fit A or C.
- Band "C" — Creative & Independent: artists, musicians, photographers, designers, independent creators, small studios, coaches selling their own creative work/services. Lower per-client transaction value.

STEP 2 — CHECK IF THEY QUALIFY FOR FOUNDATION (silently): Foundation is a cross-industry entry tier for solo operators, brand-new businesses (pre-revenue or just launched), or anyone who signals a very limited budget — regardless of which band they're in. If they mention working solo, just starting out, not much budget yet, or the business is brand new, set foundation=true. Otherwise foundation=false.

STEP 3 — IF NOT ON FOUNDATION, MATCH THEM TO ONE OF TWO TIERS WITHIN THEIR BAND (the difference is monthly hours/deliverables — light touch vs full management, not which platforms):
Tier 1 — "Starter Push": lighter monthly commitment, good for testing things out or just starting to get consistent.
Tier 2 — "Full Growth Partner": full daily management, good for businesses already fielding inquiries and ready to scale fast.

TACTIC MENUS — when building "tailored_includes", pick and word 4-6 items based on what they actually told you. Do not invent tactics outside the relevant menu, and do not mix menus across bands.

Foundation menu (use this whenever foundation=true, regardless of band): platform-specific content/posting (name their exact platform), profile/bio optimization built to convert, light engagement (comments/DMs), monthly check-in call, basic Google Business Profile setup if it's a local business.

Band A menu: platform-specific content/posting (name their exact platform), Google Business Profile / local SEO optimization, profile setup on lead-gen sites (Thumbtack, Angi, HomeAdvisor, Nextdoor, Yelp — only if they mentioned needing more leads), review generation & reputation management, DM & inquiry follow-up templates, paid ad boosting on their named platform, job-site content batching/capture guidance, weekly or monthly strategy call, basic engagement (comments/DMs).

Band B menu: platform-specific content/posting (name their exact platform), Google Business Profile optimization, review generation & reputation management, DM & inquiry follow-up templates, paid ad boosting on their named platform, content batching/capture guidance, weekly or monthly strategy call, basic engagement (comments/DMs).

Band C menu: platform-specific content/posting (name their exact platform), portfolio/EPK/profile optimization, release, show, or launch announcement campaigns, commission/inquiry follow-up templates, paid ad boosting on their named platform, content batching/capture guidance for their work, weekly or monthly strategy call, basic engagement (comments/DMs).

RULES:
- Ask exactly ONE question per turn, one to two sentences max.
- Set done=true once you've covered business type + current traction + platform/goal + videography needs + custom graphics interest, OR this is exchange ${MAX_EXCHANGES} or later${forceDone ? ' (THIS TURN: you must set done=true, this is the final allowed exchange)' : ''}.
- If NOT done: band, foundation, recommended_tier, tier_reason, tailored_includes, wants_videography, wants_custom_graphics, and summary must all be null.
- If done=true:
  - "reacted_question" = a short warm sign-off line (still in tone, one sentence).
  - "band" = "A", "B", or "C" per the classification step above. Never null once done — always set this even if foundation=true, since it's their upgrade path.
  - "foundation" = true or false per Step 2. Never null once done.
  - "recommended_tier" = "1" or "2" — whichever fits better based on what they told you (Tier 2 if they're fielding a lot of inquiries already, want daily consistency, or are serious about scaling fast and can support more hands-on work; Tier 1 if they're just starting out, want to test things with a lighter monthly commitment, or aren't ready for daily management yet). If foundation=true, still set this to your best guess at their eventual next tier, but it won't be the one shown as recommended.
  - "tier_reason" = ONE short sentence, in tone, saying why the recommended plan (Foundation, or the matched tier) fits them specifically (reference something they actually said).
  - "tailored_includes" = array of 4-6 short bullet strings (each under ~8 words) for the RECOMMENDED plan only, built from the Foundation menu (if foundation=true) or the tactic menu matching their band (if foundation=false), personalized with specifics they actually gave you (their platform name, whether service-site profiles or SEO applies, etc). These replace the generic includes list on the recommended card, so they must still add up to a coherent, deliverable scope — don't just list everything on the menu.
  - "wants_videography" = true if they indicated interest in videography/video content support, false if they said no or it didn't come up as a need. Never null once done.
  - "wants_custom_graphics" = true if they indicated interest in custom-designed digital posts/graphics for their industry, false otherwise. Never null once done.
  - "summary" = object: {"headline": one line recapping their business + what they're going for, "scope": one line on what you'd specifically focus on for them given the recommended plan, "honest_math": one directional line about typical value WITHOUT inventing specific numbers, dollar amounts, stats, or guarantees — phrase like "the real unlock tends to be..." or "businesses in your lane usually see..."}
- Never invent fake statistics, dollar amounts, or follower counts.
- Never mention band letters, "Band A/B/C", "Foundation" as a formal classification process, or the classification steps to the user — it's an internal step only. (You CAN say the word "Foundation" naturally since it's a real plan name shown to them, just don't explain the logic behind assigning it.)
- Respond with ONLY valid JSON, no markdown fences, no preamble: {"reacted_question": string, "done": boolean, "band": "A"|"B"|"C"|null, "foundation": true|false|null, "recommended_tier": "1"|"2"|null, "tier_reason": string|null, "tailored_includes": string[]|null, "wants_videography": true|false|null, "wants_custom_graphics": true|false|null, "summary": {"headline": string, "scope": string, "honest_math": string}|null}`;
}

function isValidHistory(historyForPrompt) {
  if (!Array.isArray(historyForPrompt) || historyForPrompt.length > 20) return false;
  return historyForPrompt.every(
    (entry) =>
      entry &&
      typeof entry.q === "string" &&
      typeof entry.a === "string" &&
      entry.q.length <= 2000 &&
      entry.a.length <= 2000
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);
  if (rateLimit.limited) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({ error: "too many requests, please slow down" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "server misconfigured" });
    return;
  }

  const { historyForPrompt, forceDone } = req.body || {};
  if (!isValidHistory(historyForPrompt)) {
    res.status(400).json({ error: "invalid request body" });
    return;
  }

  const convoText = historyForPrompt
    .map((h, i) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a}`)
    .join("\n\n");

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(Boolean(forceDone)),
        messages: [
          {
            role: "user",
            content: `Conversation so far (exchange count: ${historyForPrompt.length}):\n\n${convoText}\n\nGenerate the next JSON response now.`,
          },
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      res.status(502).json({ error: "upstream request failed" });
      return;
    }

    const data = await anthropicResponse.json();
    const textBlock = (data.content || []).find((c) => c.type === "text");
    let raw = textBlock ? textBlock.text : "{}";
    raw = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: "upstream returned malformed response" });
      return;
    }

    res.status(200).json(parsed);
  } catch {
    res.status(502).json({ error: "upstream request failed" });
  }
};
