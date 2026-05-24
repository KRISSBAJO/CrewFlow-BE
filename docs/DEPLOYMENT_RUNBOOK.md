# CrewFlow Production Deployment Runbook

## Backend Build

```bash
yarn install --frozen-lockfile
yarn prisma:generate
yarn build
yarn prisma:deploy
yarn start:prod
```

Use `yarn prisma:deploy`, not `yarn prisma:migrate`, in production.

## Required Environment

Start from `.env.production.example`.

Minimum:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `PORT`
- `CORS_ORIGIN`
- `PUBLIC_API_URL`

Production security:

- `RATE_LIMIT_ENABLED=true`
- `TRUST_PROXY=true` behind Render, Railway, Fly, Nginx, or a load balancer
- `SWAGGER_ENABLED=false` unless API docs are intentionally exposed
- `ALLOW_DEMO_SEED=false`

## Integration URLs

Replace `api.yourdomain.com` with the deployed backend host.

- WhatsApp webhook: `https://api.yourdomain.com/api/webhooks/whatsapp`
- Stripe webhook: `https://api.yourdomain.com/api/webhooks/stripe`
- Paystack webhook: `https://api.yourdomain.com/api/webhooks/paystack`
- Health: `https://api.yourdomain.com/api/health`
- Readiness: `https://api.yourdomain.com/api/health/readiness`

## Payments

When Stripe or Paystack is enabled in production, set:

- `PAYMENT_SUCCESS_URL`
- `PAYMENT_CANCEL_URL`
- tenant billing success/cancel/portal URLs
- platform billing success/cancel/portal URLs

Stripe requires `STRIPE_WEBHOOK_SECRET`.

Paystack requires `PAYSTACK_SECRET_KEY`; set plan codes when using subscription checkout.

## WhatsApp

Set all WhatsApp fields together:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`

`WHATSAPP_APP_SECRET` is required in production when WhatsApp is live.

## Post-Deploy Verification

```bash
curl https://api.yourdomain.com/api/health
curl https://api.yourdomain.com/api/health/readiness
API_URL=https://api.yourdomain.com/api ./scripts/smoke.sh
```

Readiness should return:

- `status: "ok"`
- `productionReady: true`
- no production-blocking warnings

## Rollback

1. Disable scheduler: `ENABLE_SCHEDULER=false`.
2. Revert app release to the previous image/build.
3. Do not roll back database migrations unless a tested rollback migration exists.
4. Re-run `/api/health/readiness`.

## Data Safety

Never run `yarn seed` against production customer data.

`ALLOW_DEMO_SEED=false` must stay set in production.
