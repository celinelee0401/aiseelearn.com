import type { Config } from '@netlify/functions';
import { handleInternalStudentIdentity } from '../../gateway/fluency-internal-netlify-adapter.js';

export default handleInternalStudentIdentity;

export const config: Config = {
  path: '/api/internal/student-identity',
  method: ['POST'],
};
