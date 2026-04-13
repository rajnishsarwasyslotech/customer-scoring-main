import axios from 'axios';
import { config } from '../config/index.js';

/**
 * Minimal Shopify Admin REST client for reading/writing customer metafields.
 * All scoring state lives under the `scoring` namespace.
 */

const NAMESPACE = 'scoring';

function client() {
  return axios.create({
    baseURL: `https://${config.shopify.shop}/admin/api/${config.shopify.apiVersion}`,
    headers: {
      'X-Shopify-Access-Token': config.shopify.token,
      'Content-Type': 'application/json',
    },
    timeout: 10_000,
  });
}

export interface CustomerState {
  score: number;
  tier: string | null;
  events: Array<{ type: string; ts: number }>;
  anonIds: string[];
  botScore: number;
  botReasons: string[];
}

const EMPTY: CustomerState = {
  score: 0,
  tier: null,
  events: [],
  anonIds: [],
  botScore: 0,
  botReasons: [],
};

interface Metafield {
  id: number;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export async function readCustomerState(customerId: string): Promise<CustomerState> {
  const { data } = await client().get(`/customers/${customerId}/metafields.json`, {
    params: { namespace: NAMESPACE },
  });
  const fields: Metafield[] = data.metafields ?? [];
  const byKey: Record<string, Metafield> = {};
  for (const f of fields) byKey[f.key] = f;

  return {
    score: byKey.score ? Number(byKey.score.value) : 0,
    tier: byKey.tier ? byKey.tier.value : null,
    events: byKey.events ? safeParse<CustomerState['events']>(byKey.events.value, []) : [],
    anonIds: byKey.anon_ids ? safeParse<string[]>(byKey.anon_ids.value, []) : [],
    botScore: byKey.bot_score ? Number(byKey.bot_score.value) : 0,
    botReasons: byKey.bot_reasons
      ? safeParse<string[]>(byKey.bot_reasons.value, [])
      : [],
  };
}

export async function writeCustomerState(
  customerId: string,
  state: CustomerState
): Promise<void> {
  const writes: Array<Promise<unknown>> = [
    upsertMetafield(customerId, 'score', 'number_integer', String(state.score)),
    upsertMetafield(customerId, 'tier', 'single_line_text_field', state.tier ?? ''),
    upsertMetafield(customerId, 'events', 'json', JSON.stringify(state.events)),
    upsertMetafield(customerId, 'anon_ids', 'json', JSON.stringify(state.anonIds)),
    upsertMetafield(customerId, 'bot_score', 'number_integer', String(state.botScore)),
    upsertMetafield(customerId, 'bot_reasons', 'json', JSON.stringify(state.botReasons)),
  ];
  await Promise.all(writes);
}

async function upsertMetafield(
  customerId: string,
  key: string,
  type: string,
  value: string
): Promise<void> {
  await client().post(`/customers/${customerId}/metafields.json`, {
    metafield: { namespace: NAMESPACE, key, type, value },
  });
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export const emptyState = () => ({ ...EMPTY, events: [], anonIds: [] });
