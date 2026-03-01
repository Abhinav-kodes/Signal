// apps/server/src/index.ts
import express from 'express';
import cors from 'cors';
import { trackersRouter } from './api/tracker.router';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/trackers', trackersRouter);
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => console.log(`Signal Server → http://localhost:${PORT}`));