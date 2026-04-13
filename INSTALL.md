# Install Runbook — Customer Scoring System

This is the step-by-step guide to take the project from zero to a working
install on a live Shopify store. Plan on **3–6 hours** end to end if you're
comfortable with the command line, or hand this doc to a Shopify developer.

---

## What you'll end up with

1. A middleware service running at `https://customer-scoring.<your-host>.app`
2. Customer scores written to Shopify customer metafields under `scoring.*`
3. A GTM tag firing scoring events from your store on key page views & clicks
4. A `qualified_consideration` conversion event flowing to Meta CAPI, GA4,
   and (optionally) Pinterest CAPI and Google Ads
5. A bot filter suppressing junk traffic before it hits your ad accounts
6. (Optional) A Shopify embedded admin app showing logs, leaderboard, thresholds

---

## Prerequisites

- A Shopify store you own (any plan)
- A GitHub account (free)
- A Railway, Render, or Fly.io account (free tier is fine)
- Node.js 20+ installed locally for testing (optional but recommended)
- Access to your existing Google Tag Manager workspace
- Admin access to your Meta Business Manager, GA4 property, and (if using)
  Pinterest Ads and Google Ads accounts
- A code editor (VS Code is great)

---

## Step 1 — Get the code

```bash
git clone <your-fork-of-this-repo> customer-scoring
cd customer-scoring
```

If you don't already have a repo, create one on github.com and push the
`customer-scoring/` folder I scaffolded. Make it private — it'll hold your
Shopify token in env vars (never in the code itself).

---

## Step 2 — Create the Shopify custom app + Admin API token

The middleware needs an Admin API token to read & write customer metafields.

