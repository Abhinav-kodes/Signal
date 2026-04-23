// apps/server/src/api/trackers.router.ts
import { Router } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import { setupTracker, listTrackers, testTracker } from './trackers.controller';

export const trackersRouter = Router();

// Ensure Auth0 environment variables are present before enabling auth middleware
const jwtCheck = process.env.AUTH0_ISSUER_BASE_URL ? auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: 'RS256'
}) : (req: any, res: any, next: any) => { 
  // Fallback for local testing if env is missing
  req.auth = { payload: { sub: 'local-user' } };
  next(); 
};

trackersRouter.use(jwtCheck);

trackersRouter.post('/setup', setupTracker);
trackersRouter.get('/', listTrackers);
trackersRouter.post('/:id/test', testTracker);
