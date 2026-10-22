import type { Config, Context } from '@netlify/functions';
import { createAssessmentRuntime } from '../../gateway/fluency-assessment-runtime.mjs';
export default async (request: Request, context: Context) => createAssessmentRuntime(Netlify.env,context.requestId).worker(request);
export const config: Config = {path:'/api/internal/fluency-assess-job',method:['POST'],background:true};
