import axios from 'axios';
import { createHash } from 'node:crypto';
import { config } from '../config/index.js';

export interface QualifyPayload {
  customerId: string;
  tier: string;       // tier_1 | tier_2 | tier_3
  score: number;
  eventType: string;  // source event that triggered qualification
  eventId?: string;   // shared with browser pixel for CAPI dedup
  autoQualify?: boolean;
}

const EVENT_NAME = 'qualified_consideration';

export async function fireQualify(p: QualifyPayload): Promise<void> {
  await Promise.allSettled([
    sendMetaCapi(p),
    sendGoogleAds(p),
    sendGa4(p),
    sendPinterest(p),
  ]);
}

// ---------- Meta CAPI ----------
async function sendMetaCapi(p: QualifyPayload) {
  if (!config.meta.pixelId || !config.meta.token) return;
  const url = `https://graph.facebook.com/v18.0/${config.meta.pixelId}/events`;
  const body = {
    data: [
      {
        event_name: EVENT_NAME,
        event_time: Math.floor(Date.now() / 1000),
        event_id: p.eventId, // dedup with browser pixel
        action_source: 'website',
        user_data: { external_id: [sha256(p.customerId)] },
        custom_data: {
          intent_tier: p.tier,
          score: p.score,
          source_event: p.eventType,
          auto_qualify: !!p.autoQualify,
        },
      },
    ],
    access_token: config.meta.token,
  };
  try { await axios.post(url, body, { timeout: 10_000 }); }
  catch (e) { console.error('[meta-capi] failed', (e as Error).message); }
}

// ---------- Google Ads ----------
async function sendGoogleAds(p: QualifyPayload) {
  if (!config.googleAds.conversionId || !config.googleAds.developerToken) return;
  // Real Google Ads Conversion API requires OAuth2 + customer_id endpoint.
  // Plug your client in here. We log intent_tier so bidding can use it.
  console.log('[google-ads] would upload conversion', {
    event: EVENT_NAME,
    intent_tier: p.tier,
    score: p.score,
    event_id: p.eventId,
    source_event: p.eventType,
  });
}

// ---------- GA4 Measurement Protocol ----------
async function sendGa4(p: QualifyPayload) {
  if (!config.ga4.measurementId || !config.ga4.apiSecret) return;
  const url =
    `https://www.google-analytics.com/mp/collect` +
    `?measurement_id=${config.ga4.measurementId}` +
    `&api_secret=${config.ga4.apiSecret}`;
  const body = {
    client_id: p.customerId,
    events: [
      {
        name: EVENT_NAME,
        params: {
          intent_tier: p.tier,
          score: p.score,
          source_event: p.eventType,
          event_id: p.eventId,
          auto_qualify: !!p.autoQualify,
        },
      },
    ],
  };
  try { await axios.post(url, body, { timeout: 10_000 }); }
  catch (e) { console.error('[ga4] failed', (e as Error).message); }
}

// ---------- Pinterest CAPI ----------
async function sendPinterest(p: QualifyPayload) {
  if (!config.pinterest?.adAccountId || !config.pinterest?.token) return;
  const url = `https://api.pinterest.com/v5/ad_accounts/${config.pinterest.adAccountId}/events`;
  const body = {
    data: [
      {
        event_name: EVENT_NAME,
        event_time: Math.floor(Date.now() / 1000),
        event_id: p.eventId,
        action_source: 'web',
        user_data: { external_id: [sha256(p.customerId)] },
        custom_data: {
          intent_tier: p.tier,
          score: p.score,
          source_event: p.eventType,
        },
      },
    ],
  };
  try {
    await axios.post(url, body, {
      timeout: 10_000,
      headers: { Authorization: `Bearer ${config.pinterest.token}` },
    });
  } catch (e) {
    console.error('[pinterest] failed', (e as Error).message);
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
}
