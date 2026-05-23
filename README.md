# CrewFlow Backend

AI-powered operations backend for cleaning and home-service businesses.

CrewFlow is built around operational pain: missed inquiries, booking chaos, staff dispatch, field completion, unpaid invoices, WhatsApp follow-up, and revenue-risk visibility.

## Stack

- NestJS
- Prisma
- PostgreSQL
- JWT auth
- Swagger/OpenAPI
- Meta WhatsApp Cloud API integration
- Stripe/mock payment links
- OpenAI-ready receptionist layer

## Local Setup

```bash
yarn install
cp .env.example .env
docker compose up -d
yarn prisma:generate
yarn prisma:migrate
yarn seed
yarn start:dev
```

Default URLs:

```text
API:     http://localhost:3002/api
Swagger: http://localhost:3002/api/docs
Health:  http://localhost:3002/api/health
```

Demo login:

```text
owner@sparkle.test / Password123!
manager@sparkle.test / Password123!
crew@sparkle.test / Password123!
admin@crewflow.test / Password123! (platform admin)
```

## Local Without Docker Desktop

Docker Desktop is convenient, but not required. You can run Postgres with Homebrew or another local Postgres install, then set:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crewflow?schema=public"
```

Then run:

```bash
yarn prisma:migrate
yarn seed
yarn start:dev
```

## Environment Variables

Required:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `PORT`

Security/deploy:

- `CORS_ORIGIN` comma-separated allowed frontend origins. Leave unset only for local development.

AI receptionist:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

WhatsApp:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`

Payments:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PAYMENT_SUCCESS_URL`
- `PAYMENT_CANCEL_URL`

Operations:

- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `ENABLE_SCHEDULER`
- `SCHEDULER_INTERVAL_MS`

## Smoke Test

After the backend is running and seeded:

```bash
./scripts/smoke.sh
```

Against a remote API:

```bash
API_URL=https://your-api.example.com/api ./scripts/smoke.sh
```

The smoke test checks health, login, dashboard, booking creation, receptionist intake, and WhatsApp readiness.

## Demo Data

`yarn seed` creates:

- Sparkle Home Services tenant
- owner, manager, and staff users
- cleaning services
- customers
- confirmed booking
- requested booking
- completed job with overdue invoice
- booking-ready receptionist conversation
- automation templates
- active staff attendance
- manager actions for hot lead and overdue invoice

## Core Product Areas

- Auth and tenant isolation
- Tenant settings and onboarding
- Customers and customer timeline
- Services and staff management
- Booking creation, recurrence, inline customers, conflict checks
- Field job completion and invoice generation
- Invoice/payment link flow
- WhatsApp automation and delivery monitor
- Receptionist intake and booking intent conversion
- Manager action queue and revenue-risk dashboard

## Useful Endpoints

- `POST /api/auth/login`
- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/customers`
- `GET /api/customers/:id/timeline`
- `GET|POST /api/bookings`
- `PATCH /api/bookings/:id`
- `GET /api/field/jobs`
- `POST /api/field/jobs/:bookingId/complete`
- `GET /api/invoices`
- `POST /api/invoices/:id/payment-link`
- `GET /api/payments`
- `GET /api/actions`
- `GET /api/inbox`
- `GET /api/leads`
- `GET /api/leads/analytics`
- `GET /api/retention`
- `GET /api/platform/metrics`
- `GET /api/platform/tenants`
- `PATCH /api/platform/tenants/:id`
- `GET /api/platform/audit`
- `POST /api/inbox/:id/booking-intents/:intentId/book`
- `POST /api/receptionist/inquiry`
- `POST /api/workflows/scan-lead-follow-ups`
- `POST /api/retention/scan`
- `GET /api/webhooks/whatsapp/status`
- `GET /api/webhooks/whatsapp/events`
- `GET /api/automations/runs`

## Production Notes

Read:

- [Launch Checklist](docs/LAUNCH_CHECKLIST.md)
- [Demo Script](docs/DEMO_SCRIPT.md)

Important:

- Do not run demo seed against production customer data.
- Use a long random `JWT_SECRET`.
- Set `CORS_ORIGIN` to your deployed frontend origin.
- Set `WHATSAPP_APP_SECRET` so WhatsApp webhook signatures are enforced.
- Set `STRIPE_WEBHOOK_SECRET` so Stripe webhook signatures are enforced.
- Turn on the scheduler only when you want automated operational scans.
- Use `/api/health` and `./scripts/smoke.sh` after deployment.
