# CrewFlow Launch Checklist

## Local Readiness

- [ ] `cp .env.example .env`
- [ ] Postgres is running
- [ ] `yarn prisma:migrate`
- [ ] `yarn seed`
- [ ] `yarn build`
- [ ] `./scripts/smoke.sh`
- [ ] Swagger opens at `/api/docs`
- [ ] Frontend `NEXT_PUBLIC_API_URL` points to the backend

## Production Environment

Required:

- [ ] `DATABASE_URL`
- [ ] `JWT_SECRET`
- [ ] `JWT_EXPIRES_IN`
- [ ] `PORT`

Recommended:

- [ ] `RATE_LIMIT_ENABLED=true`
- [ ] `RATE_LIMIT_WINDOW_MS`
- [ ] `RATE_LIMIT_MAX`
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
- [ ] `PAYMENT_SUCCESS_URL`
- [ ] `PAYMENT_CANCEL_URL`
- [ ] Stripe webhook URL points to `/api/webhooks/stripe`

## Deployment Notes

- Run migrations before serving traffic: `yarn prisma:migrate` or your platform migration command.
- Do not run demo seed against a production customer database.
- Use a long random `JWT_SECRET`.
- Keep `WHATSAPP_APP_SECRET` set in production so webhook signatures are enforced.
- Keep `STRIPE_WEBHOOK_SECRET` set in production so Stripe signatures are enforced.
- Use the Settings WhatsApp panel after deployment to confirm credentials and webhook events.

## Final Smoke

```bash
API_URL=https://your-api.example.com/api ./scripts/smoke.sh
```

Then verify:

- [ ] Login works
- [ ] Dashboard loads
- [ ] Receptionist simulator creates an intake
- [ ] Booking can be created
- [ ] Field completion creates invoice
- [ ] Payment link can be created
- [ ] WhatsApp readiness panel reflects expected live/mock mode
