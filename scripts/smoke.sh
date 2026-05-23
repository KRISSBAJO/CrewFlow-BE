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

echo "smoke: passed"
