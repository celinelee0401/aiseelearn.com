import type { Config } from '@netlify/functions';
import { handleInternalFluencyTeacher } from '../../gateway/fluency-internal-netlify-adapter.js';

export default handleInternalFluencyTeacher;

export const config: Config = {
  path: '/api/internal/fluency-teacher',
  method: ['POST'],
};
