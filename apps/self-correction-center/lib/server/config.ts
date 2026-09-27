export type AppConfig = {
  supabaseUrl: string;
  secretKey: string;
  sessionSecret: string;
};

export type IdentityServiceConfig = AppConfig & {
  identityGatewayHmacSecretCurrent: string;
  identityGatewayHmacSecretPrevious: string | null;
};

export type FluencyRunServiceConfig = AppConfig & {
  fluencyRunHmacSecretCurrent: string;
  fluencyRunHmacSecretPrevious: string | null;
};

export function getAppConfig(): AppConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!supabaseUrl || !secretKey || !sessionSecret || sessionSecret.length < 32) {
    return null;
  }

  return { supabaseUrl, secretKey, sessionSecret };
}

export function getIdentityServiceConfig(): IdentityServiceConfig | null {
  const appConfig = getAppConfig();
  const identityGatewayHmacSecretCurrent = process.env.IDENTITY_GATEWAY_HMAC_SECRET_CURRENT;
  const previousCandidate = process.env.IDENTITY_GATEWAY_HMAC_SECRET_PREVIOUS;
  const identityGatewayHmacSecretPrevious = previousCandidate && previousCandidate.length >= 32
    ? previousCandidate
    : null;

  if (!appConfig || !identityGatewayHmacSecretCurrent || identityGatewayHmacSecretCurrent.length < 32) {
    return null;
  }

  return {
    ...appConfig,
    identityGatewayHmacSecretCurrent,
    identityGatewayHmacSecretPrevious,
  };
}

export function getFluencyRunServiceConfig(): FluencyRunServiceConfig | null {
  const appConfig = getAppConfig();
  const fluencyRunHmacSecretCurrent = process.env.FLUENCY_RUN_HMAC_SECRET_CURRENT;
  const previousCandidate = process.env.FLUENCY_RUN_HMAC_SECRET_PREVIOUS;
  const fluencyRunHmacSecretPrevious = previousCandidate && previousCandidate.length >= 32
    ? previousCandidate
    : null;

  if (!appConfig || !fluencyRunHmacSecretCurrent || fluencyRunHmacSecretCurrent.length < 32) {
    return null;
  }

  return {
    ...appConfig,
    fluencyRunHmacSecretCurrent,
    fluencyRunHmacSecretPrevious,
  };
}
