# CrewFlow UAT Checklist

Use this before customer demos, pilot onboarding, and production handoff.

## Reset Demo Data

```bash
yarn demo:reset
```

This deletes only seeded demo tenants:

- `sparkle-home-services`
- `crewflow-platform`

Then it reseeds a clean demo workspace.

Do not run demo reset against production customer data.

## Personas

- Owner: `owner@sparkle.test / Password123!`
- Manager: `manager@sparkle.test / Password123!`
- Staff: `crew@sparkle.test / Password123!`
- Platform admin: `admin@crewflow.test / Password123!`
- Platform support: `support@crewflow.test / Password123!`

## Tenant Console

- [ ] Owner logs into `/app`.
- [ ] Platform admin is redirected from `/app` to `/admin`.
- [ ] Overview loads revenue metrics, owner weekly digest, alerts, and manager queue.
- [ ] Inbox receptionist simulator creates a conversation and booking intent.
- [ ] Lead pipeline shows booking-ready, won, lost, and follow-up examples.
- [ ] Lead can be converted or followed up.
- [ ] Customer page shows customers and timelines.
- [ ] Booking board shows requested, confirmed, completed, and upcoming work.
- [ ] Manager can create/edit a booking.
- [ ] Staff can view assigned field jobs.
- [ ] Manager can assign dispatch.
- [ ] Field job can be started, notes saved, and completed.
- [ ] Completed job can create an invoice.
- [ ] Money page shows collections, aging buckets, payment timeline, and automation controls.
- [ ] Invoice drawer can create/send payment links and log collection actions.
- [ ] Retention page shows revenue segments and campaign buttons.
- [ ] Settings page loads tenant profile, services, staff, WhatsApp readiness, billing, and activation.

## Platform Admin

- [ ] Admin logs into `/admin`.
- [ ] Tenant user is redirected from `/admin` to `/app`.
- [ ] Platform metrics load.
- [ ] Tenant list/search works.
- [ ] Tenant detail opens.
- [ ] Tenant status and billing controls update.
- [ ] Support note can be created.
- [ ] Support access session can be created and revoked.
- [ ] Automation failure retry and webhook replay controls render.
- [ ] Platform audit loads.

## Permissions

- [ ] Owner can open dashboard.
- [ ] Manager cannot send owner weekly digest.
- [ ] Staff cannot access collections/invoices management.
- [ ] Platform admin cannot access tenant dashboard.
- [ ] Tenant owner cannot access platform metrics.

## Public Booking Portal

- [ ] Public booking page loads for seeded tenant slug.
- [ ] Customer can choose service and availability.
- [ ] Public booking status page loads.
- [ ] Public invoice page loads and payment status refresh works.

## API Smoke

```bash
./scripts/smoke.sh
```

Expected result: `smoke: passed`.

## Visual Pass

- [ ] No desktop horizontal scrolling in `/app`.
- [ ] Sidebar collapse/expand works.
- [ ] Drawer content scrolls correctly.
- [ ] Buttons do not truncate awkwardly.
- [ ] Empty states are readable.
- [ ] Error messages are visible and actionable.
