# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the foundational bugs and security issues (plaintext staff passwords, schema mismatches, payment-simulation bypass) and add the `status` / `rating` / `requiresApproval` model fields that later phases depend on — without changing any visible behavior.

**Architecture:** Sequelize models are the single source of truth; we change column types and add fields there, then let `sync({ alter: true })` apply them to the local SQLite DB. Staff password hashing moves into the seeder and the `addStaff` controller, and login switches to `bcrypt.compare`. The payment-simulation button is gated at the Vite layer with `import.meta.env.DEV`, which strips it from production builds at compile time.

**Tech Stack:** Express 5, Sequelize 6 over SQLite (`database.sqlite`), bcrypt, Vite + React 19 (`import.meta.env`), `node:test` for unit tests.

**Prerequisite:** This plan is the first of four. Phases 2–4 depend on the model fields added here. Do this plan first.

**Spec reference:** `docs/superpowers/specs/2026-07-18-salon-app-features-design.md` — §4 (Phase 1), §3.2 (model changes), §3.3 (sync strategy).

---

## File Structure

**Modified files (existing):**
- `models/salonsModel.js` — change `openingTime`/`closingTime` from `INTEGER` to `STRING`; add `requiresApproval` boolean.
- `models/appointmentModel.js` — add `status` and `rating` fields.
- `models/paymentModel.js` — add missing `duration` field; remove unused `aws-sdk`/`express` imports.
- `controllers/staffController.js` — switch login to `bcrypt.compare`.
- `controllers/salonStaffController.js` — hash password in `addStaff`.
- `app.js` — hash staff passwords in seeder; bump `sync` to `alter: true`; boot-safe.
- `frontend/src/App.jsx` — wrap the "Simulate Secure Booking" button in `import.meta.env.DEV` guard.
- `SAMPLE_DATA.md` — note the one-time `database.sqlite` deletion.

**New files:**
- `tests/status-rules.test.js` — unit tests for status-transition rules (used by Phase 2, but the pure helper is introduced here to lock the state machine early).
- `utils/statusRules.js` — pure functions encoding which status transitions are legal.

**Not touched in this phase:** routes, other controllers, auth middleware bug (`* 10000` typo), the legacy dead HTML routes. Those are deferred or out of scope per the spec.

---

## Task 1: Fix salon time columns + remove dead imports in Payment model

**Why first:** Schema fix is the lowest-risk change and unblocks honest time handling everywhere. Doing model changes before touching controllers keeps the diff reviewable.

**Files:**
- Modify: `models/salonsModel.js:45-54`
- Modify: `models/paymentModel.js:1-4`

- [ ] **Step 1: Change salon time columns to STRING**

Edit `models/salonsModel.js`. Replace the `openingTime` and `closingTime` field definitions (lines 45–54) with:

```js
    openingTime: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '09:00'
    },
    closingTime: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '20:00'
    },
```

- [ ] **Step 2: Remove dead imports from paymentModel**

Edit `models/paymentModel.js`. Replace lines 1–4:

```js
const Sequelize = require('sequelize');
const sequelize = require('../utils/database');
const { Endpoint } = require('aws-sdk');
const e = require('express');
```

with:

```js
const Sequelize = require('sequelize');
const sequelize = require('../utils/database');
```

(Removes an unused `aws-sdk` import — which would otherwise pull in the entire AWS SDK at model-load time — and an unused `express` alias.)

- [ ] **Step 3: Verify the app still boots**

Run: `npm start`
Expected: server starts on port 3000 with no errors. Sequelize logs (if enabled) show the alter. Stop the server with Ctrl+C after confirming.

- [ ] **Step 4: Commit**

```bash
git add models/salonsModel.js models/paymentModel.js
git commit -m "Fix salon time columns (STRING) and remove dead imports"
```

---

## Task 2: Add missing `duration` column to Payment model

**Files:**
- Modify: `models/paymentModel.js` (add field after `serviceId`)

- [ ] **Step 1: Add the duration field**

Edit `models/paymentModel.js`. Find the `serviceId` field (currently the last field before the closing `});` of the `define` call) and add `duration` after it:

```js
    serviceId: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    duration: {
        type: Sequelize.INTEGER,
        allowNull: true
    },
```

**Note:** `allowNull: true` because legacy payment rows created before this column existed have no value. `paymentController.js:62` already writes this field; today Sequelize/SQLite silently drops it, after this change it persists.

