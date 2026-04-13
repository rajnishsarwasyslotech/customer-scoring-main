/**
 * Bot filter — layered heuristic scoring.
 *
 * Each signal contributes points to a session-level bot_score (0–100).
 * If the score crosses BOT_THRESHOLD the event is suppressed: it doesn't
 * award scoring points and it never fires /qualify, so Meta CAPI / Google
 * Ads / GA4 never see bot conversions.
 *
 * Sessions are keyed by anonId. Replace the in-memory Map with Redis for
 * multi-instance deployments.
 */

import { isbot } from 'isbot';

export const BOT_THRESHOLD = 60;

export interface ClientSignals {
  hasMouseMoved?: boolean;
  hasScrolled?: boolean;
  hasFocused?: boolean;
  dwellMs?: number;
  isPrerender?: boolean;
  webdriver?: boolean;
  languagesLength?: number;
  timezone?: string;
  screenW?: number;
  screenH?: number;
  honeypotClicked?: boolean;
}

export interface BotJudgement {
  isBot: boolean;
  score: number;
  reasons: string[];
}

interface SessionState {
  events: Array<{ type: string; ts: number }>;
  poisoned: boolean;
  bestSignals: ClientSignals;
  botScore: number;
  reasons: Set<string>;
}

const sessions = new Map<string, SessionState>();

// Periodic GC so the map doesn't grow forever
const SESSION_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    const last = s.events[s.events.length - 1]?.ts ?? 0;
    if (now - last > SESSION_TTL_MS) sessions.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

export interface JudgeInput {
  anonId: string;
  eventType: string;
  userAgent?: string;
  ip?: string;
  cfThreatScore?: number; // 0–100, from Cloudflare header if present
  signals?: ClientSignals;
}

export function judge(input: JudgeInput): BotJudgement {
  const now = Date.now();
  const session =
    sessions.get(input.anonId) ??
    ({
      events: [],
      poisoned: false,
      bestSignals: {},
      botScore: 0,
      reasons: new Set<string>(),
    } as SessionState);

  // Merge "best so far" signals — once true, stays true.
  if (input.signals) {
    const s = session.bestSignals;
    s.hasMouseMoved ||= !!input.signals.hasMouseMoved;
    s.hasScrolled ||= !!input.signals.hasScrolled;
    s.hasFocused ||= !!input.signals.hasFocused;
    s.dwellMs = Math.max(s.dwellMs ?? 0, input.signals.dwellMs ?? 0);
    s.webdriver = s.webdriver || input.signals.webdriver;
    s.isPrerender = s.isPrerender || input.signals.isPrerender;
    s.languagesLength = input.signals.languagesLength ?? s.languagesLength;
    s.timezone = input.signals.timezone ?? s.timezone;
    s.screenW = input.signals.screenW ?? s.screenW;
    s.screenH = input.signals.screenH ?? s.screenH;
    s.honeypotClicked = s.honeypotClicked || input.signals.honeypotClicked;
  }

  const add = (pts: number, reason: string) => {
    session.botScore = Math.min(100, session.botScore + pts);
    session.reasons.add(reason);
  };

  // ---- 1. Hard signals (instant poison) ----
  if (session.poisoned) add(100, 'session_poisoned');

  if (input.signals?.honeypotClicked) {
    session.poisoned = true;
    add(100, 'honeypot_clicked');
  }

  if (input.userAgent && isbot(input.userAgent)) {
    add(80, 'ua_isbot');
  }

  if (session.bestSignals.webdriver) add(70, 'navigator_webdriver');

  // ---- 2. Velocity / cadence ----
  const last = session.events[session.events.length - 1];
  if (last) {
    const delta = now - last.ts;
    if (delta < 300) add(40, 'event_velocity_<300ms');
    else if (delta < 800) add(15, 'event_velocity_<800ms');
  }
  // >X events in 10s window
  const recent = session.events.filter((e) => now - e.ts < 10_000).length;
  if (recent >= 8) add(30, 'burst_8_events_10s');

  // ---- 3. Dwell time ----
  if (input.eventType.startsWith('page_view') && (input.signals?.dwellMs ?? 99999) < 1500) {
    add(20, 'dwell_<1500ms');
  }
  if (input.signals?.isPrerender) add(50, 'document_prerendering');

  // ---- 4. Missing client signals ----
  // Only judge after the session has had a few events to gather signals.
  if (session.events.length >= 3) {
    const s = session.bestSignals;
    if (!s.hasMouseMoved && !s.hasScrolled && !s.hasFocused) {
      add(35, 'no_input_signals');
    }
  }

  // ---- 5. Checkout-without-input pattern ----
  if (input.eventType === 'checkout_reached') {
    const seen = new Set(session.events.map((e) => e.type));
    const hasFunnel =
      seen.has('add_to_cart') || seen.has('product_view') || seen.has('cart_view');
    if (!hasFunnel) add(40, 'checkout_without_funnel');
    if (
      !session.bestSignals.hasMouseMoved &&
      !session.bestSignals.hasFocused
    ) {
      add(30, 'checkout_without_user_input');
    }
  }

  // ---- 6. Linear / metronome cadence ----
  if (session.events.length >= 5) {
    const intervals: number[] = [];
    for (let i = 1; i < session.events.length; i++) {
      intervals.push(session.events[i].ts - session.events[i - 1].ts);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance =
      intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev < 200 && mean < 5000) add(25, 'metronome_cadence');
  }

  // ---- 7. Network signals ----
  if (typeof input.cfThreatScore === 'number' && input.cfThreatScore >= 30) {
    add(Math.min(40, input.cfThreatScore), 'cf_threat_score');
  }

  // ---- 8. Identity sanity ----
  if (session.bestSignals.languagesLength === 0) add(15, 'no_languages');
  if (
    session.bestSignals.screenW !== undefined &&
    session.bestSignals.screenW < 200
  ) {
    add(20, 'tiny_viewport');
  }

  // ---- Record event + persist ----
  session.events.push({ type: input.eventType, ts: now });
  // keep only last 50
  if (session.events.length > 50) session.events.splice(0, session.events.length - 50);
  sessions.set(input.anonId, session);

  return {
    isBot: session.botScore >= BOT_THRESHOLD,
    score: session.botScore,
    reasons: Array.from(session.reasons),
  };
}

export function getSessionBotState(anonId: string): BotJudgement {
  const s = sessions.get(anonId);
  if (!s) return { isBot: false, score: 0, reasons: [] };
  return {
    isBot: s.botScore >= BOT_THRESHOLD,
    score: s.botScore,
    reasons: Array.from(s.reasons),
  };
}
