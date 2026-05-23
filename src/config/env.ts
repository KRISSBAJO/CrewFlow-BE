const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'PORT'];

const recommendedProduction = [
  'CORS_ORIGIN',
  'PUBLIC_API_URL',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'RATE_LIMIT_ENABLED',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX',
];

function parseOrigins(value: string) {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function ensurePositiveInteger(key: string, requiredValue = false) {
  const value = process.env[key];
  if (!value) {
    if (requiredValue) {
      throw new Error(`${key} is required`);
    }
    return;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
}

function ensureUrl(key: string, requireHttps = false) {
  const value = process.env[key];
  if (!value) {
    return;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }

  if (requireHttps && url.protocol !== 'https:') {
    throw new Error(`${key} must use HTTPS in production`);
  }
}

export function validateEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  ensurePositiveInteger('PORT', true);
  ensurePositiveInteger('RATE_LIMIT_WINDOW_MS');
  ensurePositiveInteger('RATE_LIMIT_MAX');
  ensurePositiveInteger('SCHEDULER_INTERVAL_MS');
  ensureUrl('PUBLIC_API_URL', process.env.NODE_ENV === 'production');
  ensureUrl('PAYMENT_SUCCESS_URL', process.env.NODE_ENV === 'production');
  ensureUrl('PAYMENT_CANCEL_URL', process.env.NODE_ENV === 'production');
  ensureUrl(
    'PLATFORM_BILLING_SUCCESS_URL',
    process.env.NODE_ENV === 'production',
  );
  ensureUrl(
    'PLATFORM_BILLING_CANCEL_URL',
    process.env.NODE_ENV === 'production',
  );
  ensureUrl(
    'PLATFORM_BILLING_PORTAL_RETURN_URL',
    process.env.NODE_ENV === 'production',
  );
  ensureUrl(
    'TENANT_BILLING_SUCCESS_URL',
    process.env.NODE_ENV === 'production',
  );
  ensureUrl('TENANT_BILLING_CANCEL_URL', process.env.NODE_ENV === 'production');
  ensureUrl(
    'TENANT_BILLING_PORTAL_RETURN_URL',
    process.env.NODE_ENV === 'production',
  );

  if ((process.env.JWT_SECRET ?? '').length < 24) {
    throw new Error('JWT_SECRET must be at least 24 characters');
  }

  if (process.env.NODE_ENV === 'production') {
    if (process.env.JWT_SECRET === 'replace-with-a-long-random-secret') {
      throw new Error('JWT_SECRET must be changed before production deploy');
    }

    const origins = corsOrigins();
    if (origins === true || origins.length === 0 || origins.includes('*')) {
      throw new Error(
        'CORS_ORIGIN must be set to explicit origins in production',
      );
    }

    if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is required when Stripe is enabled in production',
      );
    }

    const whatsappValues = [
      process.env.WHATSAPP_ACCESS_TOKEN,
      process.env.WHATSAPP_PHONE_NUMBER_ID,
      process.env.WHATSAPP_VERIFY_TOKEN,
    ];
    const hasPartialWhatsApp =
      whatsappValues.some(Boolean) && !whatsappValues.every(Boolean);
    if (hasPartialWhatsApp) {
      throw new Error(
        'WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN must be configured together',
      );
    }

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
  return parseOrigins(configured);
}
