# CrewFlow Demo Script

Use this flow to show CrewFlow as a money engine for cleaning and home-service teams.

## 1. Open The Console

- Backend: `http://localhost:3002/api`
- Swagger: `http://localhost:3002/api/docs`
- Frontend: `http://localhost:3000/app`
- Login: `owner@sparkle.test / Password123!`

## 2. Show The Revenue Command Center

Open **Overview**.

Point out:
- revenue pipeline from lead to paid job
- at-risk revenue
- hot receptionist leads
- overdue invoices
- manager action queue

Message: CrewFlow shows what is costing the business money today.

## 3. Simulate A Receptionist Inquiry

Open **Inbox**.

Use the Receptionist Simulator:

```text
Hi, I need a deep clean next Friday afternoon at 123 Main St.
Can you quote and book me?
```

Show:
- assistant reply
- detected service
- quote
- missing fields
- created conversation

Open the intake and book the lead.

## 4. Confirm Booking Operations

Open **Bookings**.

Show:
- customer
- service
- assigned staff
- booking status
- recurring/new-lead creation if needed

Open the booking drawer and show editable status, staff, notes, and invoice context.

## 5. Complete Field Work

Open **Field**.

Show:
- job packet
- checklist
- staff notes
- photo URLs
- completion action

Complete a job and mention that invoice follow-up starts immediately.

## 6. Collect Payment

Open **Money**.

Show:
- open invoice total
- overdue total
- paid total
- invoice drawer
- payment link creation
- mark paid

Message: completed work turns into payment follow-up without waiting on admin memory.

## 7. Show WhatsApp Readiness

Open **Settings**.

Show:
- WhatsApp readiness
- live/mock mode
- missing credentials
- delivery monitor
- webhook event history
- retry failed automation runs

Message: local demos stay safe in mock mode, production becomes visible when Meta credentials are configured.

## 8. Close With The Buyer Outcome

CrewFlow helps a service business:
- respond faster
- book more jobs
- reduce staff confusion
- invoice immediately
- recover overdue cash
- see daily revenue risk
