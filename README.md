# Fresha Salon App

A salon booking platform. Customers browse salons and book **paid** appointments (Cashfree payments); salon owners manage services, staff, schedules, promos, and analytics; staff see their day at a glance; an admin console watches over the platform.

**Stack:** Node.js + Express 5 · Sequelize ORM · SQLite (dev) / Postgres (prod) · React + Vite SPA served by the same server · JWT auth · Brevo email · Cashfree payment gateway.

## Features

### Security & Auth
| Feature | Notes |
|---|---|
| 4 JWT roles | `customer`, `salon`, `staff`, `admin` — role guards on every sensitive route |
| Timing-safe admin login | `crypto.timingSafeEqual` over SHA-256 hashes; both fields always compared |
| Rate-limited auth endpoints | 5 req / 15 min / IP on login, signup, forgot/reset password, verify/resend email |
| Password reset | Hashed one-time 256-bit tokens (60-min expiry), no account enumeration |
| Soft email verification | Hashed token + 24-h expiry; accounts usable while unverified |
| GDPR account self-deletion | `DELETE /api/user/me` — password re-auth, future bookings cancelled, row anonymized in place; idempotent generic 200 either way |

### Booking
| Feature | Notes |
|---|---|
| Availability engine | Per-day weekly working hours (legacy single-window fallback), lead time (`bookingLeadTimeMinutes`) & slot step (`slotStepMinutes`), staff conflict + blockout checks |
| Group bookings | Optional `partySize` (1–20, default 1) on bookings; one professional serves the group — no extra staff slots |
| Reschedule | Customers move upcoming bookings (>24 h out), optional staff reassignment + headcount change, slot revalidated |
| Cancel policy | >24 h free cancellation window |
| No-show status | Terminal `no-show` status, salon-only, past appointments only |
| Promo codes | Percent/flat discounts with caps, windows, usage limits, per-salon scoping; idempotent redemption accounting |
| Payments | Cashfree orders with **idempotent webhook** (raw-body signature verify) + stuck-payment recovery |
| Booking notes | Optional ≤500-char `customerNote` rides the payment onto the booking; reschedule can overwrite or clear it |
| Tips | Optional `tipAmount` (0–10000) added AFTER the promo discount; Cashfree order + ledger both carry the tipped total |
| Upcoming + reminders | `GET /api/appointment/upcoming` (next ≤5, soonest-first) + reminder-email sweep for bookings starting ≤24 h out, claim-stamped once; `REMINDERS_DISABLED=1` turns the scheduler off |
| Waitlist | Queue per salon DATE when fully booked (`partySize`-aware); cancellations auto-alert the first waiter who fits; salon sees an oldest-first day sheet |

### Engagement
| Feature | Notes |
|---|---|
| Reviews + salon replies | Customers rate/review completed bookings; owners reply publicly (upsert) |
| Favorites | Add/remove/list (paginated); `isFavorite` flag in browse for logged-in customers |
| Loyalty points | Flat 10 pts per completed booking, awarded exactly once; balance + never-decrementing lifetime counter via `GET /api/user/loyalty` |
| Referral codes | Lazily assigned on first read (unambiguous 8-char alphabet); a code used at signup credits +100 points to BOTH sides |
| In-app notifications | Fire-and-forget `notify()` service across booking lifecycle; unread counts, mark-read/read-all |
| Status-change emails | Brevo emails on confirmed/declined/completed/no-show/cancelled (safe no-op when unconfigured) |
| Salon gallery | Up to 10 curated image URLs, surfaced on profile/detail/browse reads |

### Salon tools
| Feature | Notes |
|---|---|
| Dashboard CRUD | Services, staff (+service pairings), blockouts — all token-scoped to the owner's salon |
| CSV export | Full booking ledger, RFC-4180 compliant, optional date range |
| Booking config | Lead time (0–7 days) + slot step (10–60 min grid) via `GET/PUT /booking-config` |
| Weekly hours editor | `GET/PUT /hours` — stored per-day overrides merged over legacy defaults on read; PUT replaces all 7 days wholesale |
| Analytics & calendar | Revenue/ratings aggregation, scheduled-appointments calendar view, plus daily revenue/tips/discounts/bookings series and top-5 services over a clamped 1..90-day window |
| Staff today schedule | `GET /api/staff/today` — the signed-in staff member's appointments for today |

### Platform
| Feature | Notes |
|---|---|
| Pagination contract | Backward compatible everywhere: no `page`/`limit` → legacy bare array; either param → `{ data, page, limit, total, totalPages }` envelope (clamped 1..50) |
| Browse discovery | Public browse honors `search` (case-insensitive over name AND address), `category`, `minRating`, and `sort=name\|rating\|price-low\|price-high\|newest` |
| Admin platform stats | Totals, appointment status breakdown, success-only revenue + captured tips, trailing-7-day signups |
| Admin audit log | Append-only trail of admin deletions (user/appointment) with context details |
| Observability | `/health` (lightweight probe) + `/health/deep` (DB ping, 503 when degraded) + request-id middleware/logging (`X-Request-Id` echo, one access-log line per request) |
| Self-serve API docs | `GET /api-docs` (searchable HTML viewer) + `GET /api-docs.json` — hand-curated OpenAPI-style reference with auth requirements + notable params per endpoint |
| SPA coverage | Customer dashboard: debounced browse search, "Next up" strip, loyalty/referral card, waitlist manager, checkout note/party-size/tip; salon console: Working Hours + Revenue Analytics tabs; end-to-end journey test suite pins the whole booking lifecycle |

