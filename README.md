# CrewFlow API

AI-powered operations assistant backend for cleaning and home-service businesses.

This is the money-version foundation: tenants, auth, staff, customers, services,
bookings, attendance, invoices, message logs, automation templates, dashboard
summary, and an AI-receptionist-ready inquiry endpoint.

## Setup

```bash
yarn install
cp .env.example .env
docker compose up -d
yarn prisma:generate
yarn prisma:migrate
yarn seed
yarn start:dev
```

Default API URL:

```text
http://localhost:3002/api
```

Swagger/OpenAPI docs:

```text
http://localhost:3002/api/docs
```

Demo login after seeding:

```text
owner@sparkle.test / Password123!
```

## Core Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/dashboard`
- `GET|POST /api/customers`
- `GET /api/customers/:id/timeline`
- `GET|POST /api/services`
- `GET|POST|PATCH /api/bookings`
- `POST /api/bookings/:id/on-the-way`
- `POST /api/bookings/:id/no-show`
- `POST /api/bookings/:id/complete`
- `GET /api/field/jobs`
- `GET /api/field/jobs/:bookingId`
- `POST /api/field/jobs/:bookingId/start`
- `POST /api/field/jobs/:bookingId/notes`
- `POST /api/field/jobs/:bookingId/complete`
- `GET /api/field/jobs/:bookingId/report`
- `GET|POST /api/tenant/staff`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET|POST /api/invoices`
- `POST /api/invoices/:id/payment-link`
- `GET /api/invoices/:id/html`
- `GET /api/payments`
- `POST /api/payments/:id/receipt`
- `POST /api/payments/mock-checkout/:id/success`
- `POST /api/webhooks/stripe`
- `GET|PATCH /api/actions`
- `POST /api/workflows/scan-overdue-invoices`
- `POST /api/workflows/scan-lost-revenue`
- `GET|POST /api/messages`
- `GET|POST /api/automations`
- `POST /api/receptionist/inquiry`
- `GET|PATCH /api/receptionist/config`
- `GET /api/receptionist/conversations`
- `GET /api/receptionist/conversations/:id`
- `POST /api/receptionist/conversations/:id/handoff`
- `GET|PATCH /api/inbox/:id`
- `GET /api/inbox`
- `POST /api/inbox/:id/reply`
- `POST /api/inbox/:id/ai-suggest`
- `POST /api/inbox/:id/actions`
- `POST /api/inbox/:id/booking-intents`

Every protected endpoint is tenant-scoped from the JWT payload.
