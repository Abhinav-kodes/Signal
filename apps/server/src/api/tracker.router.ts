// apps/server/src/api/trackers.router.ts
import { Router } from 'express';
import { setupTracker, listTrackers } from './trackers.controller';

export const trackersRouter = Router();

trackersRouter.post('/setup', setupTracker);
trackersRouter.get('/', listTrackers);
