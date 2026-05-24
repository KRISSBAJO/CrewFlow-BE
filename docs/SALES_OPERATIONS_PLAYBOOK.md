# CrewFlow Sales Operations Playbook

This backend supports the CrewFlow sales promise: fewer missed jobs, cleaner dispatch, faster follow-up, and better collections for service businesses.

## Commercial Package

| Plan | Monthly | Setup | Operational promise |
| --- | ---: | ---: | --- |
| Launch | $199/mo | $300 | Replace spreadsheet and message chaos with bookings, customers, reminders, and invoices. |
| Growth | $349/mo | $750 | Add lead pipeline, dispatch, collections, and weekly owner visibility. |
| Scale | $499/mo | Custom | Add deeper automation, permissions, support controls, and priority configuration. |

## Backend Capabilities That Support The Sale

- AI receptionist inquiry intake
- WhatsApp reminders and template readiness
- lead pipeline and follow-up dates
- bookings, staff assignment, and field completion
- invoices, payment links, receipts, Stripe, and Paystack
- overdue invoice scanning and collections timeline
- manager action queue for revenue risk
- owner weekly digest
- platform admin tenant, billing, support, and audit controls

## Payment Positioning

Stripe is the default card provider for global SaaS billing.

Paystack is included for Nigeria and Africa-focused businesses. Configure:

```env
PAYSTACK_SECRET_KEY="sk_live_..."
PAYSTACK_CURRENCY="NGN"
PAYSTACK_PLATFORM_PLAN_CODE="..."
PAYSTACK_TENANT_PLAN_CODE="..."
```

Use Paystack when the buyer expects local card/bank/payment support. Use Stripe where Stripe coverage and subscriptions are preferred.

## Launch Data Needed Per Customer

Before onboarding a paying business, collect:

- business name and industry
- owner and manager users
- WhatsApp business number
- service list, prices, and durations
- staff names and roles
- active customers or recent leads
- current unpaid invoices
- reminder timing preferences
- review request wording
- payment provider preference

## First Workflow To Configure

Start with the smallest workflow that makes money visible:

1. capture inquiry
2. identify service and customer details
3. create booking
4. assign staff
5. send reminder or on-the-way message
6. complete job
7. generate invoice
8. send payment link
9. scan overdue invoices
10. create manager action when revenue is at risk

## Demo Close

Show the buyer:

- one new inquiry becoming a lead
- one lead becoming a booking
- one completed booking creating an invoice
- one overdue invoice becoming a manager action
- one weekly digest summarizing what needs owner attention

Then sell setup, not exploration:

```text
We will configure this first workflow for your team so missed inquiries, staff confusion, and unpaid work become daily action items.
```