1. In your Shopify admin, go to **Settings → Apps and sales channels**.
2. Click **Develop apps** in the top right. (If you've never done this before,
   you'll see a one-time **Allow custom app development** banner — accept it.)
3. Click **Create an app**. Name it `Customer Scoring`. Click **Create app**.
4. Click **Configure Admin API scopes** and tick:
   - `read_customers`
   - `write_customers`
   - `read_customer_metafields`
   - `write_customer_metafields`
5. Click **Save**.
6. Click **Install app** at the top right and confirm.
7. Click the **API credentials** tab. Under **Admin API access token**, click
   **Reveal token once** and copy it. **You will only ever see this once.**
   Paste it somewhere safe — you'll plug it into Railway in Step 4.
8. Note your shop domain — it looks like `your-store.myshopify.com` (NOT your
   custom domain). You'll need it too.

> ⚠️ Treat that `shpat_...` token like a password. Anyone with it can read
> and modify customer data on your store.

---

## Step 3 — (Optional but recommended) Run it locally first

This lets you confirm the middleware works before deploying.

```bash
cd middleware
cp .env.example .env
# Open .env in your editor and set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN
npm install
npm run dev
```

You should see:

```
[middleware] listening on :3000
```

In a second terminal, test the health endpoint and a real `/score` call:

```bash
curl http://localhost:3000/health
# → {"ok":true}

curl -X POST http://localhost:3000/score \
  -H "Content-Type: application/json" \
  -d '{"customerId":"REAL_CUSTOMER_ID","eventType":"page_view_pdp","signals":{"hasMouseMoved":true,"hasScrolled":true,"hasFocused":true,"dwellMs":3000}}'
```

To get a `REAL_CUSTOMER_ID`: in Shopify admin, open any customer record. The ID
is in the URL: `…/customers/1234567890`. Use the digits.

If everything's wired up correctly:

- The response should be `{"score":1,"tier":null,"qualifiedNow":false,"bot":{...},"suppressed":false}`
- In Shopify admin → that customer → scroll to **Metafields** — you should see
  a new `scoring` namespace with `score`, `events`, etc.

Now repeat the curl call several times with different `eventType` values
(`store_locator_interaction`, `consult_form_start`, `checkout_started`) and
watch the score climb past 5 and `qualifiedNow` flip to `true`.

If anything fails see the **Troubleshooting** section at the bottom.

---

## Step 4 — Deploy the middleware to Railway

(Render and Fly.io work the same way; pick whichever you like.)

1. Push the `customer-scoring/` folder to a private GitHub repo.
2. Sign in at **railway.app** with GitHub.
3. Click **New Project → Deploy from GitHub repo** and select your repo.
4. Once Railway detects it, click the service → **Settings**.
   - **Root Directory:** `middleware`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start`
5. Click **Variables** and add:

   | Key | Value |
   | --- | --- |
   | `PORT` | `3000` |
   | `SHOPIFY_SHOP` | `your-store.myshopify.com` |
   | `SHOPIFY_ADMIN_TOKEN` | `shpat_...` from Step 2 |
   | `SHOPIFY_API_VERSION` | `2024-10` |
   | `TIER_1_THRESHOLD` | `5` |
   | `TIER_2_THRESHOLD` | `7` |
   | `TIER_3_THRESHOLD` | `9` |
   | `QUALIFY_AT` | `5` |
   | `ALLOWED_ORIGIN` | `https://your-store.myshopify.com` (use your customer-facing domain too if different, comma-separated) |

   Leave the Meta/Google/GA4/Pinterest variables blank for now — you'll add
   them in Step 7.

6. Railway will redeploy. Click **Settings → Networking → Generate Domain**
   and copy the `https://...up.railway.app` URL. This is your middleware URL.
7. Smoke-test the live URL:

   ```bash
   curl https://YOUR-MIDDLEWARE.up.railway.app/health
   ```

   You should see `{"ok":true}`.

---

## Step 5 — Add the dataLayer pushes to your Shopify theme

GTM needs something to listen to. The simplest approach is to push a
`cs_score` event into the dataLayer from each scoring page in your Liquid
templates.

**5a. Edit your theme.** In Shopify admin → **Online Store → Themes →
Customize → Edit code** (in the theme actions menu).

**5b. Add this snippet to the templates that should award points.** Pick the
right `eventType` value from the table:

| Page / template | `eventType` |
| --- | --- |
| `templates/product.liquid` (PDP) | `page_view_pdp` |
| Financing landing page | `page_view_financing` |
| Comparison page | `page_view_comparison` |
| Delivery info page | `page_view_delivery` |
| Warranty info page | `page_view_warranty` |

Drop this near the bottom of each template, right before `</body>` or wherever
GTM is loaded:

```liquid
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'cs_score', eventType: 'page_view_pdp' });
</script>
```

(Change the `eventType` value per template.)

**5c. For click events** (store locator, financing button, consult form
start), add an inline `onclick` or a small listener:

```liquid
<a href="/pages/store-locator"
   onclick="window.dataLayer.push({event:'cs_score', eventType:'store_locator_interaction'})">
  Find a store
</a>
```

**5d. Checkout started.** Shopify's checkout is locked down on most plans, so
the easiest reliable trigger is the **add-to-cart** click on the cart page:

```liquid
<form action="/cart" method="post"
      onsubmit="window.dataLayer.push({event:'cs_score', eventType:'checkout_started'})">
  ...
</form>
```

If you're on **Shopify Plus**, you can use a Checkout Extension or the
`checkout.liquid` template to fire it on the actual checkout page.

---

## Step 6 — Install the GTM tag

1. Open your GTM workspace for the store.
2. **Variables → New → User-Defined Variable**
   - Type: **Data Layer Variable**
   - Variable Name: `eventType`
   - Data Layer Variable Name: `eventType`
   - Save
3. **Triggers → New**
   - Type: **Custom Event**
   - Event name: `cs_score`
   - Save as `cs_score trigger`
4. **Tags → New**
   - Type: **Custom HTML**
   - Paste the entire contents of `gtm/custom-html-tag.html` from the repo
   - In the script, replace `https://YOUR-MIDDLEWARE.example.com/score` with
     your Railway URL from Step 4 plus `/score`
   - Replace the literal `{{eventType}}` token with the GTM variable selector
     (click the lego brick icon next to the field and pick `eventType`)
   - Triggering: select `cs_score trigger`
   - Save as `Customer Scoring`
5. Click **Preview** in GTM and load your store. Visit a PDP. In the GTM
   preview pane, you should see:
   - `cs_score` event in the timeline
   - The `Customer Scoring` tag fired
   - In your browser DevTools → Network tab, a POST to your Railway `/score`
     URL with status 200 and a JSON response showing the new score
6. If everything looks good, click **Submit** in GTM to publish.

---

## Step 7 — Wire the ad platforms

You can do these one at a time. After adding each set of env vars in Railway,
the service will redeploy automatically.

### 7a. Meta CAPI

1. In **Meta Events Manager**, open your pixel.
2. **Settings → Conversions API → Set up manually → Generate access token.**
3. Copy the token. In Railway, set:
   - `META_PIXEL_ID` = your pixel ID
   - `META_CAPI_TOKEN` = the token
4. Test: in Events Manager → **Test events** tab, copy the test event code.
   Trigger a `checkout_started` event from your store as a logged-in test
   customer. Within ~30 seconds you should see a `qualified_consideration`
   event appear in the test events panel with `intent_tier`, `score`, and
   `event_id` fields.
5. Confirm the event_id matches between server and browser by enabling the
   Meta Pixel Helper Chrome extension and watching it dedupe.

### 7b. GA4 Measurement Protocol

1. In **GA4 → Admin → Data Streams**, click your web stream.
2. Scroll to **Measurement Protocol API secrets → Create**.
3. Copy the Measurement ID (`G-XXXXXXX`) and the API secret. In Railway, set:
   - `GA4_MEASUREMENT_ID`
   - `GA4_API_SECRET`
4. Test: in **GA4 → Admin → DebugView**, fire a `checkout_started` event from
   a test customer. You should see `qualified_consideration` show up with the
   `intent_tier` parameter within seconds.
5. Mark `qualified_consideration` as a **key event** in GA4 admin so it counts
   as a conversion.

### 7c. Pinterest CAPI (optional)

1. **Pinterest Ads → Conversions → Get conversion access token**.
2. In Railway set:
   - `PINTEREST_AD_ACCOUNT_ID`
   - `PINTEREST_CAPI_TOKEN`
3. Test in Pinterest's Events Manager.

### 7d. Google Ads (advanced)

The middleware ships with a stub. The real Google Ads Conversion API needs
OAuth2 + customer match. The path of least resistance:

- Use **Google Tag Manager Server-Side Container** + the official **Google
  Ads Conversion** tag, triggered when GTM sees the `qualified_consideration`
  dataLayer event from the browser pixel. This avoids writing any OAuth code.

If you really want server-side from the middleware, install the
[`google-ads-api`](https://www.npmjs.com/package/google-ads-api) package and
flesh out `webhooks/index.ts → sendGoogleAds`.

---

## Step 8 — Turn on Shopify's built-in bot defenses (5 min)

These stack with the bot filter we built and cost nothing:

1. **Settings → Customer accounts → Bot protection** — toggle on.
2. **Settings → Checkout → Spam protection** — enable Checkout Captcha
   (invisible reCAPTCHA).
3. If you have Cloudflare in front of your store, enable **Bot Fight Mode**
   in the Cloudflare dashboard.

---

## Step 9 — (Optional) Install the embedded admin app

Skip this on day one. The system works fine without a UI; you can edit
thresholds via Railway env vars and inspect scores via Shopify admin →
customer → metafields.

When you're ready:

1. **partners.shopify.com → Apps → Create app → Custom app.**
2. Deploy `shopify-admin-app/` to Vercel: `cd shopify-admin-app && npx vercel`.
3. Set the App URL in Partners to your Vercel URL.
4. Set redirect URL to `https://your-vercel-url/auth/callback`.
5. Install the app on your store via the Partner dashboard install link.
6. The dashboard will appear in your Shopify admin sidebar.

---

## Verification checklist

After completing the install, run through this list:

- [ ] `GET /health` on the live middleware returns `{"ok":true}`
- [ ] Visiting a PDP as a logged-in customer creates `scoring.score = 1` on
      that customer's metafields
- [ ] Visiting all 5 key pages caps at score 3 (key-page cap)
- [ ] Hitting `consult_form_start` then `checkout_started` flips
      `qualifiedNow: true` in the response
- [ ] Meta Test Events shows `qualified_consideration` with `intent_tier`
- [ ] GA4 DebugView shows `qualified_consideration` with `intent_tier`
- [ ] An obvious bot test (open the page in Puppeteer/headless Chrome,
      then call `/score`) returns `suppressed: true` and does NOT create
      a metafield update
- [ ] Repeating the same `eventType` within 7 days does NOT increment the
      score (dedup working)

---

## Troubleshooting

**`401 Unauthorized` from Shopify Admin API**
The token is wrong, missing scopes, or you used your custom domain instead of
`*.myshopify.com`. Re-issue the token from Step 2 and double-check
`SHOPIFY_SHOP` ends in `.myshopify.com`.

**`/score` works locally but not from the browser**
CORS. Set `ALLOWED_ORIGIN` in Railway to your storefront origin (including
`https://`), redeploy, and retry.

**GTM tag fires but no network call appears**
You probably forgot to replace `{{eventType}}` with the GTM variable picker,
or the URL still says `YOUR-MIDDLEWARE.example.com`. Check the rendered tag
preview in GTM Preview mode.

**Score never goes up**
The customer might already have a same-eventType event in the last 7 days
(dedup). Try a new event type or wait 7 days. Or check if `suppressed: true`
in the response — that means the bot filter caught it; inspect `bot.reasons`.

**`qualified_consideration` not showing up in Meta**
Check Railway logs (`railway logs`) for `[meta-capi] failed`. Common causes:
wrong pixel ID, expired token, missing `event_time`.

**Metafield writes succeed but you can't see them in Shopify admin**
Customer metafields only show on the customer page if you've added a
**metafield definition**. Go to Settings → Custom data → Customers → Add
definition and add definitions for `scoring.score`, `scoring.tier`, etc.
You'll then see them on the customer detail page.

**Railway service keeps crashing**
Check the build logs. Most common: missing `npm run build` step (the
TypeScript hasn't been compiled). Make sure your start command is
`npm run start`, not `node src/index.ts`.

---

## Estimated time per step

| Step | Time |
| --- | --- |
| 1. Get the code | 5 min |
| 2. Shopify custom app + token | 10 min |
| 3. Local smoke test | 20 min |
| 4. Deploy to Railway | 30 min |
| 5. Theme dataLayer pushes | 30–60 min |
| 6. GTM tag | 30 min |
| 7. Ad platforms (each) | 20–45 min |
| 8. Shopify bot defenses | 5 min |
| 9. Embedded admin app | 2–4 hours |
| **Total (without app)** | **3–5 hours** |

---

## When to call a developer

Hire a Shopify dev (4–8 billable hours) if any of the following are true:

- You don't have a GitHub account or have never used the command line
- You don't have GTM installed yet
- You're on Shopify Plus and want checkout-extension-based event tracking
- You want the embedded admin app installed properly (OAuth, webhooks, etc.)

Send them this file plus the `customer-scoring/` repo and they'll have
everything they need.
