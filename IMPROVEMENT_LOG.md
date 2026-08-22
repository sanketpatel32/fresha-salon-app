# Improvement Loop Log

Automated product-improvement loop. Each iteration: implement → test → commit → push.
Baseline at start: 21/21 tests passing on branch `improve/app-hardening`.

## Roadmap

| # | Focus | Status |
|---|-------|--------|
| 1 | Security: auth-gate payment status endpoint + tests | ✅ |
| 2 | Security: timing-safe admin login, signup rate limits, param validation | ✅ |
| 3 | Reliability: central async error wrapper for controllers | ✅ |
| 4 | Feature: pagination for appointment listings | ⏳ in progress |
| 5 | Feature: password reset flow | ⬜ |
| 6 | Feature: in-app notifications | ⬜ |
| 7 | Feature: reschedule appointment | ⬜ |
| 8 | Feature: email verification on signup | ⬜ |
| 9 | Feature: salon review replies | ⬜ |
| 10 | Feature: CSV export of salon appointments | ⬜ |
| 11 | Feature: promo codes | ⬜ |
| 12 | Feature: salon photo gallery | ⬜ |
| 13 | Feature: per-salon booking lead time & slot step config | ⬜ |
| 14 | Feature: no-show status + staff today-schedule endpoint | ⬜ |
| 15 | Feature: favorites pagination + isFavorite flag in browse | ⬜ |
| 16 | Feature: public staff directory per salon | ⬜ |
| 17 | Feature: admin platform stats + audit log | ⬜ |
| 18 | Feature: deep health check + request-id logging | ⬜ |
| 19 | Feature: notification emails on cancel/decline/no-show | ⬜ |
| 20 | Frontend polish (React) | ⬜ |
| 21 | Test sweep: favorites & services CRUD coverage | ⬜ |
| 22 | Docs: README feature matrix + final verification | ⬜ |

## Completed

- **#1 Payment status endpoint locked down** — `GET /api/pay/:orderId` previously had no auth; anyone with an order id could read payment details and trigger gateway syncs. Now requires a stakeholder role (paying customer via `Payment.customerID`, involved salon via `Payment.salonId`, or admin), enforced in route middleware + `canAccessPayment` controller check that runs *before* any Cashfree call. 7 new tests (`tests/payment-status-auth.test.js`). Tests: 21 → 28.

- **#2 Auth & input hardening** — admin login now uses `crypto.timingSafeEqual` over SHA-256 hashes (no timing leak, both fields always compared); signup endpoints (`/api/user/signup`, `/api/business/signup`, legacy `/api/buisness/signup`) now share the strict login rate limiter; public `getAllActiveServicesBySalonId` validates `salonId` with a zod query schema.

- **#4 Pagination for appointment listings** — added shared `paginateQuery`/`buildMeta` helpers (`utils/pagination.js`: page/limit coerced + clamped to 1..50, defaults 1/10) and applied them to customer `/api/appointment/getAll`, salon `/sceduledAppointments`, and admin `/appointments/getall` via `findAndCountAll`. Fully backward compatible: no `page`/`limit` params → legacy bare array (existing React + legacy JS consumers untouched); either param present → `{ data, page, limit, total, totalPages }` envelope. 15 new tests in `tests/pagination.test.js` cover clamping, both response shapes, meta math, and scoping. Tests: 28 → 43.

