# Phase 4: Salon Owner Power Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give salon owners real management tooling: (1) a revenue & booking analytics endpoint powering KPI cards + a simple bar chart, (2) a week-grid calendar view of bookings per staff member, and (3) staff blockouts (owner marks staff unavailable for specific date/time ranges) that flow into the availability checker so blocked staff don't appear bookable.

**Architecture:** New backend endpoints live in a new `salonAnalyticsController.js` (analytics + calendar) and extend `salonStaffController.js` (blockouts). A new `StaffBlockout` model (staffId + date + startTime + endTime + reason) is wired into `appointmentController.appointmentChecker` so blocked staff are excluded. Frontend adds two new SalonDashboard tabs (Analytics, Calendar), a blockout modal in the existing Staff tab, and a new sidebar entry. No new dependencies — the "chart" is a lightweight inline SVG bar chart (keeps bundle small).

**Tech Stack:** Express 5, Sequelize 6 over SQLite, React 19 + Vite. No new dependencies.

**Prerequisite:** Phases 1–3 complete. Uses the `status` field (Phase 1/2) for status-breakdown analytics and the availability checker (Phase 2 modified it).

**Spec reference:** `docs/superpowers/specs/2026-07-18-salon-app-features-design.md` — §4.4 (Phase 4).

---

## File Structure

**New files:**
- `models/staffBlockoutModel.js` — `StaffBlockout` (id, staffId, date, startTime, endTime, reason).
- `controllers/salonAnalyticsController.js` — `getAnalytics`, `getCalendar`.
- `routes/salonAnalyticsRoutes.js` — mounts analytics + calendar under `/api/salonsdashboard`.
- `tests/blockout-availability.test.js` — integration test proving blockouts exclude staff from availability.

