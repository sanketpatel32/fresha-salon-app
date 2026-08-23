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

### Booking
| Feature | Notes |
|---|---|
| Availability engine | Per-salon working hours, lead time (`bookingLeadTimeMinutes`) & slot step (`slotStepMinutes`), staff conflict + blockout checks |
| Group bookings | Optional `partySize` (1–20, default 1) on bookings; one professional serves the group — no extra staff slots |
| Reschedule | Customers move upcoming bookings (>24 h out), optional staff reassignment + headcount change, slot revalidated |
| Cancel policy | >24 h free cancellation window |
| No-show status | Terminal `no-show` status, salon-only, past appointments only |
| Promo codes | Percent/flat discounts with caps, windows, usage limits, per-salon scoping; idempotent redemption accounting |
| Payments | Cashfree orders with **idempotent webhook** (raw-body signature verify) + stuck-payment recovery |

### Engagement
| Feature | Notes |
|---|---|
| Reviews + salon replies | Customers rate/review completed bookings; owners reply publicly (upsert) |
| Favorites | Add/remove/list (paginated); `isFavorite` flag in browse for logged-in customers |
| In-app notifications | Fire-and-forget `notify()` service across booking lifecycle; unread counts, mark-read/read-all |
| Status-change emails | Brevo emails on confirmed/declined/completed/no-show/cancelled (safe no-op when unconfigured) |
| Salon gallery | Up to 10 curated image URLs, surfaced on profile/detail/browse reads |

### Salon tools
| Feature | Notes |
|---|---|
| Dashboard CRUD | Services, staff (+service pairings), blockouts — all token-scoped to the owner's salon |
| CSV export | Full booking ledger, RFC-4180 compliant, optional date range |
| Booking config | Lead time (0–7 days) + slot step (10–60 min grid) via `GET/PUT /booking-config` |
| Analytics & calendar | Revenue/ratings aggregation, scheduled-appointments calendar view |
| Staff today schedule | `GET /api/staff/today` — the signed-in staff member's appointments for today |

### Platform
| Feature | Notes |
|---|---|
| Pagination contract | Backward compatible everywhere: no `page`/`limit` → legacy bare array; either param → `{ data, page, limit, total, totalPages }` envelope (clamped 1..50) |
| Admin platform stats | Totals, appointment status breakdown, success-only revenue, trailing-7-day signups |
| Admin audit log | Append-only trail of admin deletions (user/appointment) with context details |
| Observability | `/health` (lightweight probe) + `/health/deep` (DB ping, 503 when degraded) + request-id middleware/logging (`X-Request-Id` echo, one access-log line per request) |

## API quick reference

Notable endpoints (all under `/api`; legacy `/buisness` aliases kept for compatibility):

```
POST   /api/user/forgot-password          # issue hashed reset token (rate-limited)
POST   /api/user/reset-password           # consume token, rotate password
POST   /api/user/verify-email             # burn verification token
POST   /api/user/resend-verification      # rotate + resend (generic 200)

GET    /api/user/favorites?page&limit     # paginated favorites (legacy array w/o params)
GET    /api/business/getall?page&limit    # browse salons; ?token → isFavorite per salon
GET    /api/business/staff?salonId=N      # public staff directory + services

PATCH  /api/appointment/:id/reschedule    # customer moves own booking (>24h)
PUT    /api/appointment/:id/reply         # salon replies to a review
GET    /api/appointment/export/csv?from&to# salon booking ledger as CSV

GET    /api/pay/:orderId                  # payment status — now auth-gated (stakeholder roles)

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

GET    /api/admin/stats                   # platform totals/status/revenue/signups
GET    /api/admin/audit?page&limit        # append-only admin audit trail

GET    /health                            # lightweight liveness probe
GET    /health/deep                       # DB ping → 200 ok / 503 degraded
```

## Getting started

```bash
npm install                # also installs frontend deps (postinstall)

cp .env.example .env       # then edit .env — JWT_SECRET is MANDATORY:
                           # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run dev                # nodemon on http://localhost:3000
```

- **Database:** unset `DATABASE_URL` → file-based SQLite at `./database.sqlite` (auto-created, auto-seeded with sample salons/services/staff on first boot). Set it → Postgres.
- **Emails/payments:** boot fine unconfigured; Brevo (`BREVO_API_KEY`, `SENDER_EMAIL`) and Cashfree (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`) enable those features.
- **Admin console:** set `ADMIN_USER` / `ADMIN_PASS`.

### Tests

```bash
npm test                   # 253 tests across tests/*.test.js (node:test runner)
```

### Frontend build

```bash
npm run build --prefix frontend   # Vite production build → frontend/dist (gitignored)
```

The Express server serves `frontend/dist` statically and falls back to its `index.html` for all non-API routes, so one process hosts the whole app.

## Docs

- [`IMPROVEMENT_LOG.md`](./IMPROVEMENT_LOG.md) — 25-iteration improvement loop log (security, features, tests).
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — Render deployment notes.
- [`SAMPLE_DATA.md`](./SAMPLE_DATA.md) — seeded demo accounts.
