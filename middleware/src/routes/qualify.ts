import { Router } from 'express';
import { z } from 'zod';
import { fireQualify } from '../webhooks/index.js';

export const qualifyRouter = Router();

const QualifySchema = z.object({
  customerId: z.string(),
  tier: z.string(),
  score: z.number(),
  eventType: z.string(),
  eventId: z.string().optional(),
  autoQualify: z.boolean().optional(),
});

qualifyRouter.post('/qualify', async (req, res) => {
  const parsed = QualifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  await fireQualify(parsed.data);
  return res.json({ ok: true });
});
