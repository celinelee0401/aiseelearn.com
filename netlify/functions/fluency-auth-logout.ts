import type { Config } from "@netlify/functions";
import { createFluencyLogoutAdapter } from "../../gateway/student-identity-netlify-adapter.mjs";

const handler = createFluencyLogoutAdapter();

export default async (request: Request) => handler(request);

export const config: Config = {
  path: "/api/fluency/auth/logout",
  method: ["POST"]
};
