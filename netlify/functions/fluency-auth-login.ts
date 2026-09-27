import type { Config } from "@netlify/functions";
import {
  createStudentIdentityNetlifyAdapter,
  STUDENT_IDENTITY_ROUTE
} from "../../gateway/student-identity-netlify-adapter.mjs";

const handler = createStudentIdentityNetlifyAdapter({
  getEnvironment: () => ({
    STUDENT_IDENTITY_SERVICE_URL: Netlify.env.get(
      "STUDENT_IDENTITY_SERVICE_URL"
    ),
    SELF_CORRECTION_LOGIN_URL: Netlify.env.get(
      "SELF_CORRECTION_LOGIN_URL"
    ),
    STUDENT_IDENTITY_HMAC_SECRET_CURRENT: Netlify.env.get(
      "STUDENT_IDENTITY_HMAC_SECRET_CURRENT"
    ),
    FLUENCY_SESSION_SECRET: Netlify.env.get("FLUENCY_SESSION_SECRET")
  })
});

export default async (request: Request) => handler(request);

export const config: Config = {
  path: "/api/fluency/auth/login",
  method: ["POST"],
  rateLimit: {
    action: "rewrite",
    to: "/api/platform-rate-limited",
    windowLimit: STUDENT_IDENTITY_ROUTE.rateLimit.windowLimit,
    windowSize: STUDENT_IDENTITY_ROUTE.rateLimit.windowSize,
    aggregateBy: ["ip", "domain"]
  }
};
