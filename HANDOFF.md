# Handoff to Subir — Middleware Deploy

This is the package for the Shopify backend developer (Subir) who is
deploying the customer scoring middleware. Everything you need is in this
folder.

## What you're building

A customer scoring middleware for a Shopify store. A separate tracking
specialist will handle the Meta CAPI / GA4 / Pinterest CAPI side after you
deliver. Your job is the backend deploy and the Shopify custom app wiring
only.

## What's in this folder

- **`README.md`** — high-level overview of the system, the scoring spec,
  the bot filter, the metafield schema, and the qualification flow. Read
  this first to understand the shape of the project.
- **`INSTALL.md`** — the step-by-step deployment runbook. **This is your
  primary reference.** It walks through every step: creating the Shopify
  custom app, deploying to Railway, smoke-testing, and adding metafield
  definitions. Follow it top to bottom.
- **`middleware/`** — the Node 20 + TypeScript + Express service to deploy.
  Already scaffolded with all routes, scoring logic, bot filter, and
  Shopify Admin API client. Just needs `npm install`, `npm run build`,
  and the env vars set in Railway.
- **`middleware/.env.example`** — the env var template. Copy these keys
  into Railway as variables.
- **`gtm/`** and **`shopify-admin-app/`** — out of scope for this job. The
  GTM tag will be installed by the tracking specialist later. The admin app
  is optional and isn't part of this engagement. You can ignore both folders.

## Your deliverables (Definition of Done)

1. The middleware is deployed and running at a stable Railway URL.
2. `GET /health` on the live URL returns `{"ok":true}`.
3. `POST /score` with a real customer ID (Matt will provide one) returns
   the expected JSON: `{"score":N,"tier":...,"qualifiedNow":...,"bot":{...},"suppressed":false}`.
4. The customer's Shopify record shows the new metafields under the
   `scoring` namespace: `score`, `tier`, `events`, `anon_ids`, `bot_score`,
   `bot_reasons`.
5. Metafield definitions are added in Shopify admin under
   **Settings → Custom data → Customers** for all six `scoring.*` keys
   so they display on the customer detail page.
6. The Railway URL is shared with Matt so the tracking specialist can be
   pointed at it next.

## Out of scope

- Anything related to Meta CAPI, Google Ads, GA4, or Pinterest. Leave those
  env vars blank in Railway. The tracking specialist will fill them in
  after your handoff.
- Installing the GTM custom HTML tag.
- Editing Shopify theme Liquid templates.
- The optional Shopify embedded admin app in `shopify-admin-app/`.
- Setting up multi-store / multi-tenant support — this is single store only.

## Access you'll receive

Matt will send you invites to:

1. **GitHub** — collaborator access to the private repo containing this code
2. **Shopify** — staff account with permissions for Apps and channels,
   Customers, and Settings (so you can create the custom app, install it,
   reveal the Admin API token, view customer metafields, and add metafield
   definitions)
3. **Railway** — member access to the Railway account/project where you'll
   deploy

Please send your email addresses for each of those services so Matt can
send the invites.

## Important security note about the Shopify Admin API token

When you create the Shopify custom app and click "Reveal token once" to
get the `shpat_...` Admin API access token, **paste it directly into
Railway as the `SHOPIFY_ADMIN_TOKEN` environment variable**. Do not send
it to Matt over chat or email. You're the only person who needs to handle
it, and putting it straight into Railway means it never travels through
any other channel.

## Reference: env vars to set in Railway

From `middleware/.env.example`. You only need the first block for this job
— leave the ad platform vars blank.

```
# --- Server ---
PORT=3000
ALLOWED_ORIGIN=https://<store-domain>.myshopify.com

# --- Shopify Admin API ---
SHOPIFY_SHOP=<store-domain>.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxx       # paste from Develop apps after install
SHOPIFY_API_VERSION=2024-10

# --- Tier thresholds ---
TIER_1_THRESHOLD=5
TIER_2_THRESHOLD=7
TIER_3_THRESHOLD=9
QUALIFY_AT=5

# Leave Meta / Google / GA4 / Pinterest blank — tracking specialist will fill these later
```

## Build & start commands for Railway

- **Root Directory:** `middleware`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run start`
- **Node version:** 20.x (set via `engines` or Railway's default)

## Smoke test command

Once deployed, from your terminal:

```bash
curl https://YOUR-RAILWAY-URL/health
# expected: {"ok":true}

curl -X POST https://YOUR-RAILWAY-URL/score \
  -H "Content-Type: application/json" \
  -d '{"customerId":"REAL_CUSTOMER_ID","eventType":"page_view_pdp","signals":{"hasMouseMoved":true,"hasScrolled":true,"hasFocused":true,"dwellMs":3000}}'
# expected: {"score":1,"tier":null,"qualifiedNow":false,"bot":{...},"suppressed":false}
```

Then open the customer in Shopify admin and verify the `scoring.*`
metafields have appeared.

## Questions?

Message Matt on Upwork. He has the `INSTALL.md` runbook open and can
clarify any step in real time. Most questions are answered in the
**Troubleshooting** section at the bottom of `INSTALL.md` — please check
there first.
