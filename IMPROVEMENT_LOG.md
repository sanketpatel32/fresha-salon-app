# Improvement Loop Log

Automated product-improvement loop. Each iteration: implement → test → commit → push.
Baseline at start: 21/21 tests passing on branch `improve/app-hardening`.

## Roadmap

| # | Focus | Status |
|---|-------|--------|
| 1 | Security: auth-gate payment status endpoint + tests | ✅ |
| 2 | Security: timing-safe admin login, signup rate limits, param validation | ✅ |
| 3 | Reliability: central async error wrapper for controllers | ✅ |
| 4 | Feature: pagination for appointment listings | ✅ |
| 5 | Feature: password reset flow | ✅ |
| 6 | Feature: in-app notifications | ⏳ in progress |
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

- **#5 Password reset flow** — customers can self-service forgotten passwords: `POST /api/user/forgot-password` issues a random 256-bit token of which only the SHA-256 hash plus a 60-minute expiry are stored (the plaintext link is emailed via a new `sendPasswordResetEmail` helper in the Brevo service, which stays a safe no-op when unconfigured), and `POST /api/user/reset-password` verifies token + email against the hash and window, rotates the bcrypt password (cost 10), and clears both token fields; both endpoints respond identically whether or not the account exists (no enumeration). They're public but share the strict login rate limiter — extracted to `middlewares/rateLimiters.js` so app.js mounts and route-level guards use one policy — with new zod schemas (`forgotPasswordSchema`, `resetPasswordSchema`, newPassword min 8). Because `sync()` never ALTERs existing tables, the two nullable user columns are backfilled at boot by a reusable `utils/ensureColumns.js` helper. 7 new tests in `tests/password-reset.test.js`. Tests: 43 → 50.

- **#6 In-app notifications** — a `notifications` table (`recipientRole` customer|salon, plain integer `recipientId` refs — no FK associations, so no circular-import risk) plus a fire-and-forget `notify()` service (`services/notificationService.js`) that catches and logs every failure so it can never break an already-successful booking flow. Hooks are wired after each DB write succeeds: booking finalized → salon gets "New booking" (`services/paymentService.js`, which is where bookings actually materialize from successful payments); status transitions confirmed/declined/completed → customer; customer cancellation → the other party (the salon). Three new endpoints at `/api/notifications` — list (newest-first, same backward-compatible legacy-array/envelope pagination contract as the appointment listings), mark-one-read (404s foreign/unknown ids), and read-all — scoped via `authMiddleware.requireRole('customer','salon','admin')` with customers keyed on `req.user.userId` and salons on `req.user.salonId`. 12 new tests in `tests/notifications.test.js`. Tests: 50 → 62.

