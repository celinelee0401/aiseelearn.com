import { getStore } from '@netlify/blobs';
import { createFluencyAssessmentAdapter } from './fluency-assessment-adapter.mjs';
import { createFluencyAssessmentJobs } from './fluency-assessment-jobs.mjs';

export function createAssessmentRuntime(env, requestId) {
  const environment = {
    FLUENCY_SESSION_SECRET: env.get('FLUENCY_SESSION_SECRET'),
    IDENTITY_GATEWAY_HMAC_SECRET_CURRENT: env.get('IDENTITY_GATEWAY_HMAC_SECRET_CURRENT'),
    STUDENT_IDENTITY_HMAC_SECRET_CURRENT: env.get('IDENTITY_GATEWAY_HMAC_SECRET_CURRENT') || env.get('STUDENT_IDENTITY_HMAC_SECRET_CURRENT'),
    FLUENCY_TASK_SERVICE_URL: env.get('FLUENCY_TASK_SERVICE_URL'),
    FLUENCY_ATTEMPT_SERVICE_URL: env.get('FLUENCY_ATTEMPT_SERVICE_URL'),
    FLUENCY_ASSESSMENT_MODE: env.get('FLUENCY_ASSESSMENT_MODE'),
    FLUENCY_ENHANCED_TRANSCRIPT_ENABLED: env.get('FLUENCY_ENHANCED_TRANSCRIPT_ENABLED'),
    FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED: env.get('FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED'),
    SITE_NAME: env.get('SITE_NAME'),
    AZURE_SPEECH_RESOURCE_ENDPOINT: env.get('AZURE_SPEECH_RESOURCE_ENDPOINT'),
    AZURE_SPEECH_RECOGNITION_URL: env.get('AZURE_SPEECH_RECOGNITION_URL'),
    AZURE_SPEECH_KEY: env.get('AZURE_SPEECH_KEY')
  };
  const reportError = code => console.warn(JSON.stringify({event:'fluency_assessment_job',requestId,code}));
  return createFluencyAssessmentJobs({
    getEnvironment:()=>environment,
    getStore:()=>getStore({name:'fluency-assessment-jobs',consistency:'strong'}),
    assess:createFluencyAssessmentAdapter({getEnvironment:()=>environment,reportProviderError:({code,status})=>console.warn(JSON.stringify({event:'fluency_assessment_provider_error',requestId,code,status}))}),
    reportError
  });
}
