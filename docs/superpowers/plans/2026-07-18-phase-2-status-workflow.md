# Phase 2: Status-Powered Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the appointment-status workflow on top of Phase 1's `status` field: customers can cancel (>24h rule), staff/owners can accept/decline pending bookings and mark confirmed ones complete, and staff can add post-service notes — with an opt-in `requiresApproval` toggle controlling whether new bookings start `pending` or `confirmed`.

**Architecture:** New endpoints live in `appointmentController.js` and reuse the `canTransition`/`canCancel` helpers from Phase 1's `utils/statusRules.js`. Auth reuses the existing `isAuth` middleware and per-role JWT payloads (`req.user.userId` / `staffId` / `salonId`). The availability checker excludes `cancelled`/`declined` so freed slots become bookable again. Frontend changes are additive buttons/badges inside three existing components — no new routes, no new pages.

**Tech Stack:** Express 5, Sequelize 6 over SQLite, bcrypt/JWT (unchanged), React 19 + Vite. No new dependencies.

**Prerequisite:** Phase 1 complete. Specifically the `Appointment.status` field, `Salons.requiresApproval`, and `utils/statusRules.js` (`canTransition`, `canCancel`, `CANCEL_WINDOW_HOURS`) must all exist.

**Spec reference:** `docs/superpowers/specs/2026-07-18-salon-app-features-design.md` — §4.2 (Phase 2), §3.4 (approval-flow policy), §5 (booking lifecycle).

---

## File Structure

**Modified — backend:**
- `controllers/appointmentController.js` — add `cancelAppointment`, `updateAppointmentStatus`; extend `appointmentChecker` to exclude cancelled/declined.
- `controllers/paymentController.js` — set `status` based on `salon.requiresApproval` when creating the appointment on payment success.
- `routes/appointmentRoutes.js` — mount the two new endpoints.

**Modified — frontend (`frontend/src/App.jsx`):**
- `BookedAppointments` (lines ~1331-1452) — add a Status column + Cancel button.
- `StaffDashboard` (lines ~2129-2207) — add a Status column + Accept/Decline/Complete/Note action buttons + reuse the note modal pattern.
- `SalonDashboard` appointments tab (lines ~1813-1876) — add a Status column + owner status actions (owner can act on behalf of staff) + the `requiresApproval` toggle in the Salon Settings tab.

**New — tests:**
- `tests/status-rules.test.js` — already exists from Phase 1; extend with `startAtFromFields` helper test if needed (see Task 7).

**Not touched:** auth middleware, models (Phase 1 already added the fields), payment routes, admin routes (admin picks up statuses automatically via existing GET).

---

## Task 1: Backend — appointment-status update endpoint + cancel endpoint

**Why first:** All frontend status actions depend on these endpoints existing. Build + test the API before any UI.

**Files:**
- Modify: `controllers/appointmentController.js` (add two controllers; extend `appointmentChecker`)
- Modify: `routes/appointmentRoutes.js` (mount two routes)
- Modify: `controllers/appointmentController.js` top imports (require statusRules)

- [ ] **Step 1: Add the statusRules import**

Edit `controllers/appointmentController.js`. At the top, after the existing requires (after `const { Op } = require('sequelize');` around line 7), add:

```js
const { canTransition, canCancel } = require('../utils/statusRules');
```

- [ ] **Step 2: Extend `appointmentChecker` to exclude cancelled/declined**

In the same file, in `appointmentChecker` (around line 55-72), the "Check for staff availability" query has a `where` clause. Find this block:

```js
        const unavailableStaff = await appointmentModel.findAll({
            where: {
                staffId: staffIds,
                salonId,
                date: dateSelect,
                [Op.or]: [
                    {
                        time: {
                            [Op.lt]: endTime,
                        },
                        endTime: {
                            [Op.gt]: startTime,
                        },
                    },
                ],
            },
            attributes: ['staffId'],
        });
```

