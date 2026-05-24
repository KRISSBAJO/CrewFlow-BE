# CrewFlow Launch Checklist

## Local Readiness

- [ ] `cp .env.example .env`
- [ ] Postgres is running
- [ ] `yarn prisma:migrate`
- [ ] `yarn seed`
- [ ] `yarn build`
- [ ] `./scripts/smoke.sh`
- [ ] Swagger opens at `/api/docs`
- [ ] Readiness opens at `/api/health/readiness`
- [ ] Frontend `NEXT_PUBLIC_API_URL` points to the backend

## Production Environment

Required:

- [ ] `DATABASE_URL`
- [ ] `JWT_SECRET`
- [ ] `JWT_EXPIRES_IN`
- [ ] `PORT`
- [ ] `CORS_ORIGIN`
- [ ] `PUBLIC_API_URL`

Recommended:

- [ ] `RATE_LIMIT_ENABLED=true`
- [ ] `RATE_LIMIT_WINDOW_MS`
- [ ] `RATE_LIMIT_MAX`
- [ ] `TRUST_PROXY=true` when behind a proxy/load balancer
- [ ] `SWAGGER_ENABLED=false` unless docs are intentionally public
- [ ] `ENABLE_SCHEDULER=true`
- [ ] `SCHEDULER_INTERVAL_MS`

AI receptionist:

- [ ] `OPENAI_API_KEY`
- [ ] `OPENAI_MODEL`

WhatsApp Cloud API:

- [ ] `WHATSAPP_VERIFY_TOKEN`
- [ ] `WHATSAPP_ACCESS_TOKEN`
- [ ] `WHATSAPP_PHONE_NUMBER_ID`
- [ ] `WHATSAPP_APP_SECRET`
- [ ] Meta webhook URL points to `/api/webhooks/whatsapp`
- [ ] Settings page shows WhatsApp mode as `live`

Payments:

- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `PAYSTACK_SECRET_KEY` if selling through Paystack
- [ ] `PAYSTACK_CURRENCY` set to expected settlement currency, for example `NGN`
- [ ] `PAYSTACK_PLATFORM_PLAN_CODE` if using Paystack platform subscriptions
- [ ] `PAYSTACK_TENANT_PLAN_CODE` if using Paystack tenant subscriptions
- [ ] `PAYMENT_SUCCESS_URL`
- [ ] `PAYMENT_CANCEL_URL`
- [ ] Stripe webhook URL points to `/api/webhooks/stripe`
- [ ] Paystack webhook URL points to `/api/webhooks/paystack`
- [ ] Payment success/cancel URLs point to the deployed frontend

## Sales Packaging

- [ ] Launch plan is positioned at `$199/mo + $300 setup`
- [ ] Growth plan is positioned at `$349/mo + $750 setup`
- [ ] Scale plan is positioned at `$499/mo + custom setup`
- [ ] Setup includes services, staff, WhatsApp templates, payment flow, and first workflow configuration
- [ ] Sales demo follows [Sales Operations Playbook](SALES_OPERATIONS_PLAYBOOK.md)

## Deployment Notes

- Run migrations before serving traffic: `yarn prisma:deploy` or your platform migration command.
- Serve the compiled backend with `yarn start:prod`.
- Do not run demo seed against a production customer database.
- Demo seed is blocked in `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.
- Use a long random `JWT_SECRET`.
- Set `CORS_ORIGIN` to the deployed frontend URL.
- Set `PUBLIC_API_URL` to the deployed backend URL.
- Keep `WHATSAPP_APP_SECRET` set in production so webhook signatures are enforced.
- Keep `STRIPE_WEBHOOK_SECRET` set in production so Stripe signatures are enforced.
- Use the Settings WhatsApp panel after deployment to confirm credentials and webhook events.

## Final Smoke

```bash
API_URL=https://your-api.example.com/api ./scripts/smoke.sh
```

Then verify:

- [ ] `/api/health/readiness` returns `status: ok`
- [ ] Login works
- [ ] Dashboard loads
- [ ] Receptionist simulator creates an intake
- [ ] Lead pipeline loads and lead analytics return
- [ ] Retention page loads repeat and win-back candidates
- [ ] Booking can be created
- [ ] Field completion creates invoice
- [ ] Payment link can be created
- [ ] WhatsApp readiness panel reflects expected live/mock mode
