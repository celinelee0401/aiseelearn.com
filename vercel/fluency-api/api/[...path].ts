import { createFluencyAssessmentAdapter } from '../../../gateway/fluency-assessment-adapter.mjs';
import { handleInternalFluencyAttempt, handleInternalFluencyRuns, handleInternalFluencyTask, handleInternalFluencyTeacher, handleInternalStudentIdentity } from '../../../gateway/fluency-internal-netlify-adapter.ts';
import { createFluencyTaskAdapter } from '../../../gateway/fluency-task-adapter.mjs';
import { createFluencyLogoutAdapter, createFluencySessionReader, createStudentIdentityNetlifyAdapter } from '../../../gateway/student-identity-netlify-adapter.mjs';

function environment(request: Request) {
  const origin = new URL(request.url).origin;
  return {
    STUDENT_IDENTITY_SERVICE_URL: `${origin}/api/internal/student-identity`,
    FLUENCY_TASK_SERVICE_URL: `${origin}/api/internal/fluency-task`,
    FLUENCY_ATTEMPT_SERVICE_URL: `${origin}/api/internal/fluency-attempt`,
    SELF_CORRECTION_LOGIN_URL: process.env.SELF_CORRECTION_LOGIN_URL,
    STUDENT_IDENTITY_HMAC_SECRET_CURRENT: process.env.STUDENT_IDENTITY_HMAC_SECRET_CURRENT,
    FLUENCY_SESSION_SECRET: process.env.FLUENCY_SESSION_SECRET,
    FLUENCY_ASSESSMENT_MODE: process.env.FLUENCY_ASSESSMENT_MODE,
    FLUENCY_ENHANCED_TRANSCRIPT_ENABLED: process.env.FLUENCY_ENHANCED_TRANSCRIPT_ENABLED,
    FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED: process.env.FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED,
    SITE_NAME: process.env.SITE_NAME,
    AZURE_SPEECH_RESOURCE_ENDPOINT: process.env.AZURE_SPEECH_RESOURCE_ENDPOINT,
    AZURE_SPEECH_RECOGNITION_URL: process.env.AZURE_SPEECH_RECOGNITION_URL,
    AZURE_SPEECH_KEY: process.env.AZURE_SPEECH_KEY,
  };
}

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('__fluency_path') || url.pathname;
  const getEnvironment = () => environment(request);

  if (path === '/api/fluency/auth/login') {
    return createStudentIdentityNetlifyAdapter({ getEnvironment })(request);
  }
  if (path === '/api/fluency/auth/logout') return createFluencyLogoutAdapter()(request);
  if (path === '/api/fluency/session') return createFluencySessionReader({ getEnvironment })(request);
  if (path === '/api/fluency/task') return createFluencyTaskAdapter({ getEnvironment })(request);
  if (path === '/api/fluency/assess') {
    return createFluencyAssessmentAdapter({
      getEnvironment,
      reportProviderError: ({ code, status }: { code: string; status: number }) => {
        console.warn(JSON.stringify({ event: 'fluency_assessment_provider_error', code, status }));
      },
    })(request);
  }
  if (path === '/api/internal/student-identity') return handleInternalStudentIdentity(request);
  if (path === '/api/internal/fluency-task') return handleInternalFluencyTask(request);
  if (path === '/api/internal/fluency-attempt') return handleInternalFluencyAttempt(request);
  if (path === '/api/internal/fluency-runs') return handleInternalFluencyRuns(request);
  if (path === '/api/internal/fluency-teacher') return handleInternalFluencyTeacher(request);
  return new Response(JSON.stringify({ error: 'Not found.' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Vercel's framework-free runtime expects the Web Handler form.
export default { fetch: handler };