- [ ] **Step 2: Verify boot and that the column appears**

Run: `npm start`
Expected: server starts cleanly. (You can confirm the column exists with `sqlite3 database.sqlite ".schema payments"` if you have sqlite3 installed — look for a `duration` column. If sqlite3 isn't installed, skip this check; the boot-without-error is sufficient.)
Stop the server.

- [ ] **Step 3: Commit**

```bash
git add models/paymentModel.js
git commit -m "Add missing duration column to Payment model"
```

---

## Task 3: Add `status`, `rating` to Appointment; `requiresApproval` to Salons

**Why grouped:** All three are pure additive model changes. Grouping them in one task means one re-seed cycle and one commit.

**Files:**
- Modify: `models/appointmentModel.js` (add two fields)
- Modify: `models/salonsModel.js` (add one field)

- [ ] **Step 1: Add status + rating to Appointment**

Edit `models/appointmentModel.js`. After the existing `userReview` field (around line 47, before the closing `});`), add:

```js
    userReview: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'confirmed',
        validate: {
            isIn: [['pending', 'confirmed', 'declined', 'completed', 'cancelled']]
        }
    },
    rating: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1, max: 5 }
    },
```

(The `defaultValue: 'confirmed'` keeps existing paid bookings — which are created without a status today — behaving exactly as before: booked and paid.)

- [ ] **Step 2: Add requiresApproval to Salons**

Edit `models/salonsModel.js`. After the `closingTime` field (which you changed to STRING in Task 1), add:

```js
    requiresApproval: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
```

- [ ] **Step 3: Verify boot**

Run: `npm start`
Expected: server starts; Sequelize `alter` adds the new columns. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add models/appointmentModel.js models/salonsModel.js
git commit -m "Add Appointment status/rating and Salon requiresApproval fields"
```

---

## Task 4: Introduce status-transition rules as a pure module + unit tests

**Why now:** Phase 2 will rely on these rules from multiple controllers (cancel, accept/decline, complete). Extracting them as pure functions now — before any consumer exists — locks the state machine with tests, so Phase 2 controllers just call `canTransition()`.

**Files:**
- Create: `utils/statusRules.js`
- Create: `tests/statusRules.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/statusRules.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { canTransition, canCancel, CANCEL_WINDOW_HOURS } = require('../utils/statusRules');

test('canTransition: legal transitions return true', () => {
    assert.equal(canTransition('pending', 'confirmed'), true);
    assert.equal(canTransition('pending', 'declined'), true);
    assert.equal(canTransition('confirmed', 'completed'), true);
    assert.equal(canTransition('confirmed', 'cancelled'), true);
    assert.equal(canTransition('pending', 'cancelled'), true);
});

test('canTransition: illegal transitions return false', () => {
    assert.equal(canTransition('completed', 'cancelled'), false);
    assert.equal(canTransition('declined', 'confirmed'), false);
    assert.equal(canTransition('cancelled', 'confirmed'), false);
    assert.equal(canTransition('completed', 'pending'), false);
});

test('canTransition: same-status is false (no-op not allowed)', () => {
    assert.equal(canTransition('confirmed', 'confirmed'), false);
});

test('canCancel: cancellable when >24h before start', () => {
    const future = new Date(Date.now() + (CANCEL_WINDOW_HOURS + 2) * 3600 * 1000);
    assert.equal(canCancel('confirmed', future), true);
    assert.equal(canCancel('pending', future), true);
});

test('canCancel: blocked when within 24h of start', () => {
    const soon = new Date(Date.now() + 2 * 3600 * 1000); // 2h away
    assert.equal(canCancel('confirmed', soon), false);
});

test('canCancel: blocked for non-cancellable statuses', () => {
    const future = new Date(Date.now() + (CANCEL_WINDOW_HOURS + 2) * 3600 * 1000);
    assert.equal(canCancel('completed', future), false);
    assert.equal(canCancel('cancelled', future), false);
    assert.equal(canCancel('declined', future), false);
});

test('canCancel: exactly on the boundary is blocked (not > 24h)', () => {
    const onBoundary = new Date(Date.now() + CANCEL_WINDOW_HOURS * 3600 * 1000);
    assert.equal(canCancel('confirmed', onBoundary), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/statusRules.test.js`
Expected: FAIL — `Cannot find module '../utils/statusRules.js'`

- [ ] **Step 3: Write the implementation**

Create `utils/statusRules.js`:

```js
// Pure status-transition rules for Appointment.status.
// Kept here (not in a controller) so every caller applies the same rules
// and they can be unit-tested without a database.

const CANCEL_WINDOW_HOURS = 24;

// Allowed forward transitions. Anything not listed is illegal.
const ALLOWED_TRANSITIONS = {
    pending:   ['confirmed', 'declined', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    declined:  [],   // terminal
    completed: [],   // terminal
    cancelled: [],   // terminal
};

/**
 * Returns true if an appointment may move from `from` status to `to` status.
 * @param {string} from - current status
 * @param {string} to   - desired status
 */
function canTransition(from, to) {
    if (from === to) return false;
    const allowed = ALLOWED_TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Returns true if a customer may cancel an appointment.
 * Rules: status must be cancellable, AND start must be > CANCEL_WINDOW_HOURS away.
 * @param {string} status    - current appointment status
 * @param {Date}   startAt   - the appointment's start Date (date + time combined)
 */
function canCancel(status, startAt) {
    if (!canTransition(status, 'cancelled')) return false;
    const now = Date.now();
    const msUntilStart = new Date(startAt).getTime() - now;
    return msUntilStart > CANCEL_WINDOW_HOURS * 3600 * 1000;
}

module.exports = {
    CANCEL_WINDOW_HOURS,
    canTransition,
    canCancel,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/statusRules.test.js`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add utils/statusRules.js tests/statusRules.test.js
git commit -m "Add Appointment status-transition rules with unit tests"
```

---

## Task 5: Hash staff passwords in the seeder

**Files:**
- Modify: `app.js` (seeder function, staff-creation block)

- [ ] **Step 1: Replace plaintext staff passwords with hashed ones**

Edit `app.js`. Find the staff-creation block in `seedSampleData()` (the four `Staff.create({... 'staff123' ...})` calls). Replace those four lines so the password is hashed.

First, immediately before the staff-creation block (right after the services block, before `// 4. Create Staff`), add the hash:

```js
    // 4. Create Staff (password: staff123) — hashed with bcrypt
    const hashedStaffPassword = await bcrypt.hash('staff123', 10);
```

Then replace the four `Staff.create` lines so each uses `password: hashedStaffPassword`:

```js
    const staff1 = await Staff.create({ name: 'Dr. Sarah Jenkins', phoneNumber: '9876543101', email: 'sarah@orchid.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon1.id });
    const staff2 = await Staff.create({ name: 'Marcus Aurelius', phoneNumber: '9876543102', email: 'marcus@orchid.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon1.id });
    const staff3 = await Staff.create({ name: 'James Oliver', phoneNumber: '9876543103', email: 'james@aura.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon2.id });
    const staff4 = await Staff.create({ name: 'Tina Miller', phoneNumber: '9876543104', email: 'tina@vibe.com', password: hashedStaffPassword, statusbar: 'active', salonId: salon3.id });
```

(`bcrypt` is already required inside `seedSampleData()` at `app.js:54`, and customer/salon passwords are already hashed there at lines 65 and 80. This step simply extends the same pattern to staff.)

- [ ] **Step 2: Delete the local database so the seeder re-runs**

Run: `rm database.sqlite` (Git Bash on Windows: `rm -f database.sqlite` works; in CMD it'd be `del database.sqlite`.)
Why: the seeder only runs when the DB is empty. Existing plaintext staff rows would otherwise remain. The DB is gitignored seed data — safe to recreate.

- [ ] **Step 3: Boot and confirm seeding**

Run: `npm start`
Expected: console shows `🌱 Database is empty. Seeding premium sample data...` then `✅ Premium seed data loaded successfully!`. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Hash staff passwords in seeder (bcrypt)"
```

---

## Task 6: Switch staff login to bcrypt.compare

**Files:**
- Modify: `controllers/staffController.js:9-38` (`handleStaffLogin`)

- [ ] **Step 1: Replace plaintext compare with bcrypt.compare**

Edit `controllers/staffController.js`. In `handleStaffLogin`, replace lines 19–24 (the commented-out bcrypt + the plaintext compare):

```js
        // const isMatch = await bcrypt.compare(password, user.password);
        const isMatch = password === user.password
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect password" });
        }
```

with:

```js
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Incorrect password" });
        }
```

(`bcrypt` is already imported at the top of the file: `const bcrypt = require('bcrypt');` on line 3.)

- [ ] **Step 2: Manually verify staff login still works**

Boot the server (`npm start`), then in another terminal run:

```bash
curl -s -X POST http://localhost:3000/api/staff/login -H "Content-Type: application/json" -d '{"email":"sarah@orchid.com","password":"staff123"}'
```

Expected: a 200 response containing a `token` and `staffId`. (Not a 401.)
If you get 401: the seeder didn't re-run — confirm `database.sqlite` was deleted in Task 5 Step 2 and the server re-seeded.
Stop the server.

- [ ] **Step 3: Commit**

```bash
git add controllers/staffController.js
git commit -m "Use bcrypt.compare for staff login"
```

---

## Task 7: Hash staff passwords in addStaff controller

**Files:**
- Modify: `controllers/salonStaffController.js:1-30` (`addStaff`)

- [ ] **Step 1: Add bcrypt import + hash in addStaff**

Edit `controllers/salonStaffController.js`. Add the bcrypt import at the top (after the existing requires, before `const addStaff`):

```js
const bcrypt = require('bcrypt');
```

Then in `addStaff`, replace the `staffModel.create({...})` call (lines 17–23) so the password is hashed before insert. Replace:

```js
        // Create the staff member
        const staff = await staffModel.create({
            name,
            phoneNumber,
            email,
            password,
            salonId,
        });
```

with:

```js
        // Create the staff member (password hashed with bcrypt)
        const hashedPassword = await bcrypt.hash(password, 10);
        const staff = await staffModel.create({
            name,
            phoneNumber,
            email,
            password: hashedPassword,
            salonId,
        });
```

- [ ] **Step 2: Manually verify end-to-end staff creation + login**

This needs a salon-owner JWT. Boot the server, log in as a salon owner:

```bash
curl -s -X POST http://localhost:3000/api/buisness/login -H "Content-Type: application/json" -d '{"email":"owner@orchid.com","password":"salon123"}'
```

Copy the `token` from the response, then create a staff member:

```bash
curl -s -X POST http://localhost:3000/api/salonsdashboard/staff/add -H "Content-Type: application/json" -H "Authorization: Bearer <SALON_TOKEN>" -d '{"name":"Test Stylist","phoneNumber":"9999999999","email":"test@orchid.com","password":"testpass123"}'
```

Expected: 201 with `Staff member added successfully`.

Now log in as that new staff member:

```bash
curl -s -X POST http://localhost:3000/api/staff/login -H "Content-Type: application/json" -d '{"email":"test@orchid.com","password":"testpass123"}'
```

Expected: 200 with a token. (This proves the password was hashed on write and correctly compared on login.)
Stop the server.

- [ ] **Step 3: Commit**

```bash
git add controllers/salonStaffController.js
git commit -m "Hash staff passwords on creation in addStaff"
```

---

## Task 8: Gate payment-simulation button behind dev mode

**Files:**
- Modify: `frontend/src/App.jsx` (the "Simulate Secure Booking" button block, ~lines 1220–1250)

- [ ] **Step 1: Wrap the sim button in a dev-mode guard**

Edit `frontend/src/App.jsx`. Find the "Fail-safe Simulator button" block — a `<button>` with text `Simulate Secure Booking (Fast Dev Bypass)`. Wrap the entire `<button>...</button>` element in a conditional render:

```jsx
            {import.meta.env.DEV && (
              <button
                onClick={async () => {
                  if (!selectedStaffId) return showToast('Please select staff', 'error');
                  setBookingLoading(true);
                  try {
                    const paymentPayload = {
                      servicePrice: service.price,
                      dateSelect: selectedDate,
                      time: selectedTime,
                      staffId: parseInt(selectedStaffId),
                      serviceId: parseInt(serviceId),
                      salonId: parseInt(salonId),
                      duration: service.duration
                    };
                    const res = await axios.post('/api/pay/', paymentPayload);
                    const { orderId } = res.data;
                    await axios.get(`/api/pay/${orderId}`);
                    showToast("Local simulator payment success!", "success");
                    navigate('/customer/bookings');
                  } catch (simErr) {
                    showToast("Local simulator booking error", "error");
                  } finally {
                    setBookingLoading(false);
                  }
                }}
                className="btn btn-secondary btn-sm"
                style={{ width: '100%', marginTop: '8px', fontSize: '12px', borderStyle: 'dashed' }}
              >
                Simulate Secure Booking (Fast Dev Bypass)
              </button>
            )}
```

(Keep the button's existing `onClick` body exactly as-is — only wrap it in `{import.meta.env.DEV && (...)}`.)

`import.meta.env.DEV` is Vite's built-in flag: `true` in `vite` dev server, `false` in `vite build` output. Tree-shaking strips the entire block from production bundles.

- [ ] **Step 2: Verify it appears in dev, disappears in prod build**

First, build the frontend so the change lands in `frontend/dist`:

```bash
cd frontend && npm run build && cd ..
```

Expected: build succeeds, `frontend/dist/index.html` updated.

To confirm the sim button is stripped from the prod bundle, search the built JS for its unique label:

```bash
grep -l "Simulate Secure Booking" frontend/dist/assets/*.js || echo "Not found in prod bundle (correct!)"
```

Expected output: `Not found in prod bundle (correct!)`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "Gate payment-simulation button to dev mode only (import.meta.env.DEV)"
```

---

## Task 9: Update SAMPLE_DATA.md with the re-seed note

**Files:**
- Modify: `SAMPLE_DATA.md`

- [ ] **Step 1: Add a setup note at the top**

Edit `SAMPLE_DATA.md`. Immediately after the first heading (`# Fresha Salon App: Sample Data & Credentials`), insert a setup note:

```markdown
> **Setup note:** Sample data is auto-seeded into a local `database.sqlite` file on first boot. If the database already exists from an older version of the app (e.g. before staff password hashing), delete `database.sqlite` once and restart the server (`npm start`) to re-seed. Staff passwords are now stored hashed; the documented login passwords (`staff123`) are unchanged.
```

- [ ] **Step 2: Commit**

```bash
git add SAMPLE_DATA.md
git commit -m "Document database re-seed step in SAMPLE_DATA.md"
```

---

## Task 10: End-of-phase manual verification

**Goal:** Confirm the app still works end-to-end after all foundation changes, and that nothing visible regressed.

- [ ] **Step 1: Boot the app fresh**

```bash
rm -f database.sqlite
npm start
```

Expected: server starts, seeder runs, `✅ Premium seed data loaded successfully!`.

- [ ] **Step 2: Build the frontend**

In a second terminal:
```bash
cd frontend && npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Open http://localhost:3000 and verify each login works**

Open the app in a browser. For each portal, log in with the SAMPLE_DATA credentials:
- Customer: `jane@example.com` / `customer123` → dashboard loads, salons visible
- Salon: `owner@orchid.com` / `salon123` → business console loads
- Staff: `sarah@orchid.com` / `staff123` → staff dashboard loads

All three should succeed. If staff fails with 401, the seeder didn't re-run — confirm Task 5 Step 2 (the `database.sqlite` deletion) happened and the server re-seeded.

**Admin login is out of scope for Phase 1 verification** — admin auth reads from `ADMIN_USER` / `ADMIN_PASS` env vars (`controllers/adminController.js:16-17`) which are not set in `.env.example`, so admin login doesn't work out-of-the-box today. That's a pre-existing condition unrelated to this phase's changes; leave it alone here.

- [ ] **Step 4: Verify the payment sim button is hidden in the served build**

While on the customer booking flow (`/customer/book/:salonId/:serviceId` after picking a service), confirm the "Simulate Secure Booking" button is **not visible** (because `frontend/dist` is a production build). In dev (`cd frontend && npm run dev`, port 5173) it would appear — but you don't need to start the dev server, just confirm its absence in the prod-served UI.

- [ ] **Step 5: Run the status-rules unit tests one more time**

```bash
node --test tests/statusRules.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 6: No commit needed** — this is a verification step. If anything failed, fix it before moving to Phase 2.

---

## After Phase 1

The app looks identical to a user but is now on a correct schema, has hashed staff passwords, no payment-sim in production, and the `status` / `rating` / `requiresApproval` fields exist for Phase 2 to use. The `canTransition` / `canCancel` helpers are tested and ready.

Next: Phase 2 plan (status-powered workflow: cancel, accept/decline, complete, post-service notes).
