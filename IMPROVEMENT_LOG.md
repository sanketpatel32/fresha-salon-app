# Improvement Loop Log

Automated product-improvement loop. Each iteration: implement → test → commit → push.
Baseline at start: 21/21 tests passing on branch `improve/app-hardening`.

## Roadmap

| # | Focus | Status |
|---|-------|--------|
| 1 | Security: auth-gate payment status endpoint + tests | ✅ |
| 2 | Security: timing-safe admin login, signup rate limits, param validation | ✅ |
| 3 | Feature: pagination for appointment listings *(replaced async-wrapper idea — Express 5 forwards async errors natively)* | ✅ |
| 4 | Feature: password reset flow | ✅ |
| 5 | Feature: in-app notifications | ✅ |
| 6 | Feature: reschedule appointment | ✅ |
| 7 | Feature: email verification on signup | ✅ |
| 8 | Feature: salon review replies | ⏳ |
| 9 | Feature: CSV export of salon appointments | ⬜ |
| 10 | Feature: promo codes | ⬜ |
| 11 | Feature: salon photo gallery | ⬜ |
| 12 | Feature: per-salon booking lead time & slot step config | ⬜ |
| 13 | Feature: no-show status + staff today-schedule endpoint | ⬜ |
| 14 | Feature: favorites pagination + isFavorite flag in browse | ⬜ |
| 15 | Feature: public staff directory per salon | ⬜ |
| 16 | Feature: admin platform stats + audit log | ⬜ |
| 17 | Feature: deep health check + request-id logging | ⬜ |
| 18 | Feature: notification emails on cancel/decline/no-show | ⬜ |
| 19 | Frontend polish (React) | ⬜ |
| 20 | Test sweep: favorites & services CRUD coverage | ⬜ |
| 21 | Docs: README feature matrix + final verification | ⬜ |

## Completed

- **#1 Payment status endpoint locked down** — `GET /api/pay/:orderId` previously had no auth; anyone with an order id could read payment details and trigger gateway syncs. Now requires a stakeholder role (paying customer via `Payment.customerID`, involved salon via `Payment.salonId`, or admin), enforced in route middleware + `canAccessPayment` controller check that runs *before* any Cashfree call. 7 new tests (`tests/payment-status-auth.test.js`). Tests: 21 → 28.

- **#2 Auth & input hardening** — admin login now uses `crypto.timingSafeEqual` over SHA-256 hashes (no timing leak, both fields always compared); signup endpoints (`/api/user/signup`, `/api/business/signup`, legacy `/api/buisness/signup`) now share the strict login rate limiter; public `getAllActiveServicesBySalonId` validates `salonId` with a zod query schema.

- **#4 Pagination for appointment listings** — added shared `paginateQuery`/`buildMeta` helpers (`utils/pagination.js`: page/limit coerced + clamped to 1..50, defaults 1/10) and applied them to customer `/api/appointment/getAll`, salon `/sceduledAppointments`, and admin `/appointments/getall` via `findAndCountAll`. Fully backward compatible: no `page`/`limit` params → legacy bare array (existing React + legacy JS consumers untouched); either param present → `{ data, page, limit, total, totalPages }` envelope. 15 new tests in `tests/pagination.test.js` cover clamping, both response shapes, meta math, and scoping. Tests: 28 → 43.

- **#5 Password reset flow** — customers can self-service forgotten passwords: `POST /api/user/forgot-password` issues a random 256-bit token of which only the SHA-256 hash plus a 60-minute expiry are stored (the plaintext link is emailed via a new `sendPasswordResetEmail` helper in the Brevo service, which stays a safe no-op when unconfigured), and `POST /api/user/reset-password` verifies token + email against the hash and window, rotates the bcrypt password (cost 10), and clears both token fields; both endpoints respond identically whether or not the account exists (no enumeration). They're public but share the strict login rate limiter — extracted to `middlewares/rateLimiters.js` so app.js mounts and route-level guards use one policy — with new zod schemas (`forgotPasswordSchema`, `resetPasswordSchema`, newPassword min 8). Because `sync()` never ALTERs existing tables, the two nullable user columns are backfilled at boot by a reusable `utils/ensureColumns.js` helper. 7 new tests in `tests/password-reset.test.js`. Tests: 43 → 50.

- **#6 In-app notifications** — a `notifications` table (`recipientRole` customer|salon, plain integer `recipientId` refs — no FK associations, so no circular-import risk) plus a fire-and-forget `notify()` service (`services/notificationService.js`) that catches and logs every failure so it can never break an already-successful booking flow. Hooks are wired after each DB write succeeds: booking finalized → salon gets "New booking" (`services/paymentService.js`, which is where bookings actually materialize from successful payments); status transitions confirmed/declined/completed → customer; customer cancellation → the other party (the salon). Three new endpoints at `/api/notifications` — list (newest-first, same backward-compatible legacy-array/envelope pagination contract as the appointment listings), mark-one-read (404s foreign/unknown ids), and read-all — scoped via `authMiddleware.requireRole('customer','salon','admin')` with customers keyed on `req.user.userId` and salons on `req.user.salonId`. 12 new tests in `tests/notifications.test.js`. Tests: 50 → 62.

- **#7 Reschedule appointment** — customers can move their own upcoming booking via `PATCH /api/appointment/:appointmentId/reschedule`: a pure `canReschedule(appointment, now)` rule (`utils/statusRules.js`) reuses the cancellation semantics (status pending|confirmed only, start strictly >24h away), ownership is enforced like cancel, and an optional `staffId` may reassign to any staff of the same salon who provides the same service. The new slot is revalidated against salon working hours and conflict-checked via `conflictingStaffIds` (blockouts + other bookings, now accepting an `excludeAppointmentId` so a booking can't collide with itself), returning 409 `New slot is not available` when busy; on success date/time/endTime/staff are persisted and the salon receives a fire-and-forget `booking.rescheduled` notification carrying old→new date/time. 7 new direct-controller tests in `tests/reschedule.test.js`. Tests: 62 → 69.

- **#8 Email verification** — customer signups now get a SOFT verification flow: when Brevo is configured (`emailService.isConfigured()` reads credentials without building the SDK client), signup issues a random 256-bit token whose SHA-256 hash plus a 24-hour expiry are stored on three new nullable user columns (`emailVerified`, `verificationTokenHash`, `verificationExpiresAt`, backfilled at boot by the existing `ensureColumns` call) and emailed fire-and-forget via a new `sendVerificationEmail` helper; unconfigured mailer → no token, account still created, nothing crashes. `POST /api/user/verify-email` flips the flag and burns the token on success (unknown/wrong/expired all get one generic 400) and `POST /api/user/resend-verification` always answers a generic 200 while rotating the token for known emails — both public but behind the strict rate limiter with new zod schemas. Accounts remain fully usable while unverified (flag exposed in signup response + profile for future gating; login responses untouched since they carry no user fields). 7 new tests in `tests/email-verification.test.js`. Tests: 69 → 76.

