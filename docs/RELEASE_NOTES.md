# CrewFlow Backend Release Notes

## Launch Checkpoint

This checkpoint covers the CrewFlow backend through the operational money-engine build.

### Included

- Tenant-aware auth and onboarding
- Staff, customer, service, and booking management
- Tenant branding, staff/customer profile images, and service catalog images
- CSV/Excel-ready customer import and WhatsApp export import
- Inline customer booking creation
- Recurring booking support
- Staff conflict checks
- Field job start, notes, checklist, completion, and reports
- Invoice creation from completed work
- Payment link and mock checkout flow
- Stripe and Paystack payment provider support
- Revenue-risk dashboard
- Manager action queue
- AI receptionist intake
- Inbox booking-intent conversion
- WhatsApp readiness and webhook event monitor
- Automation delivery runs and retry support
- Swagger/OpenAPI docs
- Demo seed data
- Launch checklist, demo script, and smoke script
- Production readiness endpoint with sanitized deployment checks
- Production environment validation for CORS, public API URL, Stripe, Paystack, WhatsApp, numeric limits, and seed safety
- Sales operations playbook with pricing anchors, setup fee positioning, and demo-to-close workflow

### Demo Login

```text
owner@sparkle.test / Password123!
manager@sparkle.test / Password123!
crew@sparkle.test / Password123!
```

### Verification

```bash
yarn build
yarn seed
./scripts/smoke.sh
```

### Important Production Notes

- Set a strong `JWT_SECRET`.
- Do not run demo seed against production data.
- Set `WHATSAPP_APP_SECRET` to enforce WhatsApp webhook signatures.
- Set `STRIPE_WEBHOOK_SECRET` to enforce Stripe webhook signatures.
- Configure Paystack when selling in Nigeria or Africa-focused markets.
- Use `/api/health/readiness` and `scripts/smoke.sh` after deployment.
