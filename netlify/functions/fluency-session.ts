import type { Config } from "@netlify/functions";
import { createFluencySessionReader } from "../../gateway/student-identity-netlify-adapter.mjs";

const handler = createFluencySessionReader({
  getEnvironment: () => ({
    FLUENCY_SESSION_SECRET: Netlify.env.get("FLUENCY_SESSION_SECRET")
  })
});

export default async (request: Request) => handler(request);

export const config: Config = {
  path: "/api/fluency/session",
  method: ["GET"]
};
