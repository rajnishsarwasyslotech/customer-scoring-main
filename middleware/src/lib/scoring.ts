import { config, tierForScore } from '../config/index.js';
import {
  readCustomerState,
  writeCustomerState,
  emptyState,
  type CustomerState,
} from './shopify.js';
import { fireQualify } from '../webhooks/index.js';
import { judge, type ClientSignals, type BotJudgement } from './botFilter.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** In-memory anonymous (pre-login) buffer keyed by anonId. */
const anonBuffer = new Map<string, CustomerState>();

export interface ScoreInput {
  customerId?: string;
  anonId?: string;
  eventType: string;
  eventId?: string; // shared with browser pixel for CAPI dedup
  metadata?: Record<string, unknown>;
  userAgent?: string;
  ip?: string;
  cfThreatScore?: number;
  signals?: ClientSignals;
}

export interface ScoreResult {
  score: number;
  tier: string | null;
  qualifiedNow: boolean;
  bot: BotJudgement;
  suppressed: boolean;
}

export async function recordEvent(input: ScoreInput): Promise<ScoreResult> {
  if (!input.customerId && !input.anonId) {
    throw new Error('customerId or anonId required');
  }

  // ----- 0. Bot judgement -----
  const bot = judge({
    anonId: input.anonId ?? `cust:${input.customerId}`,
    eventType: input.eventType,
    userAgent: input.userAgent,
    ip: input.ip,
    cfThreatScore: input.cfThreatScore,
    signals: input.signals,
  });

  // ----- 1. Load state -----
  let state: CustomerState;
  if (input.customerId) {
    state = await loadIdentified(input);
  } else {
    state = anonBuffer.get(input.anonId!) ?? emptyState();
  }

  // Persist bot info even if suppressed
  state.botScore = Math.max(state.botScore, bot.score);
  state.botReasons = Array.from(new Set([...state.botReasons, ...bot.reasons]));

  if (bot.isBot) {
    if (input.customerId) await writeCustomerState(input.customerId, state);
    else anonBuffer.set(input.anonId!, state);
    return { score: state.score, tier: state.tier, qualifiedNow: false, bot, suppressed: true };
  }

  // ----- 2. Auto-derive return_visit_30d -----
  // If this customer/anon already has events from 30+ days ago, award once.
  const now = Date.now();
  const hasOldEvent = state.events.some((e) => now - e.ts >= THIRTY_DAYS_MS);
  if (hasOldEvent && !state.events.some((e) => e.type === 'return_visit_30d')) {
    state.score += config.eventPoints['return_visit_30d'] ?? 0;
    state.events.push({ type: 'return_visit_30d', ts: now });
  }

  // ----- 3. 7-day dedup per event type -----
  state.events = state.events.filter((e) => now - e.ts < SEVEN_DAYS_MS);
  const alreadyFired = state.events.some((e) => e.type === input.eventType);
  if (alreadyFired && !config.autoQualifyEvents.has(input.eventType)) {
    return { score: state.score, tier: state.tier, qualifiedNow: false, bot, suppressed: false };
  }

  // ----- 4. Award points (with key-page cap) -----
  let points = config.eventPoints[input.eventType] ?? 0;
  if (config.keyPageViewEvents.has(input.eventType)) {
    const alreadyFromKeyPages = state.events
      .filter((e) => config.keyPageViewEvents.has(e.type))
      .reduce((sum, e) => sum + (config.eventPoints[e.type] ?? 0), 0);
    const remaining = Math.max(0, config.keyPageViewCap - alreadyFromKeyPages);
    points = Math.min(points, remaining);
  }

  const previousTier = state.tier;
  const previouslyQualified = state.score >= config.qualifyAt;
  state.score += points;
  state.events.push({ type: input.eventType, ts: now });
  state.tier = tierForScore(state.score);

  // ----- 5. Persist -----
  if (input.customerId) await writeCustomerState(input.customerId, state);
  else anonBuffer.set(input.anonId!, state);

  // ----- 6. Qualify check -----
  // Threshold crossed (5+) OR auto-qualify event (e.g. checkout_started)
  const isAutoQualify = config.autoQualifyEvents.has(input.eventType);
  const crossedThreshold = !previouslyQualified && state.score >= config.qualifyAt;
  const qualifiedNow = isAutoQualify || crossedThreshold || state.tier !== previousTier;

  if (qualifiedNow && input.customerId) {
    await fireQualify({
      customerId: input.customerId,
      tier: state.tier ?? 'tier_1',
      score: state.score,
      eventType: input.eventType,
      eventId: input.eventId,
      autoQualify: isAutoQualify,
    });
  }

  return { score: state.score, tier: state.tier, qualifiedNow, bot, suppressed: false };
}

async function loadIdentified(input: ScoreInput): Promise<CustomerState> {
  const state = await readCustomerState(input.customerId!);
  if (input.anonId && !state.anonIds.includes(input.anonId)) {
    const buffered = anonBuffer.get(input.anonId);
    if (buffered) {
      state.score += buffered.score;
      state.events.push(...buffered.events);
      state.botScore = Math.max(state.botScore, buffered.botScore);
      state.botReasons = Array.from(new Set([...state.botReasons, ...buffered.botReasons]));
      anonBuffer.delete(input.anonId);
    }
    state.anonIds.push(input.anonId);
  }
  return state;
}

export async function getScore(customerId: string) {
  const state = await readCustomerState(customerId);
  return {
    customerId,
    score: state.score,
    tier: state.tier,
    botScore: state.botScore,
    botReasons: state.botReasons,
  };
}
