# Fresha Salon App: Sample Data & Credentials

This project comes pre-seeded with a realistic demo marketplace so every dashboard and portal is populated out-of-the-box: 5 salons, 27 live services, 12 staff, 12 free customer accounts, 5 promo codes, six weeks of booking history (~600 appointments with ratings, reviews, cancellations, tips and a full payment ledger), upcoming bookings, favorites, a waitlist and notifications.

> **Setup notes**
> - Sample data is auto-seeded into a local `database.sqlite` on first boot (dev default; production needs `SEED_SAMPLE_DATA=true`).
> - To (re)load the demo dataset on an existing database: `npm run seed -- --force` (wipes the demo tables — refused in production).
> - `npm test` runs against a throwaway temp database, so running the tests never wipes your local demo data.
> - All demo data is deterministic (fixed seed): two fresh databases look identical, and dates are generated relative to "now" so there is always a living history and upcoming bookings.

---

## 🔑 Login Portals & Accounts

Select a portal on the landing page and use the following pre-registered credentials:

### 👤 1. Customer Portal (12 free accounts — password: `customer123`)

Any of these can search salons, book, pay and leave feedback:

| Name | Email | Notable demo state |
|---|---|---|
| Jane Doe | `jane@example.com` | history + favorites + a "payment syncing" stuck-payment banner |
| John Smith | `john@example.com` | history + favorites |
| Aarav Sharma | `aarav@example.com` | history |
| Priya Patel | `priya@example.com` | history + waitlisted at Orchid |
| Vikram Mehta | `vikram@example.com` | history |
| Sneha Iyer | `sneha@example.com` | history |
| Rahul Verma | `rahul@example.com` | history |
| Ananya Reddy | `ananya@example.com` | loyalty leader (~500 pts) |
| Karan Malhotra | `karan@example.com` | history |
| Meera Nair | `meera@example.com` | history + waitlisted at Orchid |
| Diya Kapoor | `diya@example.com` | history |
| Arjun Singh | `arjun@example.com` | history |

### 💈 2. Partner Salon Owners (password: `salon123`)

| Salon | Email | Pricing | Demo characteristics |
|---|---|---|---|
| Orchid Luxury Hair & Spa | `owner@orchid.com` | Premium | weekly schedule, gallery, 60-min lead time, 1 archived service |
| Aura Mens Grooming & Co | `owner@aura.com` | Moderate | open all week |
| Vibe Quick Cuts & Styles | `owner@vibe.com` | Affordable | closed Tuesdays |
| Serenity Spa & Wellness | `owner@serenity.com` | Premium | **bookings require approval** (pending queue), 2-hour lead time |
| Blush Beauty Bar | `owner@blush.com` | Moderate | nails & makeup focus, gallery |

### ✂️ 3. Salon Staff (password: `staff123`)

| Name | Email | Salon |
|---|---|---|
| Dr. Sarah Jenkins | `sarah@orchid.com` | Orchid |
| Marcus Aurelius | `marcus@orchid.com` | Orchid |
| Elena Rosseau | `elena@orchid.com` | Orchid |
| James Oliver | `james@aura.com` | Aura |
| Kabir Anand | `kabir@aura.com` | Aura |
| Tina Miller | `tina@vibe.com` | Vibe |
| Rhea D'Souza | `rhea@vibe.com` | Vibe |
| Dr. Anjali Kulkarni | `anjali@serenity.com` | Serenity |
| Feng Lin | `feng@serenity.com` | Serenity |
| Natasha Pinto | `natasha@blush.com` | Blush |
| Zoya Khan | `zoya@blush.com` | Blush |
| Ishita Bose | `ishita@blush.com` | Blush |

### 🎟️ Promo codes (try them at checkout)

| Code | Deal | Scope |
|---|---|---|
| `WELCOME10` | 10% off (cap ₹300, min ₹500) | any salon |
| `FLAT100` | ₹100 off (min ₹1500) | any salon |
| `ORCHID15` | 15% off (cap ₹750) | Orchid only |
| `SPADAY20` | 20% off (cap ₹1500, min ₹3000) | Serenity only |
| `NEWYEAR25` | 25% off — **expired** (demonstrates the expiry rejection) | any salon |

---

## 💳 Demo (fake) payments

No Cashfree account is needed to demo the full book → pay → confirm flow:

- When `CASHFREE_APP_ID`/`CASHFREE_SECRET_KEY` are unset (or `PAYMENTS_MODE=demo`), `/api/pay/` returns a locally-minted `demo-…` session id.
- The booking page shows a **Demo checkout** dialog — "Pay (simulate success)" completes the booking; "Simulate failure" walks the failure UX (and the failure sticks).
- No real money moves and the Cashfree SDK is never contacted. Set real keys (sandbox or production) and the same flow switches to the genuine Cashfree drop-in automatically (`PAYMENTS_MODE=live` forces it).

---

## 🛠️ Seeding internals

The seed lives in [utils/seed.js](utils/seed.js) and runs at boot (via [app.js](app.js)) when the salons table is empty. It is deterministic (fixed-seed PRNG) and generates:

1. 12 customers + 5 salons + 28 services (1 archived) + 12 staff, with staff↔service links
2. 5 promo codes (one expired on purpose)
3. ~600 appointments across the last 6 weeks and next 10 days — completed (with ratings/reviews/salon replies), cancelled (with reasons), no-shows, confirmed, and `pending` at the approval-required salon — each with a matching successful payment row (some discounted, some tipped)
4. Denormalized salon rating caches, loyalty balances (10 pts per completed visit)
5. Favorites (salons + staff), notifications for upcoming bookings, waitlist entries, and one "stuck" payment for the syncing-banner demo

Re-run manually: `npm run seed` (empty DB) or `npm run seed -- --force` (wipe + reseed).