## API quick reference

Notable endpoints (all under `/api`; legacy `/buisness` aliases kept for compatibility):

```
POST   /api/user/forgot-password          # issue hashed reset token (rate-limited)
POST   /api/user/reset-password           # consume token, rotate password
POST   /api/user/verify-email             # burn verification token
POST   /api/user/resend-verification      # rotate + resend (generic 200)
DELETE /api/user/me                       # GDPR self-deletion: password re-auth → anonymize

GET    /api/user/favorites?page&limit     # paginated favorites (legacy array w/o params)
GET    /api/user/loyalty                  # points balance + lifetime earned
GET    /api/user/referral                 # personal referral code (lazily assigned)

GET    /api/business/getall?page&limit    # browse salons; ?search=&category=&minRating=&sort=name
                                          # (?token → isFavorite per salon)
GET    /api/business/staff?salonId=N      # public staff directory + services

PATCH  /api/appointment/:id/reschedule    # customer moves own booking (>24h)
PUT    /api/appointment/:id/reply         # salon replies to a review
GET    /api/appointment/export/csv?from&to# salon booking ledger as CSV
GET    /api/appointment/upcoming          # next ≤5 pending/confirmed bookings, soonest-first

POST   /api/appointment/waitlist          # join a salon day queue (date ≥ today, partySize 1..20)
GET    /api/appointment/waitlist          # my waitlist entries
DELETE /api/appointment/waitlist/:id      # soft-leave (status=left)
GET    /api/salonsdashboard/waitlist?date # salon's day sheet, oldest-first

POST   /api/pay                           # create order; optional promoCode, customerNote,
                                          # partySize (1..20), tipAmount (added after discount)
GET    /api/pay/stuck                     # paid orders with no booking yet (recovery)
GET    /api/pay/:orderId                  # payment status — auth-gated (stakeholder roles)

GET    /api/notifications                 # list (paginated, both shapes)
PATCH  /api/notifications/:id/read        # mark one read
POST   /api/notifications/read-all        # mark all read

POST   /api/salonsdashboard/promos            # create promo code
GET    /api/salonsdashboard/promos            # own promos
PATCH  /api/salonsdashboard/promos/:id        # toggle/edit (code/type immutable)
DELETE /api/salonsdashboard/promos/:id        # soft delete (isActive=false)
PUT    /api/salonsdashboard/gallery           # upsert up-to-10 image URLs
GET/PUT /api/salonsdashboard/booking-config   # lead time + slot step
GET/PUT /api/salonsdashboard/hours            # per-day weekly schedule (7-day JSON)
GET    /api/salonsdashboard/analytics/revenue?days      # daily revenue/tips/discounts/bookings (1..90, default 30)
GET    /api/salonsdashboard/analytics/top-services?days # top 5 completed services in window

GET    /api/staff/today                   # staff member's today schedule

GET    /api/admin/stats                   # platform totals/status/revenue+tips/signups
GET    /api/admin/audit?page&limit        # append-only admin audit trail

GET    /health                            # lightweight liveness probe
GET    /health/deep                       # DB ping → 200 ok / 503 degraded

GET    /api-docs                          # searchable HTML API reference
GET    /api-docs.json                     # same reference as raw JSON
```

## Getting started

```bash
npm install                # also installs frontend deps (postinstall)

cp .env.example .env       # then edit .env — JWT_SECRET is MANDATORY:
                           # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run dev                # nodemon on http://localhost:3000
```

- **Database:** unset `DATABASE_URL` → file-based SQLite at `./database.sqlite` (auto-created, auto-seeded with sample salons/services/staff on first boot). Set it → Postgres.
- **Emails/payments:** boot fine unconfigured; Brevo (`BREVO_API_KEY`, `SENDER_EMAIL`) and Cashfree (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`) enable those features. Set `REMINDERS_DISABLED=1` to skip the appointment-reminder scheduler.
- **Admin console:** set `ADMIN_USER` / `ADMIN_PASS`.

### Tests

```bash
npm test                   # 363 tests across tests/*.test.js (node:test runner)
```

### Frontend build

```bash
npm run build --prefix frontend   # Vite production build → frontend/dist (gitignored)
```

The Express server serves `frontend/dist` statically and falls back to its `index.html` for all non-API routes, so one process hosts the whole app.

## Docs

- [`IMPROVEMENT_LOG.md`](./IMPROVEMENT_LOG.md) — 36-iteration improvement log across two loops (security, features, tests, e2e journeys).
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — Render deployment notes.
- [`SAMPLE_DATA.md`](./SAMPLE_DATA.md) — seeded demo accounts.
