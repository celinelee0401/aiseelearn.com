import type { Config, Context } from '@netlify/functions';
import { createAssessmentRuntime } from '../../gateway/fluency-assessment-runtime.mjs';
export default async (request: Request, context: Context) => createAssessmentRuntime(Netlify.env,context.requestId).submit(request);
export const config: Config = {path:'/api/fluency/assess',method:['POST','GET']};
