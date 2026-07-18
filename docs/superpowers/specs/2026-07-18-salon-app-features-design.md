# Fresha Salon App — Multi-Feature Expansion

**Date:** 2026-07-18
**Status:** Design — pending approval
**Approach:** Foundation-first (Approach A). Shared data-model changes land first, then status-powered workflow features, then customer polish, then salon-owner power tools.

---

## 1. Goal

Turn the existing React + Express salon-booking app from a working-but-rough demo into a production-quality app by fixing foundational bugs/security issues and adding features across three user surfaces: customer, staff, and salon-owner. (Admin surface is left as-is except where new statuses require it.)

## 2. Scope

### In scope (12 workstreams across 4 phases)

**Phase 1 — Foundation (no new UI, unblocks everything)**
1. Hash staff passwords with bcrypt; invalidate + re-seed plaintext staff logins.
2. Fix schema mismatches: salon `openingTime`/`closingTime` → `STRING`; add missing `duration` column to `Payment` model.
3. Gate the "Simulate Secure Booking" payment bypass behind `MODE=development` only.
4. Add `status` field to `Appointment` and `rating` field to reviews (data model only; UI comes in later phases).

**Phase 2 — Status-powered workflow (rides on the new `status` field)**
5. Customer: cancel appointment (>24h before; status → `cancelled`).
6. Staff: accept/decline bookings (status `pending` → `confirmed` / `declined`); add post-service notes; mark `completed`.
7. Salon owner: appointment status reflects in their existing table.

**Phase 3 — Customer polish**
8. Real star ratings: aggregate per salon; show honest numbers on salon cards & service pages (replaces the fabricated `4.5 + salon.id % 6 * 0.1`).
9. Rebook past appointments (one click; reuses booking wizard).
10. Favorite/bookmark salons (new `Favorite` model; star toggle on cards + a favorites view on dashboard).

**Phase 4 — Salon owner power tools**
11. Revenue & booking analytics on the salon dashboard (real SQL aggregation: revenue, upcoming vs completed, top services, weekly counts).
12. Calendar view of bookings (week grid of bookings per staff member).
13. Staff availability/blockouts (new `StaffBlockout` model; excluded from availability checker).

