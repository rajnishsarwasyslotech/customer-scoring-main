import 'dotenv/config';

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*',

  shopify: {
    shop: process.env.SHOPIFY_SHOP ?? '',
    token: process.env.SHOPIFY_ADMIN_TOKEN ?? '',
    apiVersion: process.env.SHOPIFY_API_VERSION ?? '2024-10',
  },

  // Per Jerry's blueprint: small integer scale, qualify at 5+
  tiers: {
    tier_1: num(process.env.TIER_1_THRESHOLD, 5), // 5–6
    tier_2: num(process.env.TIER_2_THRESHOLD, 7), // 7–8
    tier_3: num(process.env.TIER_3_THRESHOLD, 9), // 9+
  },

  // Score >= QUALIFY_AT (or auto_qualify event) triggers /qualify
  qualifyAt: num(process.env.QUALIFY_AT, 5),

  // Points per event type.
  // NOTE: page_view_* events count toward a per-session cap of KEY_PAGE_VIEW_CAP.
  eventPoints: {
    // Key pages: +1 each, capped (see KEY_PAGE_VIEW_CAP below)
    page_view_pdp: 1,
    page_view_financing: 1,
    page_view_comparison: 1,
    page_view_delivery: 1,
    page_view_warranty: 1,

    store_locator_interaction: 3,
    financing_click: 3,
    consult_form_start: 4,
    checkout_started: 5, // also auto-qualifies regardless of score
    return_visit_30d: 2,
  } as Record<string, number>,

  // Cap on the cumulative points awarded for "key page view" events
  keyPageViewCap: 3,
  keyPageViewEvents: new Set([
    'page_view_pdp',
    'page_view_financing',
    'page_view_comparison',
    'page_view_delivery',
    'page_view_warranty',
  ]),

  // Events that bypass the threshold and force-qualify
  autoQualifyEvents: new Set(['checkout_started']),

  meta: {
    pixelId: process.env.META_PIXEL_ID ?? '',
    token: process.env.META_CAPI_TOKEN ?? '',
  },
  googleAds: {
    conversionId: process.env.GOOGLE_ADS_CONVERSION_ID ?? '',
    conversionLabel: process.env.GOOGLE_ADS_CONVERSION_LABEL ?? '',
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
  },
  ga4: {
    measurementId: process.env.GA4_MEASUREMENT_ID ?? '',
    apiSecret: process.env.GA4_API_SECRET ?? '',
  },
  pinterest: {
    adAccountId: process.env.PINTEREST_AD_ACCOUNT_ID ?? '',
    token: process.env.PINTEREST_CAPI_TOKEN ?? '',
  },
};

export type Tier = 'tier_1' | 'tier_2' | 'tier_3' | null;

/**
 * Tier mapping per Jerry's spec:
 *   tier_1 = 5–6
 *   tier_2 = 7–8
 *   tier_3 = 9+
 */
export function tierForScore(score: number): Tier {
  if (score >= config.tiers.tier_3) return 'tier_3';
  if (score >= config.tiers.tier_2) return 'tier_2';
  if (score >= config.tiers.tier_1) return 'tier_1';
  return null;
}