**Modified — backend:**
- `models/associations.js` — wire StaffBlockout (Staff hasMany, Salons hasMany through staff, StaffBlockout belongsTo Staff).
- `controllers/appointmentController.js` — `appointmentChecker` excludes staff with overlapping blockouts.
- `controllers/salonStaffController.js` — add `addBlockout`, `getBlockouts`, `removeBlockout`.
- `routes/salonsDashboardRoutes.js` — mount blockout routes + analytics routes; remove the dead legacy HTML GETs (they're unused by the SPA).

**Modified — frontend (`frontend/src/App.jsx`):**
- `SalonDashboard` — replace the fake `totalRevenue` and placeholder overview with a real Analytics tab (KPI cards + SVG bar chart); add a Calendar tab (week grid); add a blockout modal to the Staff tab; add sidebar entries.

**Not touched:** payment, auth, customer/staff/admin flows (other than the availability-checker change which is customer-facing but transparent).

---

## Task 1: Backend — StaffBlockout model + associations

**Files:**
- Create: `models/staffBlockoutModel.js`
- Modify: `models/associations.js`

- [ ] **Step 1: Create the StaffBlockout model**

Create `models/staffBlockoutModel.js`:

```js
const Sequelize = require('sequelize');
const sequelize = require('../utils/database');

const StaffBlockout = sequelize.define('staffBlockout', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    staffId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'staff', key: 'id' },
        onDelete: 'CASCADE',
    },
    date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
    },
    startTime: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    endTime: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    reason: {
        type: Sequelize.STRING,
        allowNull: true,
    },
}, { timestamps: true });

module.exports = StaffBlockout;
```

(`startTime`/`endTime` are STRING `'HH:mm'` to match how the rest of the app stores times as strings, avoiding SQLite TIME-column quirks.)

- [ ] **Step 2: Wire associations**

Edit `models/associations.js`. Add the require with the other model requires (after the `Favorite` require):

```js
const StaffBlockout = require('./staffBlockoutModel');
```

Before `module.exports`, add:

```js
// ==================== STAFF BLOCKOUTS ====================
Staff.hasMany(StaffBlockout, { foreignKey: 'staffId', onDelete: 'CASCADE' });
StaffBlockout.belongsTo(Staff, { foreignKey: 'staffId', as: 'staff' });
```

Add `StaffBlockout` to the `module.exports` object:

```js
module.exports = { Salons, Staff, Services, StaffServices, Appointment, User, Payment, Favorite, StaffBlockout };
```

- [ ] **Step 3: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts, DB synced (new `staffBlockouts` table created).

- [ ] **Step 4: Commit**

```bash
git add models/staffBlockoutModel.js models/associations.js
git commit -m "Add StaffBlockout model and wire associations"
```

---

## Task 2: Backend — blockout endpoints

**Files:**
- Modify: `controllers/salonStaffController.js` (add 3 controllers)
- Modify: `routes/salonsDashboardRoutes.js` (mount routes)

- [ ] **Step 1: Add the three blockout controllers**

Edit `controllers/salonStaffController.js`. Add the model require at the top (after the existing requires):

```js
const StaffBlockout = require('../models/staffBlockoutModel');
```

At the end of the file (before `module.exports`), add three controllers:

```js
// Salon owner adds a blockout (staff unavailable for a date + time range).
const addBlockout = async (req, res) => {
    try {
        const { staffId, date, startTime, endTime, reason } = req.body;
        const salonId = req.user.salonId;

        if (!staffId || !date || !startTime || !endTime) {
            return res.status(400).json({ message: 'staffId, date, startTime, endTime are required' });
        }

        const staff = await staffModel.findByPk(staffId);
        if (!staff) {
            return res.status(404).json({ message: 'Staff not found' });
        }
        if (staff.salonId !== salonId) {
            return res.status(403).json({ message: 'Not authorized: staff belongs to another salon' });
        }

        const blockout = await StaffBlockout.create({ staffId, date, startTime, endTime, reason: reason || null });
        return res.status(201).json({ message: 'Blockout added successfully', blockout });
    } catch (error) {
        console.error('Error adding blockout:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// List blockouts for the salon owner's salon (optionally filtered by staffId).
const getBlockouts = async (req, res) => {
    try {
        const salonId = req.user.salonId;
        const { staffId } = req.query;

        const staffMembers = await staffModel.findAll({
            where: { salonId },
            attributes: ['id'],
        });
        const staffIds = staffMembers.map(s => s.id);
        if (staffIds.length === 0) return res.status(200).json([]);

        const where = { staffId: staffIds };
        if (staffId) where.staffId = parseInt(staffId, 10);

        const blockouts = await StaffBlockout.findAll({
            where,
            include: [{ model: staffModel, as: 'staff', attributes: ['id', 'name'] }],
            order: [['date', 'ASC'], ['startTime', 'ASC']],
        });
        return res.status(200).json(blockouts);
    } catch (error) {
        console.error('Error fetching blockouts:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Remove a blockout by id (owner only — must belong to a staff in their salon).
const removeBlockout = async (req, res) => {
    try {
        const { id } = req.params;
        const salonId = req.user.salonId;

        const blockout = await StaffBlockout.findByPk(id, {
            include: [{ model: staffModel, as: 'staff' }],
        });
        if (!blockout) {
            return res.status(404).json({ message: 'Blockout not found' });
        }
        if (!blockout.staff || blockout.staff.salonId !== salonId) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        await blockout.destroy();
        return res.status(200).json({ message: 'Blockout removed successfully' });
    } catch (error) {
        console.error('Error removing blockout:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
```

- [ ] **Step 2: Export the new controllers**

Update `module.exports` in `controllers/salonStaffController.js`:

```js
module.exports = {
    addStaff,
    getStaff,
    getStaffById,
    assignServices,
    updateStatus,
    addBlockout,
    getBlockouts,
    removeBlockout,
};
```

- [ ] **Step 3: Mount the routes**

Edit `routes/salonsDashboardRoutes.js`. At the top, the file requires `salonServices`, `authMiddleware`, `salonStaff`. Add the routes after the existing `router.put('/staff/updateStatus', ...)` line:

```js
router.post('/staff/blockouts', authMiddleware, salonStaff.addBlockout);
router.get('/staff/blockouts', authMiddleware, salonStaff.getBlockouts);
router.delete('/staff/blockouts/:id', authMiddleware, salonStaff.removeBlockout);
```

- [ ] **Step 4: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts cleanly.

- [ ] **Step 5: Commit**

```bash
git add controllers/salonStaffController.js routes/salonsDashboardRoutes.js
git commit -m "Add staff blockout endpoints (add/list/remove)"
```

---

## Task 3: Backend — availability checker excludes blocked staff

**Files:**
- Modify: `controllers/appointmentController.js` — `appointmentChecker`

- [ ] **Step 1: Require the model and exclude blocked staff**

Edit `controllers/appointmentController.js`. At the top, add the require (alongside the other model requires):

```js
const StaffBlockout = require('../models/staffBlockoutModel');
```

In `appointmentChecker`, after the existing Step 1 query that finds `staffForService` (the staff who can perform the service for this salon) and BEFORE the "Step 2: Check for staff availability" query, add a block to exclude staff with overlapping blockouts:

```js
        // Step 1.5: Exclude staff who have a blockout overlapping the requested slot.
        const blockedStaff = await StaffBlockout.findAll({
            where: {
                staffId: staffIds,
                date: dateSelect,
                startTime: { [Op.lt]: endTime },
                endTime: { [Op.gt]: startTime },
            },
            attributes: ['staffId'],
        });
        const blockedStaffIds = blockedStaff.map(b => b.staffId);
        const availableStaffAfterBlocks = staffForService.filter(
            (staff) => !blockedStaffIds.includes(staff.id)
        );
```

(Insert this between the `staffForService` query and the existing "unavailable staff" query. `staffIds` is the array derived from `staffForService` — make sure this runs AFTER `const staffIds = staffForService.map((staff) => staff.id);`.)

Then change the final filter to use `availableStaffAfterBlocks` instead of `staffForService`:

```js
        // Step 3: Filter out unavailable staff
        const unavailableStaffIds = unavailableStaff.map((appointment) => appointment.staffId);
        const freeStaff = availableStaffAfterBlocks.filter(
            (staff) => !unavailableStaffIds.includes(staff.id)
        );
```

(The existing `freeStaff` filter used `staffForService`. Changing it to `availableStaffAfterBlocks` means blocked staff are also excluded from the result. The overlap logic `startTime < endTime AND endTime > startTime` matches the appointment-overlap logic already in the file.)

- [ ] **Step 2: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts cleanly.

- [ ] **Step 3: Commit**

```bash
git add controllers/appointmentController.js
git commit -m "Exclude staff with overlapping blockouts from availability checker"
```

---

## Task 4: Integration test for blockout → availability exclusion

**Files:**
- Create: `tests/blockout-availability.test.js`

- [ ] **Step 1: Write the integration test**

Create `tests/blockout-availability.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const StaffBlockout = require('../models/staffBlockoutModel');

// Mock req/res for invoking appointmentChecker directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let salon, staff1, staff2, service;

before(async () => {
    await sequelize.sync({ force: true });
    salon = await Salons.create({ name: 'S', email: 's@b.com', password: 'x', phoneNumber: '1', address: 'a', pricing: 'Moderate' });
    staff1 = await Staff.create({ name: 'A', email: 'a@b.com', password: 'x', phoneNumber: '2', salonId: salon.id });
    staff2 = await Staff.create({ name: 'B', email: 'b@b.com', password: 'x', phoneNumber: '3', salonId: salon.id });
    service = await Services.create({ name: 'Cut', price: 100, duration: 30, salonId: salon.id });
    await staff1.setServices([service]);
    await staff2.setServices([service]);
});

after(async () => { await sequelize.close(); });

test('both staff available when no blockouts', async () => {
    const { appointmentChecker } = require('../controllers/appointmentController');
    const req = {
        body: { dateSelect: '2026-08-01', time: '10:00', salonId: salon.id, serviceId: service.id, duration: 30 }
    };
    const res = mockRes();
    await appointmentChecker(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 2);
});

test('staff with overlapping blockout excluded', async () => {
    // Blockout staff1 from 09:00-12:00 on 2026-08-01; requested slot 10:00-10:30 overlaps.
    await StaffBlockout.create({ staffId: staff1.id, date: '2026-08-01', startTime: '09:00', endTime: '12:00', reason: 'Leave' });

    const { appointmentChecker } = require('../controllers/appointmentController');
    const req = {
        body: { dateSelect: '2026-08-01', time: '10:00', salonId: salon.id, serviceId: service.id, duration: 30 }
    };
    const res = mockRes();
    await appointmentChecker(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, staff2.id);
});

test('non-overlapping blockout does not exclude staff', async () => {
    // Blockout staff2 from 14:00-18:00 on 2026-08-02; requested slot 10:00-10:30 does NOT overlap.
    await StaffBlockout.create({ staffId: staff2.id, date: '2026-08-02', startTime: '14:00', endTime: '18:00', reason: 'Afternoon off' });

    const { appointmentChecker } = require('../controllers/appointmentController');
    const req = {
        body: { dateSelect: '2026-08-02', time: '10:00', salonId: salon.id, serviceId: service.id, duration: 30 }
    };
    const res = mockRes();
    await appointmentChecker(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 2);
});
```

- [ ] **Step 2: Run the test**

```bash
node --test tests/blockout-availability.test.js
```
Expected: all 3 tests pass. If a test fails, the test is correct — fix the controller (Task 3), not the test. Report DONE_WITH_CONCERNS with output.

- [ ] **Step 3: Commit**

```bash
git add tests/blockout-availability.test.js
git commit -m "Add integration test: blockouts exclude staff from availability"
```

---

## Task 5: Backend — analytics + calendar endpoints

**Files:**
- Create: `controllers/salonAnalyticsController.js`
- Create: `routes/salonAnalyticsRoutes.js`
- Modify: `routes/apiRoutes.js`

- [ ] **Step 1: Create the analytics controller**

Create `controllers/salonAnalyticsController.js`:

```js
const appointmentModel = require('../models/appointmentModel');
const paymentModel = require('../models/paymentModel');
const servicesModel = require('../models/servicesModel');
const staffModel = require('../models/staffModel');
const { Op, fn, col, literal } = require('sequelize');

// GET /api/salonsdashboard/analytics — KPI summary for the salon owner's dashboard.
// Returns: totalRevenue, statusCounts, topServices (top 3), bookingsPerDay (last 7 days).
const getAnalytics = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        // Total revenue from successful payments for this salon.
        const revenueRow = await paymentModel.findOne({
            where: { salonId, paymentStatus: 'Success' },
            attributes: [[fn('SUM', col('orderAmount')), 'total']],
            raw: true,
        });
        const totalRevenue = revenueRow && revenueRow.total ? parseFloat(revenueRow.total) : 0;

        // Appointment counts grouped by status.
        const statusRows = await appointmentModel.findAll({
            where: { salonId },
            attributes: ['status', [fn('COUNT', col('*')), 'count']],
            group: ['status'],
            raw: true,
        });
        const statusCounts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0, declined: 0 };
        statusRows.forEach(r => { statusCounts[r.status] = parseInt(r.count, 10); });

        // Top 3 services by booking count.
        const topServiceRows = await appointmentModel.findAll({
            where: { salonId },
            attributes: ['serviceId', [fn('COUNT', col('serviceId')), 'count']],
            include: [{ model: servicesModel, as: 'service', attributes: ['name'] }],
            group: ['serviceId'],
            order: [[literal('count'), 'DESC']],
            limit: 3,
            raw: true,
        });
        const topServices = topServiceRows.map(r => ({ name: r['service.name'], count: parseInt(r.count, 10) }));

        // Bookings per day for the last 7 days (including today).
        const today = new Date();
        const sevenAgo = new Date(today.getTime() - 6 * 24 * 3600 * 1000);
        const fromDate = sevenAgo.toISOString().slice(0, 10);
        const dayRows = await appointmentModel.findAll({
            where: { salonId, date: { [Op.gte]: fromDate } },
            attributes: ['date', [fn('COUNT', col('*')), 'count']],
            group: ['date'],
            order: [['date', 'ASC']],
            raw: true,
        });
        // Fill in zero-count days for a continuous 7-day series.
        const bookingsPerDay = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today.getTime() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
            const found = dayRows.find(r => r.date === d);
            bookingsPerDay.push({ date: d, count: found ? parseInt(found.count, 10) : 0 });
        }

        res.status(200).json({ totalRevenue, statusCounts, topServices, bookingsPerDay });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/salonsdashboard/calendar?week=YYYY-MM-DD — bookings for the 7-day week containing the given date,
// grouped by date and staff. Returns [{ date, staffId, staffName, appointments: [{id, time, endTime, customerName, serviceName, status}] }]
const getCalendar = async (req, res) => {
    const salonId = req.user.salonId;
    try {
        const weekStart = req.query.week
            ? new Date(req.query.week)
            : new Date();
        if (Number.isNaN(weekStart.getTime())) {
            return res.status(400).json({ message: 'Invalid week date' });
        }
        // Normalize to the Monday of that week.
        const dayOfWeek = (weekStart.getDay() + 6) % 7; // Mon=0 ... Sun=6
        const monday = new Date(weekStart);
        monday.setDate(weekStart.getDate() - dayOfWeek);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const fromStr = monday.toISOString().slice(0, 10);
        const toStr = sunday.toISOString().slice(0, 10);

        const appointments = await appointmentModel.findAll({
            where: { salonId, date: { [Op.between]: [fromStr, toStr] } },
            include: [
                { model: staffModel, as: 'staff', attributes: ['id', 'name'] },
                { model: servicesModel, as: 'service', attributes: ['name'] },
                { model: require('../models/userModel'), as: 'user', attributes: ['name'] },
            ],
            order: [['date', 'ASC'], ['time', 'ASC']],
        });

        res.status(200).json(appointments);
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getAnalytics, getCalendar };
```

- [ ] **Step 2: Create the analytics routes**

Create `routes/salonAnalyticsRoutes.js`:

```js
const router = require('express').Router();
const authMiddleware = require('../middlewares/authMiddleware');
const salonAnalyticsController = require('../controllers/salonAnalyticsController');

router.get('/analytics', authMiddleware, salonAnalyticsController.getAnalytics);
router.get('/calendar', authMiddleware, salonAnalyticsController.getCalendar);

module.exports = router;
```

- [ ] **Step 3: Mount the analytics routes**

Edit `routes/apiRoutes.js`. The Phase 3 work added `favoriteRoutes`. Add the require after `favoriteRoutes`:

```js
const salonAnalyticsRoutes = require('./salonAnalyticsRoutes');
```

And mount it alongside the existing `/salonsdashboard` mount:

```js
router.use('/salonsdashboard', salonAnalyticsRoutes);
```

(Place this right after the existing `router.use('/salonsdashboard', businessDashboardRoutes);` line. Both routers handle `/salonsdashboard` — Express tries them in order, so it's fine.)

- [ ] **Step 4: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts cleanly.

- [ ] **Step 5: Commit**

```bash
git add controllers/salonAnalyticsController.js routes/salonAnalyticsRoutes.js routes/apiRoutes.js
git commit -m "Add salon analytics + calendar endpoints"
```

---

## Task 6: Frontend — Analytics tab (KPIs + bar chart) replacing the fake overview

**Files:**
- Modify: `frontend/src/App.jsx` — `SalonDashboard`

- [ ] **Step 1: Add analytics state + fetch**

In `SalonDashboard`, add state alongside the existing dashboard state (near the other state declarations):

```jsx
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
```

Add a fetch function near the other fetch functions (e.g. after `fetchAppointments`):

```jsx
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const res = await axios.get('/api/salonsdashboard/analytics');
      setAnalytics(res.data);
    } catch (err) {
      console.error('Error fetching analytics', err);
    } finally {
      setAnalyticsLoading(false);
    }
  };
```

In the existing top-level `useEffect(() => { fetchSalonProfile(); fetchServices(); fetchStaff(); fetchAppointments(); }, [])`, add `fetchAnalytics()`:

```jsx
  useEffect(() => {
    fetchSalonProfile();
    fetchServices();
    fetchStaff();
    fetchAppointments();
    fetchAnalytics();
  }, []);
```

- [ ] **Step 2: Replace the overview tab content with analytics-driven KPIs + bar chart**

Find the `{activeTab === 'dashboard' && (...)}` block (the overview tab, around line 1855). It currently has a `stats-grid` with placeholder KPIs using `totalRevenue` (which is a fake client-side sum) and an "Upcoming Client Bookings" preview table.

Replace the ENTIRE `{activeTab === 'dashboard' && (...)}` block with:

```jsx
        {activeTab === 'dashboard' && (
          <>
            <div className="dashboard-header">
              <h2 className="dashboard-title">Console Dashboard</h2>
              <span className="badge badge-info">Partner Status: Active</span>
            </div>

            {analyticsLoading && !analytics ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading analytics...</div>
            ) : analytics ? (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon success"><CreditCard size={24} /></div>
                    <div>
                      <div className="stat-value">₹{Number(analytics.totalRevenue || 0).toLocaleString()}</div>
                      <div className="stat-label">Total Revenue (paid)</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon primary"><Calendar size={24} /></div>
                    <div>
                      <div className="stat-value">{Object.values(analytics.statusCounts).reduce((a, b) => a + b, 0)}</div>
                      <div className="stat-label">Total Bookings</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon accent"><CheckCircle size={24} /></div>
                    <div>
                      <div className="stat-value">{analytics.statusCounts.completed || 0}</div>
                      <div className="stat-label">Completed</div>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon warning"><Clock size={24} /></div>
                    <div>
                      <div className="stat-value">{(analytics.statusCounts.pending || 0) + (analytics.statusCounts.confirmed || 0)}</div>
                      <div className="stat-label">Upcoming</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginTop: '24px' }}>
                  {/* Bar chart: bookings per day, last 7 days */}
                  <div className="booking-panel">
                    <h3 className="panel-title">Bookings — Last 7 Days</h3>
                    {(() => {
                      const data = analytics.bookingsPerDay || [];
                      const max = Math.max(1, ...data.map(d => d.count));
                      return (
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '160px', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                          {data.map((d, i) => (
                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{d.count}</div>
                              <div style={{
                                width: '100%', maxWidth: '48px',
                                height: `${(d.count / max) * 120}px`,
                                minHeight: d.count > 0 ? '8px' : '2px',
                                background: d.count > 0 ? 'var(--primary)' : 'var(--border-color)',
                                borderRadius: '6px 6px 0 0',
                                transition: 'height 0.3s ease',
                              }} />
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Top services */}
                  <div className="booking-panel">
                    <h3 className="panel-title">Top Services</h3>
                    {(analytics.topServices || []).length === 0 ? (
                      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>No bookings yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
                        {(analytics.topServices || []).map((s, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge badge-info">{i + 1}</span>
                              <strong>{s.name}</strong>
                            </span>
                            <span style={{ color: 'var(--text-secondary)' }}>{s.count} booking{s.count === 1 ? '' : 's'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="booking-panel" style={{ marginTop: '24px' }}>
                  <h3 className="panel-title">Upcoming Client Bookings</h3>
                  {appointments.filter(a => a.status === 'confirmed' || a.status === 'pending').length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No upcoming bookings.</div>
                  ) : (
                    <div className="table-container">
                      <table className="premium-table">
                        <thead>
                          <tr>
                            <th>Customer</th>
                            <th>Service</th>
                            <th>Assigned Staff</th>
                            <th>Date / Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {appointments
                            .filter(a => a.status === 'confirmed' || a.status === 'pending')
                            .slice(0, 5)
                            .map(appt => (
                              <tr key={appt.id}>
                                <td>
                                  <strong>{appt.user?.name}</strong>
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{appt.user?.phoneNumber}</div>
                                </td>
                                <td>{appt.service?.name}</td>
                                <td>{appt.staff?.name}</td>
                                <td>{appt.date} @ {appt.time}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Unable to load analytics.</div>
            )}
          </>
        )}
```

- [ ] **Step 3: Remove the now-unused `totalRevenue` calculation**

The `totalRevenue` calculation (around line 1812, `const totalRevenue = appointments.filter(...).reduce(...)`) is no longer referenced (the new overview uses `analytics.totalRevenue` instead). Remove it:

```js
// Delete this block entirely:
  const totalRevenue = appointments
    .filter(appt => appt.service?.price)
    .reduce((acc, appt) => acc + parseFloat(appt.service.price), 0);
```

- [ ] **Step 4: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Salon dashboard: real analytics tab with KPIs + 7-day bar chart"
```

## Context

Phase 4 Task 6. The current overview uses a client-side sum of `service.price` for "revenue" — that's wrong (it ignores actual payments and counts cancelled/declined appointments). The new tab pulls real data from the analytics endpoint: paid revenue from successful `payments`, status breakdowns from `appointments`, top services from booking counts, and a 7-day trend. The bar chart is pure inline CSS/divs — no chart library, keeping the bundle small.

Personal project on `main` — commit to main, do NOT push.

**IMPORTANT discipline note:** Modify ONLY `frontend/src/App.jsx`, and within it ONLY `SalonDashboard` (state, fetch, useEffect, the overview-tab block, and removing `totalRevenue`). Do not touch any other component. If you hit an environment issue, STOP and report. Unauthorized out-of-scope edits will be reverted.

## Before You Begin

Ask if anything unclear. Otherwise proceed.

## Your Job

1. Make the edits (Steps 1-3) inside SalonDashboard only.
2. Build (Step 4) — confirm no compile errors.
3. Commit (Step 4).
4. Self-review: `git diff HEAD~1 -- frontend/src/App.jsx` should show changes only within SalonDashboard. Confirm `totalRevenue` is removed. Confirm the new analytics fetch + tab are present. Commit message exact.
5. Report back.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Build output summary
- Files changed + commit SHA + `git diff HEAD~1 --stat`
- Self-review findings (confirm scope, confirm totalRevenue removed)
- Any concerns

---

## Task 7: Frontend — Calendar tab (week grid of bookings per staff)

**Files:**
- Modify: `frontend/src/App.jsx` — `SalonDashboard`

- [ ] **Step 1: Add calendar state + fetch + week navigation**

In `SalonDashboard`, add state:

```jsx
  const [calendarWeek, setCalendarWeek] = useState(new Date().toISOString().slice(0, 10));
  const [calendarAppointments, setCalendarAppointments] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
```

Add a fetch function:

```jsx
  const fetchCalendar = async (weekDate) => {
    setCalendarLoading(true);
    try {
      const res = await axios.get(`/api/salonsdashboard/calendar?week=${weekDate}`);
      setCalendarAppointments(res.data);
    } catch (err) {
      console.error('Error fetching calendar', err);
    } finally {
      setCalendarLoading(false);
    }
  };
```

- [ ] **Step 2: Add sidebar entry for the Calendar tab**

Find the sidebar nav (around line 1830, the `<nav className="sidebar-nav">` block). Add a Calendar button alongside the existing tabs (after the Schedules/appointments button):

```jsx
          <button onClick={() => { setActiveTab('calendar'); fetchCalendar(calendarWeek); }} className={`btn sidebar-nav-item ${activeTab === 'calendar' ? 'active' : ''}`} style={{ justifyContent: 'flex-start' }}>
            <Calendar size={18} /> Calendar
          </button>
```

- [ ] **Step 3: Add the Calendar tab content**

After the appointments tab block (`{activeTab === 'appointments' && (...)}`), add the calendar tab:

```jsx
        {activeTab === 'calendar' && (
          <>
            <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="dashboard-title">Weekly Schedule</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={() => {
                  const prev = new Date(calendarWeek);
                  prev.setDate(prev.getDate() - 7);
                  const prevStr = prev.toISOString().slice(0, 10);
                  setCalendarWeek(prevStr);
                  fetchCalendar(prevStr);
                }} className="btn btn-secondary btn-sm">← Prev Week</button>
                <button onClick={() => {
                  const next = new Date(calendarWeek);
                  next.setDate(next.getDate() + 7);
                  const nextStr = next.toISOString().slice(0, 10);
                  setCalendarWeek(nextStr);
                  fetchCalendar(nextStr);
                }} className="btn btn-secondary btn-sm">Next Week →</button>
              </div>
            </div>

            {(() => {
              // Compute the 7 days of the week containing calendarWeek.
              const base = new Date(calendarWeek);
              const dayOfWeek = (base.getDay() + 6) % 7;
              const monday = new Date(base);
              monday.setDate(base.getDate() - dayOfWeek);
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                return d.toISOString().slice(0, 10);
              });

              const staffRows = staff.length > 0 ? staff : [];

              if (calendarLoading) {
                return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading calendar...</div>;
              }

              if (staffRows.length === 0) {
                return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Add staff members to see the schedule grid.</div>;
              }

              return (
                <div style={{ overflowX: 'auto' }}>
                  <table className="premium-table" style={{ minWidth: '900px' }}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--bg-secondary)' }}>Staff</th>
                        {days.map(d => (
                          <th key={d} style={{ textAlign: 'center' }}>
                            <div>{new Date(d).toLocaleDateString('en-US', { weekday: 'short' })}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>{new Date(d).getDate()}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staffRows.map(st => (
                        <tr key={st.id}>
                          <td style={{ position: 'sticky', left: 0, background: 'var(--bg-secondary)', fontWeight: 600 }}>{st.name}</td>
                          {days.map(d => {
                            const dayAppts = calendarAppointments.filter(a => a.staffId === st.id && a.date === d);
                            return (
                              <td key={d} style={{ verticalAlign: 'top', padding: '6px', minWidth: '120px' }}>
                                {dayAppts.length === 0 ? (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {dayAppts.map(a => (
                                      <div key={a.id} style={{
                                        background: a.status === 'cancelled' || a.status === 'declined' ? 'var(--bg-tertiary)' : 'var(--primary)',
                                        color: a.status === 'cancelled' || a.status === 'declined' ? 'var(--text-muted)' : 'white',
                                        padding: '4px 6px', borderRadius: '4px', fontSize: '11px',
                                        textDecoration: a.status === 'cancelled' || a.status === 'declined' ? 'line-through' : 'none',
                                      }} title={`${a.user?.name || ''} — ${a.service?.name || ''} (${a.status})`}>
                                        <div style={{ fontWeight: 600 }}>{a.time}</div>
                                        <div style={{ opacity: 0.9 }}>{a.user?.name || 'Customer'}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>
        )}
```

- [ ] **Step 4: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Salon dashboard: weekly calendar grid of bookings per staff"
```

## Context

Phase 4 Task 7. The calendar is a 7-column week grid (Mon–Sun) with one row per staff member, cells showing that staff's bookings for that day. Cancelled/declined bookings render struck-through in muted color. Prev/Next week buttons shift `calendarWeek` by 7 days. The grid uses the existing `premium-table` styles plus `position: sticky` for the staff-name column so it stays visible when scrolling horizontally.

Personal project on `main` — commit to main, do NOT push.

**IMPORTANT discipline note:** Modify ONLY `frontend/src/App.jsx`, and within it ONLY `SalonDashboard` (state + fetch + one sidebar button + the new calendar tab block). Do not touch any other component. If you hit an environment issue, STOP and report. Unauthorized out-of-scope edits will be reverted.

## Before You Begin

Ask if anything unclear. Otherwise proceed.

## Your Job

1. Make the 3 edits inside SalonDashboard only.
2. Build (Step 4).
3. Commit.
4. Self-review: `git diff HEAD~1 -- frontend/src/App.jsx` should show only SalonDashboard changes. Commit message exact.
5. Report back.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Build output summary
- Files changed + commit SHA + `git diff HEAD~1 --stat`
- Self-review findings
- Any concerns

---

## Task 8: Frontend — Staff tab blockout modal + listing

**Files:**
- Modify: `frontend/src/App.jsx` — `SalonDashboard`

- [ ] **Step 1: Add blockout state + fetch**

In `SalonDashboard`, add state:

```jsx
  const [blockouts, setBlockouts] = useState([]);
  const [showBlockoutModal, setShowBlockoutModal] = useState(false);
  const [blockoutStaffId, setBlockoutStaffId] = useState(null);
  const [blockoutDate, setBlockoutDate] = useState('');
  const [blockoutStart, setBlockoutStart] = useState('');
  const [blockoutEnd, setBlockoutEnd] = useState('');
  const [blockoutReason, setBlockoutReason] = useState('');
```

Add a fetch function:

```jsx
  const fetchBlockouts = async () => {
    try {
      const res = await axios.get('/api/salonsdashboard/staff/blockouts');
      setBlockouts(res.data);
    } catch (err) {
      console.error('Error fetching blockouts', err);
    }
  };
```

Add `fetchBlockouts();` to the top-level `useEffect` (alongside the other fetches).

- [ ] **Step 2: Add blockout handlers**

Add handlers (near the other handlers):

```jsx
  const handleOpenBlockout = (staffId) => {
    setBlockoutStaffId(staffId);
    setBlockoutDate(new Date().toISOString().slice(0, 10));
    setBlockoutStart('12:00');
    setBlockoutEnd('13:00');
    setBlockoutReason('');
    setShowBlockoutModal(true);
  };

  const handleSaveBlockout = async () => {
    try {
      await axios.post('/api/salonsdashboard/staff/blockouts', {
        staffId: blockoutStaffId,
        date: blockoutDate,
        startTime: blockoutStart,
        endTime: blockoutEnd,
        reason: blockoutReason,
      });
      showToast('Blockout added.', 'success');
      setShowBlockoutModal(false);
      fetchBlockouts();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to add blockout', 'error');
    }
  };

  const handleRemoveBlockout = async (id) => {
    try {
      await axios.delete(`/api/salonsdashboard/staff/blockouts/${id}`);
      showToast('Blockout removed.', 'success');
      fetchBlockouts();
    } catch (err) {
      showToast('Failed to remove blockout', 'error');
    }
  };
```

- [ ] **Step 3: Add a "Block out" button + per-staff blockout chips in the Staff tab**

In the Staff tab table, each staff row has an Actions cell containing the "Assign" button. Add a "Block out" button alongside it, and render any existing blockouts for that staff as chips above the actions. Replace the actions cell:

```jsx
                          <td>
                            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                              <button onClick={() => handleOpenAssign(st)} className="btn btn-secondary btn-sm">Assign</button>
                              <button onClick={() => handleOpenBlockout(st.id)} className="btn btn-secondary btn-sm">Block out</button>
                            </div>
                            {blockouts.filter(b => b.staffId === st.id).length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {blockouts.filter(b => b.staffId === st.id).map(b => (
                                  <span key={b.id} className="badge badge-warning" style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                    <span>{b.date} {b.startTime}-{b.endTime}{b.reason ? ` · ${b.reason}` : ''}</span>
                                    <button onClick={() => handleRemoveBlockout(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0 }}>×</button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
```

(The existing "Assign" button stays; "Block out" is added next to it.)

- [ ] **Step 4: Add the blockout modal**

After the existing "Staff Notes modal" (near the end of SalonDashboard, before the closing `</div>` of the dashboard root), add:

```jsx
      {showBlockoutModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="panel-title">Block out staff time</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Mark this staff member unavailable for a specific date and time range. Blocked slots won't show as bookable.</p>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input type="date" className="form-input" style={{ paddingLeft: '16px' }} value={blockoutDate} onChange={e => setBlockoutDate(e.target.value)} required />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Start time</label>
                <input type="time" className="form-input" style={{ paddingLeft: '16px' }} value={blockoutStart} onChange={e => setBlockoutStart(e.target.value)} required />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">End time</label>
                <input type="time" className="form-input" style={{ paddingLeft: '16px' }} value={blockoutEnd} onChange={e => setBlockoutEnd(e.target.value)} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Reason (optional)</label>
              <input type="text" className="form-input" style={{ paddingLeft: '16px' }} placeholder="Lunch, leave, etc." value={blockoutReason} onChange={e => setBlockoutReason(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={() => setShowBlockoutModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handleSaveBlockout} className="btn btn-primary btn-sm">Save Blockout</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Salon staff tab: blockout modal + per-staff blockout chips"
```

## Context

Phase 4 Task 8. Owners click "Block out" on a staff member, pick a date/time range, optionally add a reason, and the blockout is listed as chips under that staff member with an × to remove. Combined with Task 3's availability-checker change, a blocked staff member won't appear in the customer's booking wizard for that slot.

Personal project on `main` — commit to main, do NOT push.

**IMPORTANT discipline note:** Modify ONLY `frontend/src/App.jsx`, and within it ONLY `SalonDashboard`. If you hit an environment issue, STOP and report. Unauthorized out-of-scope edits will be reverted.

## Before You Begin

Ask if anything unclear. Otherwise proceed.

## Your Job

1. Make the 4 edits inside SalonDashboard only.
2. Build (Step 5).
3. Commit.
4. Self-review: `git diff HEAD~1 -- frontend/src/App.jsx` should show only SalonDashboard changes. Commit message exact.
5. Report back.

## Report Format

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Build output summary
- Files changed + commit SHA + `git diff HEAD~1 --stat`
- Self-review findings
- Any concerns

---

## Task 9: End-of-phase verification

**Goal:** Confirm analytics, calendar, and blockouts work end-to-end.

- [ ] **Step 1: Fresh boot + build**

```bash
rm -f database.sqlite
cd frontend && npm run build && cd ..
nohup npm start > /tmp/p4server.log 2>&1 &
sleep 7
tail -8 /tmp/p4server.log
```
Expected: server up, seed data loaded.

- [ ] **Step 2: Run all test suites individually**

```bash
node --test tests/statusRules.test.js     # expect 7 pass
node --test tests/cancel-endpoint.test.js  # expect 6 pass
node --test tests/ratings-aggregation.test.js  # expect 4 pass
node --test tests/blockout-availability.test.js # expect 3 pass
```
Expected: 20 total passes, 0 fail (run individually — see Phase 3 note about combined-run isolation).

- [ ] **Step 3: API smoke tests**

```bash
# Salon login
curl -s -X POST http://localhost:3000/api/buisness/login -H "Content-Type: application/json" -d '{"email":"owner@orchid.com","password":"salon123"}' > .tmp_sl.json
SALON_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.tmp_sl.json','utf8')).token)")

# Analytics
curl -s http://localhost:3000/api/salonsdashboard/analytics -H "Authorization: Bearer $SALON_TOKEN"

# Calendar (current week)
curl -s "http://localhost:3000/api/salonsdashboard/calendar?week=$(date -I)" -H "Authorization: Bearer $SALON_TOKEN"

# Add a blockout for staff 1
curl -s -X POST http://localhost:3000/api/salonsdashboard/staff/blockouts -H "Content-Type: application/json" -H "Authorization: Bearer $SALON_TOKEN" -d '{"staffId":1,"date":"2026-08-15","startTime":"12:00","endTime":"14:00","reason":"Lunch"}'

# List blockouts
curl -s http://localhost:3000/api/salonsdashboard/staff/blockouts -H "Authorization: Bearer $SALON_TOKEN"

# Availability check that should now EXCLUDE staff 1 for the blocked slot
curl -s -X POST http://localhost:3000/api/appointment/check -H "Content-Type: application/json" -d '{"dateSelect":"2026-08-15","time":"13:00","salonId":1,"serviceId":1,"duration":30}'
```
Expected: analytics returns `totalRevenue`, `statusCounts`, `topServices`, `bookingsPerDay`; calendar returns the week's appointments array; blockout creates + lists; the availability check excludes the blocked staff for that slot.

- [ ] **Step 4: Browser spot-check**

Open http://localhost:3000, log in as salon owner, verify:
- Overview tab shows real KPIs + bar chart (no fake revenue).
- Calendar tab shows a 7-day grid; Prev/Next week navigates.
- Staff tab has a "Block out" button; adding a blockout shows it as a chip; × removes it.

- [ ] **Step 5: Clean tree**

```bash
git status --short
```
Expected: empty.

- [ ] **Step 6: No commit** — verification only.

---

## After Phase 4

Salon owners have a real management console: honest revenue analytics with a 7-day trend chart and top-services breakdown, a weekly calendar grid showing each staff member's bookings, and the ability to block staff out for specific date/time ranges (which correctly excludes them from customer booking availability). The fake `totalRevenue` client-side sum is gone.

This completes the 4-phase roadmap from the design spec. The app is now production-shaped across all four roles (customer / staff / salon owner / admin) with real ratings, status workflow, favorites, analytics, calendar, and blockouts — all backed by passing tests.
