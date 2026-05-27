#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3002/api}"
EMAIL="${DEMO_EMAIL:-owner@sparkle.test}"
PASSWORD="${DEMO_PASSWORD:-Password123!}"
ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-admin@crewflow.test}"
ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-Password123!}"

echo "CrewFlow smoke test"
echo "API: $API_URL"

health="$(curl -fsS "$API_URL/health")"
echo "health: $health"

readiness="$(curl -fsS "$API_URL/health/readiness")"
echo "readiness: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.status} productionReady=${j.productionReady} warnings=${j.warnings.length}`)' "$readiness")"

token="$(
  curl -fsS -X POST "$API_URL/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" |
    node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => process.stdout.write(JSON.parse(s).accessToken));'
)"

echo "login: ok"

dashboard="$(
  curl -fsS "$API_URL/dashboard" \
    -H "Authorization: Bearer $token"
)"
echo "dashboard: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.today.appointments.length} appointments, ${j.operations.alerts.length} alerts`)' "$dashboard")"

services="$(
  curl -fsS "$API_URL/services" \
    -H "Authorization: Bearer $token"
)"
service_id="$(node -e 'const a=JSON.parse(process.argv[1]); process.stdout.write(a[0]?.id ?? "")' "$services")"

start_time="$(node -e 'const d=new Date(); d.setDate(d.getDate()+21); d.setHours(10,0,0,0); process.stdout.write(d.toISOString())')"
booking="$(
  curl -fsS -X POST "$API_URL/bookings" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d "{\"inlineCustomer\":{\"name\":\"Smoke Test Customer\",\"phone\":\"+15550999999\",\"email\":\"smoke@example.com\"},\"serviceId\":\"$service_id\",\"startTime\":\"$start_time\",\"notes\":\"Created by scripts/smoke.sh\"}"
)"
echo "booking: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.id} ${j.status}`)' "$booking")"
booking_id="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.id)' "$booking")"

invoice="$(
  curl -fsS -X POST "$API_URL/invoices/from-booking/$booking_id" \
    -H "Authorization: Bearer $token"
)"
invoice_id="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.id)' "$invoice")"
echo "invoice: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.invoiceNo} ${j.status} total=${j.totalCents}`)' "$invoice")"

payment_link="$(
  curl -fsS -X POST "$API_URL/invoices/$invoice_id/payment-link" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"provider":"MOCK"}'
)"
payment_id="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.payment.id)' "$payment_link")"
echo "payment link: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.payment.provider} ${j.payment.status}`)' "$payment_link")"

portal_invoice_before="$(
  curl -fsS "$API_URL/portal/sparkle-home-services/invoices/$invoice_id"
)"
echo "portal invoice: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.invoice.invoiceNo} ${j.invoice.status} checkout=${Boolean(j.invoice.paymentUrl)}`)' "$portal_invoice_before")"

payment_success="$(
  curl -fsS -X POST "$API_URL/payments/mock-checkout/$payment_id/success"
)"
echo "payment success: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.id} ${j.status}`)' "$payment_success")"

completed_job="$(
  curl -fsS -X POST "$API_URL/field/jobs/$booking_id/complete" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"autoInvoice":false,"staffNotes":"Smoke job completed successfully.","checklist":[{"label":"Service delivered","done":true},{"label":"Customer walkthrough complete","done":true}]}'
)"
echo "job complete: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.booking.id} ${j.booking.status} report=${j.report.status}`)' "$completed_job")"

review_message="$(
  curl -fsS -X POST "$API_URL/communications/bookings/$booking_id/send" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"type":"REVIEW_REQUEST","provider":"SYSTEM","note":"Smoke test review follow-up."}'
)"
echo "review request: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.message.provider} ${j.provider.status}`)' "$review_message")"

portal_booking="$(
  curl -fsS "$API_URL/portal/sparkle-home-services/bookings/$booking_id"
)"
echo "portal booking: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.booking.status} next=${j.nextSteps.length}`)' "$portal_booking")"

