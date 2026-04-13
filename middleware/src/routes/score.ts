import { Router } from 'express';
import { z } from 'zod';
import { recordEvent, getScore } from '../lib/scoring.js';

export const scoreRouter = Router();

const SignalsSchema = z
  .object({
    hasMouseMoved: z.boolean().optional(),
    hasScrolled: z.boolean().optional(),
    hasFocused: z.boolean().optional(),
    dwellMs: z.number().optional(),
    isPrerender: z.boolean().optional(),
    webdriver: z.boolean().optional(),
    languagesLength: z.number().optional(),
    timezone: z.string().optional(),
    screenW: z.number().optional(),
    screenH: z.number().optional(),
    honeypotClicked: z.boolean().optional(),
  })
  .optional();

const ScoreSchema = z.object({
  customerId: z.string().optional(),
  anonId: z.string().optional(),
  eventType: z.string().min(1),
  eventId: z.string().optional(), // shared with browser pixel for CAPI dedup
  metadata: z.record(z.unknown()).optional(),
  signals: SignalsSchema,
});

scoreRouter.post('/score', async (req, res) => {
  const parsed = ScoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!parsed.data.customerId && !parsed.data.anonId) {
    return res.status(400).json({ error: 'customerId or anonId required' });
  }
  try {
    const cfThreatRaw = req.header('cf-threat-score');
    const result = await recordEvent({
      ...parsed.data,
      userAgent: req.header('user-agent') ?? undefined,
      ip:
        (req.header('cf-connecting-ip') as string) ||
        (req.header('x-forwarded-for') as string) ||
        req.ip,
      cfThreatScore: cfThreatRaw ? Number(cfThreatRaw) : undefined,
    });
    return res.json(result);
  } catch (e) {
    console.error('[/score] error', e);
    return res.status(500).json({ error: (e as Error).message });
  }
});

scoreRouter.get('/score/:customerId', async (req, res) => {
  try {
    return res.json(await getScore(req.params.customerId));
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});
