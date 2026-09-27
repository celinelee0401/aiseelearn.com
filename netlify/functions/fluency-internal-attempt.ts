import type { Config } from '@netlify/functions';
import { handleInternalFluencyAttempt } from '../../gateway/fluency-internal-netlify-adapter.js';

export default handleInternalFluencyAttempt;

export const config: Config = {
  path: '/api/internal/fluency-attempt',
  method: ['POST'],
};