inquiry="$(
  curl -fsS -X POST "$API_URL/receptionist/inquiry" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"customerName":"Smoke Lead","phone":"+15550999998","message":"I need a deep clean next Friday afternoon at 123 Main St. Can you quote and book me?","channel":"WEB_CHAT"}'
)"
echo "receptionist: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.conversationId} missing=${j.missingFields.join("|") || "none"}`)' "$inquiry")"

whatsapp="$(
  curl -fsS "$API_URL/webhooks/whatsapp/status" \
    -H "Authorization: Bearer $token"
)"
echo "whatsapp: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.provider.mode} ready=${j.provider.ready}`)' "$whatsapp")"

workflow_check="$(
  curl -fsS -X POST "$API_URL/automations/workflow-check" \
    -H "Authorization: Bearer $token"
)"
echo "workflow check: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`passed=${j.passed} runs=${j.results.length}`)' "$workflow_check")"

tenant_billing="$(
  curl -fsS "$API_URL/tenant/billing" \
    -H "Authorization: Bearer $token"
)"
echo "tenant billing: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.subscriptionStatus} plan=${j.subscriptionPlan} staff=${j.usage.staff}/${j.limits.staff ?? "∞"}`)' "$tenant_billing")"

activation="$(
  curl -fsS "$API_URL/tenant/activation" \
    -H "Authorization: Bearer $token"
)"
echo "activation: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.score}% ${j.completed}/${j.total} ${j.setupStatus}`)' "$activation")"

leads="$(
  curl -fsS "$API_URL/leads/analytics" \
    -H "Authorization: Bearer $token"
)"
echo "leads: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.total} total, ${j.followUpsDue} follow-ups due`)' "$leads")"

retention="$(
  curl -fsS "$API_URL/retention" \
    -H "Authorization: Bearer $token"
)"
echo "retention: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.repeatCandidates.length} repeat, ${j.winBackCandidates.length} win-back`)' "$retention")"

actions="$(
  curl -fsS "$API_URL/actions" \
    -H "Authorization: Bearer $token"
)"
echo "actions: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.length} open actions`)' "$actions")"

billing_recovery="$(
  curl -fsS -X POST "$API_URL/workflows/scan-billing-recovery" \
    -H "Authorization: Bearer $token"
)"
echo "billing recovery: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.actionsCreatedOrUpdated} actions`)' "$billing_recovery")"

admin_token="$(
  curl -fsS -X POST "$API_URL/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" |
    node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => process.stdout.write(JSON.parse(s).accessToken));'
)"
platform="$(
  curl -fsS "$API_URL/platform/metrics" \
    -H "Authorization: Bearer $admin_token"
)"
echo "platform: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.activeUsers} users, ${j.bookings} bookings, mrr=${j.mrrCents}, pastDue=${j.pastDueTenants}`)' "$platform")"

tenant_id="$(
  curl -fsS "$API_URL/platform/tenants" \
    -H "Authorization: Bearer $admin_token" |
    node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const tenants=JSON.parse(s); process.stdout.write(tenants.find((t) => t.slug === "sparkle-home-services")?.id ?? tenants[0]?.id ?? ""); });'
)"
billing="$(
  curl -fsS "$API_URL/platform/tenants/$tenant_id/billing" \
    -H "Authorization: Bearer $admin_token"
)"
echo "billing: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.subscriptionStatus} collected=${j.collectedCents} events=${j.events.length}`)' "$billing")"

checkout="$(
  curl -fsS -X POST "$API_URL/platform/tenants/$tenant_id/billing/checkout" \
    -H "Authorization: Bearer $admin_token" \
    -H 'Content-Type: application/json' \
    -d '{"provider":"mock","collectSetupFee":false}'
)"
echo "billing checkout: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`${j.provider} ${j.sessionId}`)' "$checkout")"

provider_workflows="$(
  curl -fsS -X POST "$API_URL/platform/tenants/$tenant_id/billing/verify-provider-workflows" \
    -H "Authorization: Bearer $admin_token" \
    -H 'Content-Type: application/json' \
    -d '{"provider":"ALL"}'
)"
echo "provider workflows: $(node -e 'const j=JSON.parse(process.argv[1]); console.log(`passed=${j.passed} providers=${j.providers.join("|")}`)' "$provider_workflows")"

echo "smoke: passed"
