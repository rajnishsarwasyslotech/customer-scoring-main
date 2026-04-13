import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { scoreRouter } from './routes/score.js';
import { qualifyRouter } from './routes/qualify.js';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: config.allowedOrigin }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(scoreRouter);
app.use(qualifyRouter);

app.listen(config.port, () => {
  console.log(`[middleware] listening on :${config.port}`);
});
