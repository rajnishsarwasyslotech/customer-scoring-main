# Customer Scoring & Qualification System

A middleware-driven customer scoring system for Shopify that turns soft browsing
behavior into a single high-quality conversion event (`qualified_consideration`)
which is forwarded to Meta CAPI, Google Ads, GA4, and Pinterest CAPI.

It also includes a layered bot filter so you don't burn ad budget on bot traffic.

---

## Scoring spec (canonical)

Scores are small integers. Qualification fires once a customer crosses the
threshold OR performs an auto-qualify action.

| Event                          | Points | Notes                                       |
| ------------------------------ | ------ | ------------------------------------------- |
| `page_view_pdp`                | +1     | counts toward key-page cap                  |
| `page_view_financing`          | +1     | counts toward key-page cap                  |
| `page_view_comparison`         | +1     | counts toward key-page cap                  |
| `page_view_delivery`           | +1     | counts toward key-page cap                  |
| `page_view_warranty`           | +1     | counts toward key-page cap                  |
| `store_locator_interaction`    | +3     |                                             |
| `financing_click`              | +3     |                                             |
| `consult_form_start`           | +4     |                                             |
| `checkout_started`             | +5     | **also auto-qualifies regardless of score** |
| `return_visit_30d`             | +2     | awarded automatically by the middleware     |

**Key page cap:** the cumulative points awarded across `page_view_*` events
are capped at **+3** per dedup window, so visiting every key page can never
contribute more than 3.

**Qualify when** `score >= 5` **OR** `eventType ∈ autoQualifyEvents`.

**Tier mapping** (sent as `intent_tier` on the conversion event):

| Score   | intent_tier |
| ------- | ----------- |
| 5–6     | `tier_1`    |
| 7–8     | `tier_2`    |
| 9+      | `tier_3`    |

**Dedup:** each event type fires at most once per user per **7 days**.
`checkout_started` is exempt (it's an auto-qualify trigger).

**`return_visit_30d`** is auto-derived: when the middleware sees a customer
whose oldest stored event is ≥ 30 days old, it adds the +2 once.

---

## Outbound conversion event

When a user qualifies, the middleware fires `qualified_consideration` to:

- **Meta CAPI** — with `event_id` (matched to the browser pixel for dedup)
  and `custom_data.intent_tier` for ROAS analysis
- **Google Ads** Conversion API — including `intent_tier` for Smart Bidding
- **GA4** Measurement Protocol — as a key event with `intent_tier` param
- **Pinterest CAPI** — same shape as Meta

Every event carries `event_id` so the browser pixel + server CAPI dedupe
cleanly.

---

## Bot filter

Every `/score` event is run through `lib/botFilter.ts` before any points are
awarded. The filter maintains a per-session `bot_score` (0–100). If the score
crosses **`BOT_THRESHOLD = 60`** the event is suppressed: no points, no
`/qualify`, no ad-platform fan-out.

Signals it scores on:

- **Hard signals:** honeypot link click, `navigator.webdriver`, known bot user
  agents (via `isbot`), Cloudflare `cf-threat-score` header
- **Velocity:** event-to-event interval < 300ms, or > 8 events in 10s
- **Dwell time:** page views with `dwellMs < 1500` get penalized
- **Prerender:** `document.prerendering === true`
- **Missing input signals:** no mousemove + no scroll + no focus after 3+ events
- **Checkout-without-funnel:** `checkout_started` with no prior product/cart events,
  or no user input recorded
- **Metronome cadence:** 5+ events with std-dev of intervals < 200ms
- **Identity sanity:** `navigator.languages.length === 0`, tiny viewport

Bot state is persisted to the customer record (Shopify metafields
`scoring.bot_score`, `scoring.bot_reasons`) so you can audit it from the
embedded admin app.

The GTM tag installs a hidden honeypot link and a one-time signal collector
(mousemove/scroll/focus listeners) so the server has the data it needs.

### Defense-in-depth (recommended on top of this)

- Turn on **Shopify Bot Protection** (Settings → Customer accounts).
- Turn on **Shopify Checkout Captcha** (Settings → Checkout → Spam protection).
- Front the store with **Cloudflare** + Bot Fight Mode so most junk is dropped
  before it ever reaches your tag or middleware.
- Optional: subscribe to an IP→ASN feed and reject events from datacenter ASNs.

---

## Repo layout

```
customer-scoring/
├── middleware/             # Node + Express + TypeScript service
│   ├── src/
│   │   ├── index.ts        # Express bootstrap
│   │   ├── config/         # env, tier thresholds, event point map
│   │   ├── routes/         # /score, /qualify
│   │   ├── lib/
│   │   │   ├── shopify.ts  # Admin REST + customer metafield read/write
│   │   │   ├── scoring.ts  # tier logic, dedup, stitching, key-page cap
│   │   │   └── botFilter.ts  # session bot scoring
│   │   └── webhooks/       # Meta / Google / GA4 / Pinterest forwarders
│   ├── package.json
│   └── tsconfig.json
├── gtm/
│   └── custom-html-tag.html  # paste into GTM custom HTML tag
└── shopify-admin-app/      # Shopify embedded app (App Bridge + Polaris)
```

## Persisted state (Shopify customer metafields, namespace `scoring`)

| key            | type                    | meaning                                |
| -------------- | ----------------------- | -------------------------------------- |
| `score`        | number_integer          | current total                          |
| `tier`         | single_line_text_field  | `tier_1` / `tier_2` / `tier_3` / empty |
| `events`       | json                    | recent events (powers 7-day dedup)     |
| `anon_ids`     | json                    | cookie IDs merged into this customer   |
| `bot_score`    | number_integer          | highest seen bot score                 |
| `bot_reasons`  | json                    | accumulated bot-signal reason codes    |

## Quick start

```bash
cd middleware
cp .env.example .env   # fill in Shopify + ad creds + thresholds
npm install
npm run dev
```

Endpoints:

- `POST /score` — `{ customerId?, anonId?, eventType, eventId?, signals? }`
- `GET  /score/:customerId` — current score, tier, bot state
- `POST /qualify` — internal; usually called automatically when threshold crossed

## Deployment

Portable Express service — Railway, Render, Fly.io, Vercel all work. Node 20+.
For multi-instance, swap the in-memory `anonBuffer` and `botFilter` session map
for Redis.
