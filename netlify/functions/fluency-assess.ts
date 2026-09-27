import type { Config, Context } from "@netlify/functions";
import { createFluencyAssessmentAdapter } from "../../gateway/fluency-assessment-adapter.mjs";

export default async (request: Request, context: Context) => {
  const handler = createFluencyAssessmentAdapter({
    getEnvironment: () => ({
      FLUENCY_SESSION_SECRET: Netlify.env.get("FLUENCY_SESSION_SECRET"),
      STUDENT_IDENTITY_HMAC_SECRET_CURRENT: Netlify.env.get(
        "STUDENT_IDENTITY_HMAC_SECRET_CURRENT"
      ),
      FLUENCY_TASK_SERVICE_URL: Netlify.env.get("FLUENCY_TASK_SERVICE_URL"),
      FLUENCY_ATTEMPT_SERVICE_URL: Netlify.env.get("FLUENCY_ATTEMPT_SERVICE_URL"),
      FLUENCY_ASSESSMENT_MODE: Netlify.env.get("FLUENCY_ASSESSMENT_MODE"),
      FLUENCY_ENHANCED_TRANSCRIPT_ENABLED: Netlify.env.get(
        "FLUENCY_ENHANCED_TRANSCRIPT_ENABLED"
      ),
      FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED: Netlify.env.get(
        "FLUENCY_CONTINUOUS_ASSESSMENT_ENABLED"
      ),
      SITE_NAME: Netlify.env.get("SITE_NAME"),
      AZURE_SPEECH_RESOURCE_ENDPOINT: Netlify.env.get(
        "AZURE_SPEECH_RESOURCE_ENDPOINT"
      ),
      AZURE_SPEECH_RECOGNITION_URL: Netlify.env.get("AZURE_SPEECH_RECOGNITION_URL"),
      AZURE_SPEECH_KEY: Netlify.env.get("AZURE_SPEECH_KEY")
    }),
    reportProviderError: ({ code, status }: { code: string; status: number }) => {
      console.warn(JSON.stringify({
        event: "fluency_assessment_provider_error",
        requestId: context.requestId,
        code,
        status
      }));
    }
  });
  return handler(request);
};

export const config: Config = {
  path: "/api/fluency/assess",
  method: ["POST"]
};