### Out of scope
- Photo uploads via S3 (user-deferred).
- Admin-console feature additions (admin keeps current capabilities; only picks up new statuses).
- Notification/reminders/email changes beyond what already exists (Brevo is wired; we won't add new triggers except optionally on booking status changes).
- Authentication refactor (we keep the existing per-role JWT payloads; no role/permission system rewrite).
- Deleting or rewriting the legacy HTML/EJS routes — they stay disabled. We will, however, **remove the dead legacy HTML-serving GETs** mixed into the active `salonsDashboardRoutes.js` (they're unused by the SPA and confusing).
- Refactoring the 2,400-line `App.jsx` into separate files. (Recommended as future work, but not required for these features.)

## 3. Architecture

The app is a single Express server serving a Vite-built React SPA from `frontend/dist`, with a JSON API under `/api`. Sequelize over SQLite (zero-config) — models auto-sync on boot (currently `sync({ alter: false })`).

### 3.1 Sequencing rationale

The `Appointment.status` field is touched by 5 of the 12 workstreams (cancel, accept/decline, mark-complete, analytics, calendar). The `rating` field is touched by 2 (the fake-ratings fix and the customer ratings feature). Doing these as a **single foundation phase** means each downstream feature consumes a stable schema instead of re-touching models and migrations three times.

### 3.2 New / changed data models

**`Appointment` — add fields:**
```js
status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'confirmed' }
```
Allowed values: `pending`, `confirmed`, `declined`, `completed`, `cancelled`.

- Existing (legacy) payment-created appointments default to `confirmed` (they're already paid + booked). Backward compatible.
- New bookings made after Phase 2's accept/decline lands will start as `pending` **only if the salon has opted into approval flow** (see §3.4). Default salon behavior remains auto-`confirmed` to avoid breaking the current booking UX.

**`Appointment` — add rating:**
```js
rating: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1, max: 5 } }
```
Customer review payload `{ review, rating }` updates both `userReview` and `rating`.

**`Payment` — add missing column:**
```js
duration: { type: DataTypes.INTEGER, allowNull: true }
```
(Already written by `paymentController.js:62`; today silently dropped. Adding the column makes it actually persist.)

**`Salons` — fix time columns:**
```js
openingTime: { type: DataTypes.STRING, allowNull: false, defaultValue: '09:00' }
closingTime: { type: DataTypes.STRING, allowNull: false, defaultValue: '20:00' }
```
Currently `INTEGER` (defaults `11`/`23`); seed and UI already write strings — this makes the schema honest. Existing rows with integer values need a one-time migration to `'HH:00'` format (handled in seeder re-run; SQLite is local-only so `sync({alter:true})` during dev is acceptable).

**`Staff` — password hashing:** no schema change; the column already exists. Behavior change: `addStaff` and the seeder hash with bcrypt; login uses `bcrypt.compare`.

**New model — `Favorite`** (Phase 3):
```js
userId:    INTEGER (FK users, composite PK)
salonId:   INTEGER (FK salons, composite PK)
createdAt  timestamp
```
Composite PK on (userId, salonId) prevents duplicates.

**New model — `StaffBlockout`** (Phase 4):
```js
id:         INTEGER PK
staffId:    INTEGER (FK staff, CASCADE)
date:       DATEONLY
startTime:  STRING 'HH:mm'
endTime:    STRING 'HH:mm'
reason:     STRING (optional)
```
Excluded from availability in `appointmentController.appointmentChecker`.

### 3.3 Sync strategy

`sequelize.sync({ alter: true })` during this feature work (we're on local SQLite with seeded data; `alter` is the pragmatic choice for adding columns in place). After the feature set stabilizes we revert to `alter: false`. Re-seeding is destructive only when `database.sqlite` is deleted — which is fine, it's gitignored and auto-seeded.

### 3.4 Booking approval-flow policy (Phase 2)

To avoid forcing every salon into an approval queue, the accept/decline flow is **opt-in per salon**:
```js
// Salons model — add field
requiresApproval: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
```
- Salon owner toggles it in their dashboard settings.
- When `false` (default): new appointments are `confirmed` immediately (current behavior preserved).
- When `true`: new appointments are `pending`; staff/owner accept or decline; declined appointments free the slot and notify the customer (toast + email if Brevo configured).

This keeps the existing UX intact for salons that don't want the overhead, while adding the feature for those that do.

## 4. Component design

For each workstream: what changes, where, and the new/changed endpoints.

### Phase 1 — Foundation

**1.1 Staff password hashing**
- `controllers/salonStaffController.js` `addStaff`: `bcrypt.hash(password, 10)` before `staffModel.create`.
- `controllers/staffController.js` `handleStaffLogin`: uncomment bcrypt, replace `password === user.password` with `await bcrypt.compare(password, user.password)`.
- `app.js` seeder: hash `'staff123'` before `Staff.create`. (Already imports bcrypt.)
- **Existing plaintext staff rows:** `database.sqlite` is gitignored and auto-seeded on an empty DB. The transition simply requires deleting the local `database.sqlite` once and restarting — the seeder recreates all staff with hashed passwords. (This is safe because the only data in a dev SQLite is the seed data; there is no production DB to preserve.) Documented in SAMPLE_DATA.md and the commit message. We deliberately do **not** write a runtime password-migration function, since any staff added via `addStaff` with a non-seed password would become unloginable on re-hash — deletion + re-seed is the honest, simple path.

**1.2 Schema fixes**
- `models/salonsModel.js`: change `openingTime`/`closingTime` to `STRING` with `'09:00'`/`'20:00'` defaults.
- `models/paymentModel.js`: add `duration` column.
- `app.js` seeder: time values already strings — no change needed.
- Bump `sync` to `alter: true` for the transition.

**1.3 Gate payment simulation bypass**
- The "Simulate Secure Booking (Fast Dev Bypass)" button in `AppointmentBooking` (`App.jsx ~1221`) renders **only when `import.meta.env.DEV`** (Vite's built-in dev flag). In production builds it's stripped at compile time.
- Backend defence: `GET /api/pay/:orderId` already does real Cashfree status polling. The frontend sim button skips the poll by hitting this endpoint directly expecting success — we add a guard: if `process.env.MODE !== 'development'`, the endpoint still polls real status (it already does), so no backend change needed. The frontend is the only gate. Document this clearly.

**1.4 Foundation fields (no UI)**
- `Appointment.status` and `Appointment.rating`, `Salons.requiresApproval` added per §3.2.
- No routes added yet.

### Phase 2 — Status-powered workflow

**2.1 Appointment status endpoints** (new — `controllers/appointmentController.js`)
- `PUT /api/appointment/cancel/:id` — customer cancels own appointment; allowed only if appointment is `confirmed`/`pending` and `date + time - now > 24h`. Sets `cancelled`.
- `PUT /api/appointment/status/:id` — staff/owner changes status; body `{ status: 'confirmed'|'declined'|'completed' }`; auth checks `req.user.staffId` or `req.user.salonId` matches the appointment's salon.
- Reuse existing `PUT /api/appointment/staffreview/:id` for post-service notes (already exists; just exposed in staff UI).

**2.2 Booking creation honors `requiresApproval`**
- `paymentController.getPaymentStatus_` (where appointments are created on payment success): set `status = salon.requiresApproval ? 'pending' : 'confirmed'`.

**2.3 Availability checker excludes `pending`/`declined`/`cancelled`**
- `appointmentController.appointmentChecker`: the "unavailable staff" query's `where` already matches by date/time overlap. Add `status: { [Op.notIn]: ['cancelled', 'declined'] }` so cancelled/declined slots free up. (`pending` bookings still block the slot — another customer shouldn't double-book a pending slot.)

**2.4 Frontend**
- **StaffDashboard** (`App.jsx ~2127`): add action buttons per appointment — Accept / Decline (when `pending`), Mark Complete (when `confirmed` and past start time), Add Note (modal reusing staffreview endpoint). Currently read-only.
- **Customer BookedAppointments** (`App.jsx ~1331`): add Cancel button (disabled if <24h or not cancellable state); show status badge per row.
- **SalonDashboard** appointments tab: show status column + allow owner to change status too (since owner can act on behalf of staff).

### Phase 3 — Customer polish

**3.1 Real ratings**
- `getAllActiveServicesBySalonId` and `buisness/getall` salon-listing endpoints: aggregate `AVG(rating)` and `COUNT(rating)` from joined appointments per salon.
- `App.jsx` `CustomerDashboard`: replace fabricated `(4.5 + salon.id % 6 * 0.1)` with `salon.avgRating` and `salon.reviewCount` (render "No ratings yet" when count is 0).
- Review modal in `BookedAppointments`: add 1–5 star input alongside the existing textarea; send `{ review, rating }`.

**3.2 Rebook**
- `BookedAppointments`: "Book Again" button → `navigate(\`/customer/book/${salonId}/${serviceId}\`)`. No backend change.

**3.3 Favorites**
- New endpoints under `/api/user/favorites`: `GET` (list), `POST` (toggle/add), `DELETE` (remove). All `[auth]` customer-only.
- New `Favorite` model per §3.2.
- `CustomerDashboard`: star icon on each salon card toggles favorite; fetch favorites on mount to show filled stars.
- New section/view on the dashboard: "Your Favorites" filter.

### Phase 4 — Salon owner power tools

**4.1 Analytics** — new endpoint `GET /api/salonsdashboard/analytics` `[auth salon]`:
- Total revenue (sum `orderAmount` from `payments` where `paymentStatus='Success'` for this salon).
- Counts by status (pending/confirmed/completed/cancelled).
- Top 3 services by booking count.
- Bookings per day for last 7 days.
- SalonDashboard: replace placeholder overview tab with KPI cards + a simple bar chart (lightweight inline SVG, no chart library — keeps the bundle small).

**4.2 Calendar view**
- New endpoint `GET /api/salonsdashboard/appointments/calendar?week=YYYY-MM-DD` returns bookings grouped by date+staff.
- SalonDashboard: new "Calendar" tab — 7-column week grid, rows = staff, cells = bookings. Click a booking to see details. Pure CSS grid, no date library.

**4.3 Staff blockouts**
- New endpoints under `/api/salonsdashboard/blockouts` `[auth salon]`: `GET`, `POST`, `DELETE`.
- `StaffBlockout` model per §3.2.
- `appointmentController.appointmentChecker`: exclude staff who have a blockout overlapping the requested date/time.
- SalonDashboard: "Staff" tab gains a "Block out time" action per staff member.

## 5. Data flow

Booking lifecycle (after Phase 2):
```
Customer picks slot → appointmentChecker (excludes blockouts + non-blocking statuses)
  → payment created (Pending) → Cashfree checkout
  → payment success → appointment created
       status = salon.requiresApproval ? 'pending' : 'confirmed'
  → if pending: staff/owner accepts (→ confirmed) or declines (→ declined, slot freed)
  → appointment time passes → staff marks completed
  → customer leaves review + rating (or cancels >24h before)
```

## 6. Error handling

- All new endpoints follow existing pattern: `try/catch`, `res.status(500).json({ message/error })`.
- Status transitions validated server-side (e.g. can't cancel a `completed` appointment; can't decline after `completed`).
- Cancel <24h rule enforced server-side, not just UI.
- Auth checks: each role-scoped endpoint verifies the caller's token (`userId`/`staffId`/`salonId`) owns or is permitted to act on the target appointment.

## 7. Testing

There are currently **no tests** in the repo. Given scope, we will not introduce a full test suite in this feature pass, but we will:
- Add **manual test checkpoints** at the end of each phase in the implementation plan (which credentials/scenarios to verify against the seeded data).
- For the most logic-heavy pieces (status transition rules, cancel-24h rule, availability-checker blockout exclusion), write **small targeted unit tests** with a lightweight runner (built-in `node:test`, no new heavy dependency) once the foundation phase lands.

This is a pragmatic middle ground; a proper test layer is recommended as separate future work.

## 8. Risks & trade-offs

| Risk | Mitigation |
|---|---|
| `sync({ alter: true })` can misbehave on real MySQL if app later returns to MySQL | Document that the `alter:true` is a dev-only SQLite convenience; the canonical schema lives in the model files. Recommend a future migration tool (umzug) before any production MySQL move. |
| Existing seeded staff logins break when we hash passwords | Delete local `database.sqlite` once and restart; seeder recreates staff with hashed passwords. Passwords unchanged from the user's perspective (`staff123`). Documented in SAMPLE_DATA.md + commit message. No runtime migration function — see §4.1.1. |
| `requiresApproval` default `false` means the accept/decline feature is invisible until toggled | Documented; salon owners discover it in their settings tab. |
| 2,400-line `App.jsx` is already at the edge of maintainability and we're adding more | Each new UI piece kept as a focused component; full file-split is called out as recommended future work, not in scope. |
| Brevo email on booking status changes may fail without API key (current state) | Email sends stay fire-and-forget with `try/catch` + console log; never block a status transition on email success. |

## 9. Phasing & verification

Each phase ends with a **runnable, demonstrable** state — no half-features.

- **After Phase 1:** app boots, schema correct, staff logins still work (now hashed), payment sim gone from prod build. No visible feature change.
- **After Phase 2:** customers can cancel; staff dashboard is interactive; approval flow works when toggled.
- **After Phase 3:** salon cards show real ratings; rebook works; favorites persist.
- **After Phase 4:** salon dashboard shows analytics + calendar + blockouts.

Commit cadence: one commit per phase (or per workstream within a phase), not one giant commit. No pushing unless requested.