Add a `status` filter so cancelled/declined appointments no longer block the slot. Insert `status: { [Op.notIn]: ['cancelled', 'declined'] },` into the `where` object (place it after `date: dateSelect,`):

```js
        const unavailableStaff = await appointmentModel.findAll({
            where: {
                staffId: staffIds,
                salonId,
                date: dateSelect,
                status: { [Op.notIn]: ['cancelled', 'declined'] },
                [Op.or]: [
                    {
                        time: {
                            [Op.lt]: endTime,
                        },
                        endTime: {
                            [Op.gt]: startTime,
                        },
                    },
                ],
            },
            attributes: ['staffId'],
        });
```

(Do NOT exclude `pending` — a pending booking should still block the slot so two customers can't double-book a slot awaiting approval.)

- [ ] **Step 3: Add `cancelAppointment` controller**

Append this controller function to `controllers/appointmentController.js` (before the `module.exports = { ... }` block):

```js
// Customer cancels their own appointment (must be >24h before start).
const cancelAppointment = async (req, res) => {
    const { appointmentId } = req.params;
    const userId = req.user.userId;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }
        // Ownership: only the booking customer may cancel.
        if (appointment.userId !== userId) {
            return res.status(403).json({ message: 'Not authorized to cancel this appointment' });
        }

        // Build the start Date from date + time fields (SQLite returns DATEONLY string + TIME string).
        const startAt = new Date(`${appointment.date}T${appointment.time}`);
        if (!canCancel(appointment.status, startAt)) {
            return res.status(400).json({ message: 'This appointment can no longer be cancelled (status or <24h window).' });
        }

        appointment.status = 'cancelled';
        await appointment.save();
        res.status(200).json({ message: 'Appointment cancelled successfully', appointment });
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 4: Add `updateAppointmentStatus` controller (staff/owner)**

Append this controller function immediately after `cancelAppointment`:

```js
// Staff or salon owner updates an appointment's status
// (accept pending -> confirmed, decline pending -> declined, complete confirmed -> completed).
const updateAppointmentStatus = async (req, res) => {
    const { appointmentId } = req.params;
    const { status: newStatus } = req.body;

    try {
        const appointment = await appointmentModel.findByPk(appointmentId);
        if (!appointment) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        // Authorization: caller must be either the salon owner of this salon, or a staff member of this salon.
        const salonId = req.user.salonId;
        const staffId = req.user.staffId;
        if (salonId === undefined && staffId === undefined) {
            return res.status(403).json({ message: 'Not authorized' });
        }
        if (salonId !== undefined && appointment.salonId !== salonId) {
            return res.status(403).json({ message: 'Not authorized: appointment belongs to a different salon' });
        }
        if (staffId !== undefined) {
            // Staff may only act on appointments assigned to themselves.
            if (appointment.staffId !== staffId) {
                return res.status(403).json({ message: 'Not authorized: this appointment is not assigned to you' });
            }
        }

        if (!canTransition(appointment.status, newStatus)) {
            return res.status(400).json({ message: `Cannot move appointment from '${appointment.status}' to '${newStatus}'` });
        }

        appointment.status = newStatus;
        await appointment.save();
        res.status(200).json({ message: `Appointment ${newStatus}`, appointment });
    } catch (error) {
        console.error('Error updating appointment status:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 5: Export the two new controllers**

Update the `module.exports` block at the bottom of the file to include the two new functions:

```js
module.exports = {
    appointmentChecker,
    getAllAppointmentsByUserId,
    getScheduledAppointmentsBySalonId,
    mailAppointment,
    updateCustomerReview,
    updateStaffReview,
    cancelAppointment,
    updateAppointmentStatus,
};
```

- [ ] **Step 6: Mount the two new routes**

Edit `routes/appointmentRoutes.js`. After the existing `router.put('/staffreview/:appointmentId', appointmentController.updateStaffReview);` line, add:

```js
// Status workflow (Phase 2)
router.put('/cancel/:appointmentId', authMiddleware, appointmentController.cancelAppointment);
router.put('/status/:appointmentId', authMiddleware, appointmentController.updateAppointmentStatus);
```

(Both require auth. The cancel route relies on `req.user.userId`, the status route on `req.user.salonId` or `req.user.staffId`.)

- [ ] **Step 7: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts on port 3000, no syntax errors, DB synced. Killed by timeout.

- [ ] **Step 8: Commit**

```bash
git add controllers/appointmentController.js routes/appointmentRoutes.js
git commit -m "Add appointment cancel + status-update endpoints"
```

---

## Task 2: Backend — payment success sets status based on requiresApproval

**Files:**
- Modify: `controllers/paymentController.js` — the `getPaymentStatus_` function, where the appointment is created (around lines 92-108).

- [ ] **Step 1: Look up the salon's requiresApproval when creating the appointment**

In `controllers/paymentController.js`, find the block inside `getPaymentStatus_` that creates the appointment on payment success (around lines 92-108). It currently looks like:

```js
    if (orderStatus === "Success") {
      const paymentDetails = await Payment.findOne({ where: { orderId } });
      try {
        await appointmentModel.create({
          staffId: paymentDetails.staffId,
          salonId: paymentDetails.salonId,
          serviceId: paymentDetails.serviceId,
          userId: paymentDetails.customerID,
          date: paymentDetails.dateSelected,
          time: paymentDetails.timeSelected,
          endTime: paymentDetails.endTime,
        });
      } catch (error) {
        console.error("Error saving appointment:", error.message);
      }
    }
```

Replace it with a version that (a) loads the salon to read `requiresApproval` and (b) sets the new appointment's `status` accordingly:

```js
    if (orderStatus === "Success") {
      const paymentDetails = await Payment.findOne({ where: { orderId } });
      try {
        const salon = await salonModel.findByPk(paymentDetails.salonId);
        const initialStatus = salon && salon.requiresApproval ? 'pending' : 'confirmed';
        await appointmentModel.create({
          staffId: paymentDetails.staffId,
          salonId: paymentDetails.salonId,
          serviceId: paymentDetails.serviceId,
          userId: paymentDetails.customerID,
          date: paymentDetails.dateSelected,
          time: paymentDetails.timeSelected,
          endTime: paymentDetails.endTime,
          status: initialStatus,
        });
      } catch (error) {
        console.error("Error saving appointment:", error.message);
      }
    }
```

- [ ] **Step 2: Ensure `salonModel` is required at the top of the file**

Check the top of `controllers/paymentController.js`. It currently requires `Payment`, `userModel`, `appointmentModel`. Add `salonModel` if not present:

```js
const Payment = require("../models/paymentModel");
const userModel = require("../models/userModel");
const appointmentModel = require("../models/appointmentModel");
const salonModel = require("../models/salonsModel");
```

(Add only the `salonModel` line if the others are already there.)

- [ ] **Step 3: Verify boot**

```bash
timeout 15 npm start
```
Expected: server starts cleanly. Killed by timeout.

- [ ] **Step 4: Commit**

```bash
git add controllers/paymentController.js
git commit -m "Set new appointment status from salon.requiresApproval on payment success"
```

---

## Task 3: Backend — integration test for the cancel endpoint (the 24h rule)

**Why:** The cancel endpoint has the trickiest business rule (status + 24h + ownership). Lock it with an integration test that exercises the real controller against the real SQLite DB. This is the highest-value test in the phase.

**Files:**
- Create: `tests/cancel-endpoint.test.js`

- [ ] **Step 1: Write the integration test**

Create `tests/cancel-endpoint.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const { cancelAppointment } = require('../controllers/appointmentController');

// Minimal req/res stubs for invoking the controller directly.
const mockRes = () => {
    const r = { statusCode: 200, body: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    return r;
};

let customer, otherCustomer, futureAppt, pastAppt, pendingAppt, completedAppt;

before(async () => {
    await sequelize.sync({ force: true });
    customer = await User.create({ name: 'Cust', email: 'c@t.com', password: 'x', phoneNumber: '1' });
    otherCustomer = await User.create({ name: 'Other', email: 'o@t.com', password: 'x', phoneNumber: '2' });
    const salon = await Salons.create({ name: 'S', email: 's@t.com', password: 'x', phoneNumber: '3', address: 'a', pricing: 'Moderate' });

    const futureDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
    const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    futureAppt = await Appointment.create({ staffId: 1, salonId: salon.id, serviceId: 1, userId: customer.id, date: futureDate, time: '12:00', endTime: '12:30', status: 'confirmed' });
    pendingAppt = await Appointment.create({ staffId: 1, salonId: salon.id, serviceId: 1, userId: customer.id, date: futureDate, time: '13:00', endTime: '13:30', status: 'pending' });
    pastAppt = await Appointment.create({ staffId: 1, salonId: salon.id, serviceId: 1, userId: customer.id, date: pastDate, time: '12:00', endTime: '12:30', status: 'confirmed' });
    completedAppt = await Appointment.create({ staffId: 1, salonId: salon.id, serviceId: 1, userId: customer.id, date: futureDate, time: '14:00', endTime: '14:30', status: 'completed' });
});

after(async () => { await sequelize.close(); });

test('owner can cancel a confirmed appointment >24h away', async () => {
    const req = { params: { appointmentId: String(futureAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 200);
    await futureAppt.reload();
    assert.equal(futureAppt.status, 'cancelled');
});

test('owner can cancel a pending appointment >24h away', async () => {
    const req = { params: { appointmentId: String(pendingAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 200);
});

test('cannot cancel an appointment within 24h', async () => {
    // pastAppt's date is yesterday so it's well within 24h.
    const req = { params: { appointmentId: String(pastAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /cancel/i);
});

test('cannot cancel a completed appointment', async () => {
    const req = { params: { appointmentId: String(completedAppt.id) }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 400);
});

test('non-owner cannot cancel (403)', async () => {
    const req = { params: { appointmentId: String(futureAppt.id) }, user: { userId: otherCustomer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 403);
});

test('404 for unknown appointment', async () => {
    const req = { params: { appointmentId: '999999' }, user: { userId: customer.id } };
    const res = mockRes();
    await cancelAppointment(req, res);
    assert.equal(res.statusCode, 404);
});
```

- [ ] **Step 2: Run the test**

```bash
node --test tests/cancel-endpoint.test.js
```
Expected: all 6 tests pass. If any fail, do NOT modify the test to make it pass — the test is correct; fix the controller.

- [ ] **Step 3: Commit**

```bash
git add tests/cancel-endpoint.test.js
git commit -m "Add integration tests for appointment cancel endpoint"
```

---

## Task 4: Frontend — Customer BookedAppointments: status badge + cancel button

**Files:**
- Modify: `frontend/src/App.jsx` — the `BookedAppointments` component (around lines 1331-1452).

- [ ] **Step 1: Add a `handleCancel` function inside `BookedAppointments`**

Inside the `BookedAppointments` component, after the existing `handleSubmitReview` function (around line 1365) and before the `return (` statement, add:

```jsx
  const handleCancel = async (apptId) => {
    if (!confirm('Cancel this appointment? This cannot be undone.')) return;
    try {
      await axios.put(`/api/appointment/cancel/${apptId}`);
      showToast('Appointment cancelled.', 'success');
      fetchBookings();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to cancel appointment', 'error');
    }
  };
```

- [ ] **Step 2: Add a Status column header**

In the appointments table's `<thead><tr>` (around line 1383), the headers are currently: Salon, Service, Staff Assigned, Scheduled Slot, Your Feedback, Therapist Note, Actions. Insert a `<th>Status</th>` between the "Scheduled Slot" and "Your Feedback" headers:

```jsx
                  <tr>
                    <th>Salon</th>
                    <th>Service</th>
                    <th>Staff Assigned</th>
                    <th>Scheduled Slot</th>
                    <th>Status</th>
                    <th>Your Feedback</th>
                    <th>Therapist Note</th>
                    <th>Actions</th>
                  </tr>
```

- [ ] **Step 3: Add a Status cell + cancel button per row**

In the `<tbody>` row mapping (around lines 1393-1424), each `<tr>` currently has cells for salon/service/staff/slot/feedback/note/actions. Insert a status cell between the slot cell and the feedback cell, and add a Cancel button to the actions cell.

Find the scheduled-slot cell:
```jsx
                  <td>
                    <div>{appt.date}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{appt.time} - {appt.endTime}</div>
                  </td>
```

Immediately AFTER its closing `</td>`, add a status cell:

```jsx
                  <td>
                    <span className={`badge ${appt.status === 'confirmed' ? 'badge-success' : appt.status === 'pending' ? 'badge-warning' : appt.status === 'completed' ? 'badge-info' : appt.status === 'cancelled' ? 'badge-danger' : appt.status === 'declined' ? 'badge-danger' : 'badge-warning'}`}>
                      {appt.status || 'confirmed'}
                    </span>
                  </td>
```

Then in the Actions cell (which currently only has the review button), add a Cancel button shown only for cancellable statuses. Replace the existing actions cell:

```jsx
                  <td>
                    <button 
                      onClick={() => handleOpenReview(appt.id, appt.userReview)} 
                      className="btn btn-secondary btn-sm"
                    >
                      <Star size={14} /> {appt.userReview ? 'Edit Review' : 'Add Review'}
                    </button>
                  </td>
```

with:

```jsx
                  <td style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button 
                      onClick={() => handleOpenReview(appt.id, appt.userReview)} 
                      className="btn btn-secondary btn-sm"
                    >
                      <Star size={14} /> {appt.userReview ? 'Edit Review' : 'Add Review'}
                    </button>
                    {(appt.status === 'confirmed' || appt.status === 'pending') && (
                      <button 
                        onClick={() => handleCancel(appt.id)} 
                        className="btn btn-danger btn-sm"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
```

(The cancel button only renders for `confirmed`/`pending` — the server enforces the 24h rule regardless, so even if shown, a too-soon cancel returns 400 and shows the error toast.)

- [ ] **Step 4: Build frontend and smoke-check**

```bash
cd frontend && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "Customer bookings: status badge + cancel button"
```

---

## Task 5: Frontend — StaffDashboard: status column + action buttons + note modal

**Files:**
- Modify: `frontend/src/App.jsx` — the `StaffDashboard` component (around lines 2129-2207).

- [ ] **Step 1: Add state for status updates + note modal**

In `StaffDashboard`, after the existing state declarations (`appointments`, `loading`), add:

```jsx
  const [noteApptId, setNoteApptId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
```

(You'll also need to add `useState` to the imports at the top of `App.jsx` if it isn't already imported — but it is, on line 1: `import React, { useState, useEffect } from 'react';`. So no import change.)

- [ ] **Step 2: Add handlers for status change + note**

After the `useEffect` block (around line 2145) and before the `return (`, add:

```jsx
  const handleStatusChange = async (apptId, newStatus) => {
    try {
      await axios.put(`/api/appointment/status/${apptId}`, { status: newStatus });
      showToast(`Appointment ${newStatus}.`, 'success');
      // refresh list
      const res = await axios.get(`/api/staff/appointments?staffId=${session.id}`);
      setAppointments(res.data);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update status', 'error');
    }
  };

  const handleOpenNote = (apptId, currentNote) => {
    setNoteApptId(apptId);
    setNoteText(currentNote || '');
    setShowNoteModal(true);
  };

  const handleSaveNote = async () => {
    try {
      await axios.put(`/api/appointment/staffreview/${noteApptId}`, { review: noteText });
      showToast('Note saved.', 'success');
      setShowNoteModal(false);
      const res = await axios.get(`/api/staff/appointments?staffId=${session.id}`);
      setAppointments(res.data);
    } catch (err) {
      showToast('Failed to save note', 'error');
    }
  };
```

- [ ] **Step 3: Add Status + Actions columns to the table header**

In `StaffDashboard`'s table `<thead><tr>` (around lines 2171-2177), the headers are currently: Customer Name, Requested Service, Appointment Slot, Customer Review Notes, Internal Therapist Notes. Add `<th>Status</th>` and `<th>Actions</th>` at the end:

```jsx
              <tr>
                <th>Customer Name</th>
                <th>Requested Service</th>
                <th>Appointment Slot</th>
                <th>Customer Review Notes</th>
                <th>Internal Therapist Notes</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
```

- [ ] **Step 4: Add status + actions cells per row + the note modal**

In the `<tbody>` row mapping (around lines 2180-2199), each `<tr>` ends with the "Internal Therapist Notes" cell. After that cell's `</td>`, add a status cell and an actions cell. Append before the closing `</tr>`:

```jsx
                  <td>
                    <span className={`badge ${appt.status === 'confirmed' ? 'badge-success' : appt.status === 'pending' ? 'badge-warning' : appt.status === 'completed' ? 'badge-info' : 'badge-danger'}`}>
                      {appt.status || 'confirmed'}
                    </span>
                  </td>
                  <td style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {appt.status === 'pending' && (
                      <>
                        <button onClick={() => handleStatusChange(appt.id, 'confirmed')} className="btn btn-primary btn-sm">Accept</button>
                        <button onClick={() => handleStatusChange(appt.id, 'declined')} className="btn btn-danger btn-sm">Decline</button>
                      </>
                    )}
                    {appt.status === 'confirmed' && (
                      <button onClick={() => handleStatusChange(appt.id, 'completed')} className="btn btn-secondary btn-sm">Mark Complete</button>
                    )}
                    <button onClick={() => handleOpenNote(appt.id, appt.staffReview)} className="btn btn-secondary btn-sm">
                      {appt.staffReview ? 'Edit Note' : 'Add Note'}
                    </button>
                  </td>
```

Then, AFTER the closing `</table>` and the closing `</div>` of the table-container, but BEFORE the final closing `</div>` of the component's root (around line 2205), add the note modal:

```jsx
      {showNoteModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 className="panel-title">Therapist Note</h3>
            <div className="form-group">
              <textarea
                className="form-textarea"
                placeholder="Service notes, client preferences, follow-up..."
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={() => setShowNoteModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handleSaveNote} className="btn btn-primary btn-sm">Save Note</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Staff dashboard: status badges + accept/decline/complete + notes"
```

---

## Task 6: Frontend — SalonDashboard appointments tab: status column + owner status actions

**Files:**
- Modify: `frontend/src/App.jsx` — the `SalonDashboard` component's appointments tab (around lines 1813-1876).

- [ ] **Step 1: Add a status-change handler inside `SalonDashboard`**

`SalonDashboard` already fetches appointments via `fetchAppointments`. Add a handler near the other handlers (e.g. after `handleSaveStaffNote`, around line 1684):

```jsx
  const handleApptStatus = async (apptId, newStatus) => {
    try {
      await axios.put(`/api/appointment/status/${apptId}`, { status: newStatus });
      showToast(`Appointment ${newStatus}.`, 'success');
      fetchAppointments();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update status', 'error');
    }
  };
```

- [ ] **Step 2: Add Status + Actions columns to the appointments table header**

In the appointments-tab table `<thead><tr>` (around lines 1830-1838), the headers are: Customer Details, Service details, Assigned Therapist, Scheduled Slot, Customer Feedback, Therapist Note, Action. Add `<th>Status</th>` before "Customer Feedback" (and keep the existing "Action" header):

```jsx
                    <tr>
                      <th>Customer Details</th>
                      <th>Service details</th>
                      <th>Assigned Therapist</th>
                      <th>Scheduled Slot</th>
                      <th>Status</th>
                      <th>Customer Feedback</th>
                      <th>Therapist Note</th>
                      <th>Action</th>
                    </tr>
```

- [ ] **Step 3: Add a status cell + extend the action cell per row**

In the appointments-tab `<tbody>` row (around lines 1841-1869), insert a status cell between the "Scheduled Slot" cell and the "Customer Feedback" cell:

```jsx
                        <td>
                          <span className={`badge ${appt.status === 'confirmed' ? 'badge-success' : appt.status === 'pending' ? 'badge-warning' : appt.status === 'completed' ? 'badge-info' : 'badge-danger'}`}>
                            {appt.status || 'confirmed'}
                          </span>
                        </td>
```

Then replace the existing Action cell (which currently only has the "Staff Note" button) with a cell that also offers owner status actions. Replace:

```jsx
                        <td>
                          <button onClick={() => handleOpenStaffNote(appt.id, appt.staffReview)} className="btn btn-secondary btn-sm">
                            <Plus size={14} /> Staff Note
                          </button>
                        </td>
```

with:

```jsx
                        <td style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {appt.status === 'pending' && (
                            <>
                              <button onClick={() => handleApptStatus(appt.id, 'confirmed')} className="btn btn-primary btn-sm">Accept</button>
                              <button onClick={() => handleApptStatus(appt.id, 'declined')} className="btn btn-danger btn-sm">Decline</button>
                            </>
                          )}
                          {appt.status === 'confirmed' && (
                            <button onClick={() => handleApptStatus(appt.id, 'completed')} className="btn btn-secondary btn-sm">Mark Complete</button>
                          )}
                          <button onClick={() => handleOpenStaffNote(appt.id, appt.staffReview)} className="btn btn-secondary btn-sm">
                            <Plus size={14} /> Staff Note
                          </button>
                        </td>
```

- [ ] **Step 4: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx
git commit -m "Salon dashboard appointments: status badges + owner status actions"
```

---

## Task 7: Frontend — SalonDashboard settings tab: requiresApproval toggle

**Files:**
- Modify: `frontend/src/App.jsx` — `SalonDashboard` settings tab (around lines 2031-2065) and the salon-detail-save handler.

- [ ] **Step 1: Add requiresApproval state**

`SalonDashboard` already has salon-detail state (`salonName`, `salonPhone`, etc.). Add one more state near them (around line 1486):

```jsx
  const [salonRequiresApproval, setSalonRequiresApproval] = useState(false);
```

- [ ] **Step 2: Load the current value in `fetchSalonProfile`**

In `fetchSalonProfile` (around lines 1493-1506), after the existing `setSalon*` calls, add:

```jsx
      setSalonRequiresApproval(res.data.requiresApproval || false);
```

- [ ] **Step 3: Send it in `handleSaveDetails`**

In `handleSaveDetails` (around lines 1648-1666), the `axios.put('/api/buisness/changeSalonDetail', {...})` payload currently includes salonId/name/phoneNumber/address/workingDays/openingTime/closingTime. Add `requiresApproval: salonRequiresApproval` to that payload:

```jsx
      await axios.put('/api/buisness/changeSalonDetail', {
        salonId: salon.id,
        name: salonName,
        phoneNumber: salonPhone,
        address: salonAddress,
        workingDays: salonDays,
        openingTime: salonOpen,
        closingTime: salonClose,
        requiresApproval: salonRequiresApproval
      });
```

- [ ] **Step 4: Add a toggle UI in the Salon Settings tab**

In the settings-tab form (around lines 2035-2063), add a toggle row before the submit button. Insert before the `<div style={{ gridColumn: 'span 2', marginTop: '12px' }}>` that contains the submit button:

```jsx
              <div className="form-group" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  id="requiresApproval"
                  checked={salonRequiresApproval}
                  onChange={e => setSalonRequiresApproval(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="requiresApproval" style={{ cursor: 'pointer' }}>
                  <strong>Require approval for new bookings</strong>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    When on, new paid bookings start as "pending" until a staff member or you accept them. When off, bookings are "confirmed" instantly.
                  </div>
                </label>
              </div>
```

- [ ] **Step 5: Update the backend `updateSalonDetails` controller to accept requiresApproval**

`controllers/salonController.js`'s `updateSalonDetails` (the handler for `PUT /api/buisness/changeSalonDetail`) uses an explicit field list. Update it to destructure and persist `requiresApproval`.

At line 112, change the destructure:
```js
    const { name, phoneNumber, address, workingDays, openingTime, closingTime } = req.body;
```
to:
```js
    const { name, phoneNumber, address, workingDays, openingTime, closingTime, requiresApproval } = req.body;
```

And in the `salon.update({...})` call (around lines 122-129), add `requiresApproval` to the object:
```js
        await salon.update({
            name,
            phoneNumber,
            address,
            workingDays,
            openingTime,
            closingTime,
            requiresApproval
        });
```

- [ ] **Step 6: Build and commit**

```bash
cd frontend && npm run build && cd ..
git add frontend/src/App.jsx controllers/salonController.js
git commit -m "Salon settings: opt-in requiresApproval toggle for new bookings"
```

---

## Task 8: End-of-phase manual verification

**Goal:** Confirm the full status workflow works end-to-end against the seeded data.

- [ ] **Step 1: Fresh boot + build**

```bash
rm -f database.sqlite
cd frontend && npm run build && cd ..
nohup npm start > /tmp/server.log 2>&1 &
sleep 7
tail -10 /tmp/server.log
```
Expected: server up, seed data loaded.

- [ ] **Step 2: Run all unit + integration tests**

```bash
node --test tests/statusRules.test.js
node --test tests/cancel-endpoint.test.js
```
Expected: 7/7 pass (status rules) and 6/6 pass (cancel endpoint).

- [ ] **Step 3: API smoke test — cancel a booking via curl**

Log in as customer, get a future-dated booking, cancel it:
```bash
CUSTOMER_TOKEN=$(curl -s -X POST http://localhost:3000/api/user/login -H "Content-Type: application/json" -d '{"email":"jane@example.com","password":"customer123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
# (No seeded appointments exist by default — skip the cancel curl if the list is empty; the integration test in Task 3 already proved this path.)
curl -s "http://localhost:3000/api/appointment/getAll?userId=1" -H "Authorization: Bearer $CUSTOMER_TOKEN"
```
Expected: a JSON array (possibly empty). If non-empty, the cancel endpoint can be exercised on one of the items.

- [ ] **Step 4: Verify the production bundle has no dev-only simulator button**

```bash
grep -l "Simulate Secure Booking" frontend/dist/assets/*.js || echo "PASS: not in prod bundle"
```

- [ ] **Step 5: Browser spot-check (manual)**

Open http://localhost:3000 and verify:
- Customer login → My Bookings shows a Status column (bookings display `confirmed` if any).
- Staff login (`sarah@orchid.com`/`staff123`) → Staff Console shows Status + Actions columns.
- Salon login (`owner@orchid.com`/`salon123`) → Schedules tab shows Status column; Settings tab has the "Require approval" checkbox.

- [ ] **Step 6: Confirm clean tree**

```bash
git status --short
```
Expected: empty (clean).

- [ ] **Step 7: No commit** — verification only.

---

## After Phase 2

Customers can cancel (>24h enforced server-side); staff can accept/decline pending bookings, mark confirmed ones complete, and add post-service notes; salon owners can do all of the above from their console and toggle the opt-in approval flow. Cancelled/declined slots free up in the availability checker.

Next: Phase 3 plan (customer polish — real star ratings, rebook, favorites).
