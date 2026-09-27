import type { Config } from '@netlify/functions';
import { handleInternalFluencyRuns } from '../../gateway/fluency-internal-netlify-adapter.js';

export default handleInternalFluencyRuns;

export const config: Config = {
  path: '/api/internal/fluency-runs',
  method: ['POST'],
};
