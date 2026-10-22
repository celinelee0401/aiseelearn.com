import type { Config } from "@netlify/functions";
import { createFluencyTaskAdapter } from "../../gateway/fluency-task-adapter.mjs";

const handler = createFluencyTaskAdapter({
  getEnvironment: () => ({
    FLUENCY_SESSION_SECRET: Netlify.env.get("FLUENCY_SESSION_SECRET"),
    STUDENT_IDENTITY_HMAC_SECRET_CURRENT: Netlify.env.get("IDENTITY_GATEWAY_HMAC_SECRET_CURRENT") || Netlify.env.get(
      "STUDENT_IDENTITY_HMAC_SECRET_CURRENT"
    ),
    FLUENCY_TASK_SERVICE_URL: Netlify.env.get("FLUENCY_TASK_SERVICE_URL")
  })
});

export default async (request: Request) => handler(request);

export const config: Config = {
  path: "/api/fluency/task",
  method: ["GET"]
};
