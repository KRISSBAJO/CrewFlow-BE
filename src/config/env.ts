const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'PORT'];

const recommendedProduction = [
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'RATE_LIMIT_ENABLED',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX',
];

export function validateEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  if ((process.env.JWT_SECRET ?? '').length < 24) {
    throw new Error('JWT_SECRET must be at least 24 characters');
  }

  if (
    process.env.NODE_ENV === 'production' &&
    process.env.JWT_SECRET === 'replace-with-a-long-random-secret'
  ) {
    throw new Error('JWT_SECRET must be changed before production deploy');
  }

  if (process.env.NODE_ENV === 'production') {
    const missingRecommended = recommendedProduction.filter(
      (key) => !process.env[key],
    );
    if (missingRecommended.length) {
      console.warn(
        `Production warning: recommended environment variables are missing: ${missingRecommended.join(', ')}`,
      );
    }
  }
}

export function corsOrigins() {
  const configured = process.env.CORS_ORIGIN;
  if (!configured) {
    return true;
  }
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
