import type { Config } from '@netlify/functions';
import { handleInternalFluencyTask } from '../../gateway/fluency-internal-netlify-adapter.js';

export default handleInternalFluencyTask;

export const config: Config = {
  path: '/api/internal/fluency-task',
  method: ['POST'],
};
