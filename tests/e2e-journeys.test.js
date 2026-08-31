/**
 * Iteration #35 — end-to-end journey sweep.
 *
 * Unlike the per-feature suites, this file chains MULTIPLE controllers
 * through REAL SQLite state to walk three full customer lifecycles:
 *
 *   JOURNEY 1 "Book to review"   — salon signup -> service+staff -> browse(#22)
 *                                  -> pay with note+partySize -> finalize ->
 *                                  confirm (#18) -> reminder sweep skips ->
 *                                  complete (+loyalty once, #27) -> review ->
 *                                  salon reply (#8) -> avgRating feeds minRating (#22)
 *   JOURNEY 2 "Promo + tip"      — promo authored by salon (#10) -> payment with
 *                                  percent discount + tip (#26) -> ledger math ->
 *                                  usedCount exactly once -> cancel >24h frees a
 *                                  waitlist opening (#30) -> CSV export (#9/#25)
 *   JOURNEY 3 "Lifecycle edges"  — referral signup chain (#28) -> waitlist
 *                                  duplicate guard (#30) -> upcoming listing (#29)
 *                                  -> GDPR self-deletion (#32, wrong + right
 *                                  password, audit row, futures cancelled)
 *
 * House style: direct-controller invocation over mock req/res objects,
 * Cashfree stubbed BEFORE require when payment paths are involved,
 * fire-and-forget side effects (notifications/audit/waitlist claims) polled.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const Appointment = require('../models/appointmentModel');
const Payment = require('../models/paymentModel');
const PromoCode = require('../models/promoCodeModel');
const Waitlist = require('../models/waitlistModel');
const Notification = require('../models/notificationModel');
const AdminAudit = require('../models/adminAuditModel');

// Stub the Cashfree gateway BEFORE paymentController is required — the
// controller destructures createOrder at module load (same trick as
// party-size / tips / booking-notes suites), so real booking creation runs
// without touching the network.
const cashfree = require('../services/cashfreeServices');
cashfree.createOrder = async () => 'stub-e2e-session-id';

const { salonSignup, getAllSalons } = require('../controllers/salonController');
const { addService } = require('../controllers/salonServicesController');
const { addStaff, assignServices } = require('../controllers/salonStaffController');
const { processPayment } = require('../controllers/paymentController');
const { finalizeAppointmentFromPayment } = require('../services/paymentService');
const {
    updateAppointmentStatus,
    updateCustomerReview,
    replyToReview,
    cancelAppointment,
    exportAppointmentsCsv,
    getUpcomingAppointments,
} = require('../controllers/appointmentController');
const { createPromo } = require('../controllers/salonPromosController');
const { joinWaitlist } = require('../controllers/waitlistController');
const { handleUserSignup, deleteMyAccount } = require('../controllers/userController');
const { ensureReferralCode } = require('../services/referralService');
const { runReminderSweep } = require('../services/reminderService');

// ── House helpers (mock style shared across the suites) ──────────────────

const mockReq = (overrides = {}) => ({ user: {}, params: {}, query: {}, body: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null, headers: {} };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    r.setHeader = (name, value) => { r.headers[name] = value; return r; };
    r.send = (data) => { r.body = data; return r; };
    return r;
};
// processPayment reads req.secure / req.get('host') building the return URL.
const mockPayReq = (overrides = {}) => ({
    user: {}, query: {}, params: {}, body: {},
    headers: {}, secure: false, get: (k) => (k === 'host' ? 'localhost' : undefined),
    ...overrides,
});
// Serialize like Express would — direct invocation leaves Sequelize instances.
const plain = (x) => JSON.parse(JSON.stringify(x));
// Browse responses are a bare array (no params) or a { data, ... } envelope.
const idsOf = (body) => (Array.isArray(body) ? body : body.data).map((s) => Number(s.id));
// Fire-and-forget side effects are polled, never assumed synchronous.
const waitFor = async (fn, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await fn();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 25));
    }
    return await fn();
};

// Future slot helpers (DATEONLY strings, local calendar frame).
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 3600 * 1000);
const ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Open 24/7 so neither the hours gate nor lead time (unset -> 0) can block a
 // booking regardless of which weekday the run lands on.
const WIDE_HOURS = { workingDays: ALL_DAYS, openingTime: '00:00', closingTime: '23:59' };

let j1CustomerNote = 'Bridal party of 3 — one bride, two bridesmaids';

before(async () => {
    // Fire-and-forget mailers must resolve to their documented no-op instead
    // of attempting REAL Brevo calls (.env ships keys) — same as reminders.test.
    delete process.env.BREVO_API_KEY;
    delete process.env.SENDER_EMAIL;

    await sequelize.sync({ force: true });
});

after(async () => { await sequelize.close(); });

// ══════════════════════════════ JOURNEY 1 ════════════════════════════════

test('JOURNEY 1 book-to-review: signup -> browse(#22) -> pay(note+party) -> finalize -> confirm(#18) -> sweep-skip -> complete(loyalty once,#27) -> review -> reply(#8) -> minRating matches', async () => {
    // ── Salon onboards through the REAL signup controller ──────────────
    const signRes = mockRes();
    await salonSignup(mockReq({
        body: {
            name: 'E2E Serene Spa',
            email: 'serene@e2e.com',
            password: 'salonPass123',
            phoneNumber: '9000000001',
            address: '1 Harmony Lane',
            pricing: 'Premium',
        },
    }), signRes);
    assert.equal(signRes.statusCode, 201);
    const salon = await Salons.findOne({ where: { email: 'serene@e2e.com' } });
    assert.ok(salon, 'signup materialized a salon row');
    assert.equal(salon.statusbar, 'active');
    // Bookable any day/time, and owner approval ON so the booking materializes
    // as pending and the #18 status flow is genuinely exercised.
    await salon.update({ ...WIDE_HOURS, requiresApproval: true });

    // ── Service + staff created through the salon console controllers ──
    const svcRes = mockRes();
    await addService(mockReq({
        user: { role: 'salon', salonId: salon.id },
        body: { name: 'Bridal Glow Package', price: 300, duration: 60, category: 'Hair' },
    }), svcRes);
    assert.equal(svcRes.statusCode, 201);
    const service = plain(svcRes.body);
    assert.equal(Number(service.salonId), Number(salon.id));
    assert.equal(service.statusbar, 'active');

    const staffRes = mockRes();
    await addStaff(mockReq({
        user: { role: 'salon', salonId: salon.id },
        body: { name: 'Stylist Eve', email: 'eve@e2e.com', password: 'staffPass123', phoneNumber: '9000000002' },
    }), staffRes);
    assert.equal(staffRes.statusCode, 201);
    const staff = plain(staffRes.body.staff);
    assert.equal(Number(staff.salonId), Number(salon.id));

    // A stylist only becomes bookable once the console links them to a
    // service — /pay enforces the same eligibility the checker does.
    const assignRes = mockRes();
    await assignServices(mockReq({
        user: { role: 'salon', salonId: salon.id },
        body: { staffId: staff.id, services: [service.id] },
    }), assignRes);
    assert.equal(assignRes.statusCode, 200);

    // ── Customer joins through the REAL signup flow ────────────────────
    const custRes = mockRes();
    await handleUserSignup(mockReq({
        body: { name: 'Cara Customer', email: 'cara@e2e.com', password: 'password123', phoneNumber: '9000000003' },
    }), custRes);
    assert.equal(custRes.statusCode, 201);
    const customerId = custRes.body.userId;
    assert.ok(customerId);

    // ── Discovery (#22): search finds the salon; minRating can't match an unrated one yet ──
    const found = mockRes();
    await getAllSalons(mockReq({ query: { search: 'serene spa' } }), found);
    assert.equal(found.statusCode, 200);
    assert.deepEqual(idsOf(found.body), [Number(salon.id)]);

    const unrated = mockRes();
    await getAllSalons(mockReq({ query: { search: 'serene', minRating: 4 } }), unrated);
    assert.deepEqual(idsOf(unrated.body), [], 'NULL avgRating never matches minRating');

    // ── Booking WITH customerNote + partySize=3 through processPayment ──
    const bookingDate = ymd(daysFromNow(6)); // far future: outside the 24h reminder window
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customerId },
        body: {
            serviceId: service.id, salonId: salon.id, staffId: staff.id,
            dateSelect: bookingDate, time: '10:00', duration: service.duration,
            customerNote: j1CustomerNote,
            partySize: 3,
        },
    }), payRes);
    assert.equal(payRes.statusCode, 200);
    assert.ok(payRes.body.orderId, 'gateway order id returned');

    let order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.ok(order, 'pending Payment carrier row persisted');
    assert.equal(order.paymentStatus, 'Pending');
    assert.equal(Number(order.originalAmount), 300, 'authoritative service price');
    assert.equal(Number(order.discountAmount), 0);
    assert.equal(Number(order.orderAmount), 300);
    assert.equal(order.customerNote, j1CustomerNote, 'note rides on the Payment carrier');
    assert.equal(order.partySize, 3);

    // ── Finalize path materializes the Appointment carrying note+partySize ──
    order.paymentStatus = 'Success';
    await order.save();
    const appointment = await finalizeAppointmentFromPayment(order);
    assert.ok(appointment && appointment.id);
    await appointment.reload();
    assert.equal(appointment.orderId, order.orderId);
    assert.equal(appointment.status, 'pending', 'requiresApproval=true -> starts pending');
    assert.equal(appointment.customerNote, j1CustomerNote, '#23 note copied onto the booking');
    assert.equal(appointment.partySize, 3, '#25 headcount copied onto the booking');
    assert.equal(Number(appointment.userId), Number(customerId));
    assert.equal(appointment.date, bookingDate);

    // Fire-and-forget new-booking notification reaches the salon.
    const newBookingNotice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'salon', recipientId: salon.id, type: 'booking.new' },
    }));
    assert.ok(newBookingNotice, 'booking.new notification written');

    // ── Reminder sweep: booking is ~6 days out -> nothing due, nothing stamped ──
    const sweep = await runReminderSweep(new Date());
    assert.equal(sweep.candidates, 0, 'far-future rows never even become candidates');
    assert.equal(sweep.due, 0);
    await appointment.reload();
    assert.equal(appointment.reminderSentAt, null, '#29 sweep leaves distant bookings alone');

    // ── #18 status flow: pending -> confirmed, asserted hop by hop ─────
    const confirmRes = mockRes();
    await updateAppointmentStatus(mockReq({
        user: { role: 'salon', salonId: salon.id },
        params: { appointmentId: String(appointment.id) },
        body: { status: 'confirmed' },
    }), confirmRes);
    assert.equal(confirmRes.statusCode, 200);
    await appointment.reload();
    assert.equal(appointment.status, 'confirmed', 'row transitioned on disk');
    const confirmedNotice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: customerId, type: 'booking.confirmed' },
    }));
    assert.ok(confirmedNotice, 'customer notified of the confirmation');

    // ── Salon completes -> loyalty awarded EXACTLY once (#27) ──────────
    const completeRes = mockRes();
    await updateAppointmentStatus(mockReq({
        user: { role: 'salon', salonId: salon.id },
        params: { appointmentId: String(appointment.id) },
        body: { status: 'completed' },
    }), completeRes);
    assert.equal(completeRes.statusCode, 200);
    await appointment.reload();
    assert.equal(appointment.status, 'completed');
    assert.ok(appointment.pointsAwardedAt, 'claim stamp set inside the successful transition');

    const rewarded = await waitFor(async () => {
        const u = await User.findByPk(customerId);
        return Number(u.loyaltyPoints) === 10 ? u : null;
    });
    assert.ok(rewarded, 'balance reached exactly the flat 10');
    assert.equal(Number(rewarded.lifetimePointsEarned), 10, 'audit counter mirrors it');
    const loyaltyNotice = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: customerId, type: 'loyalty.earned' },
    }));
    assert.ok(loyaltyNotice, 'loyalty.earned notification written');

    // Exactly once: completed is terminal, so a replay is refused and pays nil.
    const replayRes = mockRes();
    await updateAppointmentStatus(mockReq({
        user: { role: 'salon', salonId: salon.id },
        params: { appointmentId: String(appointment.id) },
        body: { status: 'completed' },
    }), replayRes);
    assert.equal(replayRes.statusCode, 400);
    const afterReplay = await User.findByPk(customerId);
    assert.equal(Number(afterReplay.loyaltyPoints), 10, 'no double award via replays');

    // ── Customer reviews; salon replies (#8) ───────────────────────────
    const reviewRes = mockRes();
    await updateCustomerReview(mockReq({
        params: { appointmentId: String(appointment.id) },
        user: { userId: customerId },
        body: { review: 'They handled our whole party beautifully!', rating: 5 },
    }), reviewRes);
    assert.equal(reviewRes.statusCode, 200);
    await appointment.reload();
    assert.equal(appointment.rating, 5);
    assert.equal(appointment.userReview, 'They handled our whole party beautifully!');

    const replyRes = mockRes();
    await replyToReview(mockReq({
        params: { appointmentId: String(appointment.id) },
        user: { role: 'salon', salonId: salon.id },
        body: { reply: 'Thank you — congratulations to the bride!' },
    }), replyRes);
    assert.equal(replyRes.statusCode, 200);
    await appointment.reload();
    assert.equal(appointment.salonReply, 'Thank you — congratulations to the bride!');

    // ── The refreshed avgRating cache now feeds the #22 minRating filter ──
    await salon.reload();
    assert.equal(Number(salon.avgRating), 5, 'denormalized cache recomputed after the review');
    assert.equal(salon.reviewCount, 1);

    const rated = mockRes(); // the SAME filter that missed pre-review now matches
    await getAllSalons(mockReq({ query: { search: 'serene', minRating: 4 } }), rated);
    assert.equal(rated.statusCode, 200);
    assert.deepEqual(idsOf(rated.body), [Number(salon.id)]);

    const strictFive = mockRes();
    await getAllSalons(mockReq({ query: { minRating: 5 } }), strictFive);
    assert.deepEqual(idsOf(strictFive.body), [Number(salon.id)], 'boundary: exactly-5 passes at minRating=5');
});

// ══════════════════════════════ JOURNEY 2 ════════════════════════════════

test('JOURNEY 2 promo + tip economics: promo(#10) -> discounted+tipped payment(#26) -> ledger math -> usedCount once -> cancel frees waitlist(#30) -> CSV PartySize(#9/#25)', async () => {
    // Fresh fixtures for THIS journey so the CSV ledger holds exactly its own row.
    const customer = await User.create({ name: 'Promo Pete', email: 'pete@e2e.com', password: 'x', phoneNumber: '9000000010' });
    const waiter = await User.create({ name: 'Waiting Wren', email: 'wren@e2e.com', password: 'x', phoneNumber: '9000000011' });
    const salon = await Salons.create({
        name: 'E2E Style Bar', email: 'stylebar@e2e.com', password: 'x', phoneNumber: '9000000012',
        address: '22 Discount Drive', pricing: 'Moderate', ...WIDE_HOURS,
        // requiresApproval stays false -> finalize AUTO-CONFIRMS (the other #18 entry point).
    });
    const staff = await Staff.create({ name: 'Stylist Finn', email: 'finn@e2e.com', password: 'x', phoneNumber: '9000000013', salonId: salon.id });
    const service = await Services.create({ name: 'Signature Trim', price: 200, duration: 60, salonId: salon.id });
    await staff.setServices([service]); // /pay enforces staff-service eligibility

    // ── Promo code authored by the salon (#10) ─────────────────────────
    const promoRes = mockRes();
    await createPromo(mockReq({
        user: { role: 'salon', salonId: salon.id },
        body: { code: 'e2e20off', discountType: 'percent', discountValue: 20, usageLimit: 5 },
    }), promoRes);
    assert.equal(promoRes.statusCode, 201);
    const promoBody = plain(promoRes.body);
    assert.equal(promoBody.code, 'E2E20OFF', 'stored canonically uppercase');
    assert.equal(promoBody.usedCount, 0);
    assert.ok(promoBody.id);
    const promo = await PromoCode.findByPk(promoBody.id);

    // ── A waiter queues for that date BEFORE anything is cancelled (#30) ──
    const bookingDate = ymd(daysFromNow(5));
    const joinRes = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: waiter.id },
        body: { salonId: salon.id, date: bookingDate },
    }), joinRes);
    assert.equal(joinRes.statusCode, 201);
    const waitRow = plain(joinRes.body);
    assert.equal(waitRow.status, 'waiting');

    // ── Booking pays with the promo percent discount + a tip (#26) ─────
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: customer.id },
        body: {
            serviceId: service.id, salonId: salon.id, staffId: staff.id,
            dateSelect: bookingDate, time: '11:00', duration: 60,
            promoCode: 'e2e20off', // lowercase on purpose: canonicalized upstream
            tipAmount: 30,
        },
    }), payRes);
    assert.equal(payRes.statusCode, 200);

    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    assert.ok(order, 'pending Payment row persisted');
    assert.equal(order.paymentStatus, 'Pending');
    // Ledger math: 200 original - 40 discount (20%) + 30 tip (added AFTER the
    // discount, never discounted itself) = 190 charged on gateway AND ledger.
    assert.equal(Number(order.originalAmount), 200);
    assert.equal(Number(order.discountAmount), 40);
    assert.equal(order.promoCodeApplied, 'E2E20OFF');
    assert.equal(Number(order.tipAmount), 30);
    assert.equal(Number(order.orderAmount), 190);
    assert.equal(order.tipCaptured, 0, 'flag only flips once the booking finalizes');

    // ── Success -> finalize: auto-confirmed, promo redeemed EXACTLY once ──
    order.paymentStatus = 'Success';
    await order.save();
    const appointment = await finalizeAppointmentFromPayment(order);
    assert.ok(appointment && appointment.id);
    await appointment.reload();
    assert.equal(appointment.status, 'confirmed', 'no approval required -> auto-confirm branch');

    await promo.reload();
    assert.equal(promo.usedCount, 1, 'redeemed once for this booking');
    await order.reload();
    assert.equal(order.tipCaptured, 1, 'tip flag flips on finalization');

    // Replay (redirect + webhook firing again): idempotent, no double-count.
    const replayed = await finalizeAppointmentFromPayment(order);
    assert.equal(Number(replayed.id), Number(appointment.id));
    await promo.reload();
    assert.equal(promo.usedCount, 1, 'replays never double-redeem');
    const bookings = await Appointment.count({ where: { orderId: order.orderId } });
    assert.equal(bookings, 1, 'and never duplicate the booking');

    // ── Cancel >24h out succeeds; the freed slot auto-notifies the waiter ──
    const cancelRes = mockRes();
    await cancelAppointment(mockReq({
        params: { appointmentId: String(appointment.id) },
        user: { userId: customer.id },
    }), cancelRes);
    assert.equal(cancelRes.statusCode, 200);
    await appointment.reload();
    assert.equal(appointment.status, 'cancelled', 'row transitioned on disk');

    const claimed = await waitFor(() => Waitlist.findByPk(waitRow.id).then((r) => (r.status === 'notified' ? r : null)));
    assert.ok(claimed, 'oldest fitting waiter flipped to notified');
    assert.ok(claimed.notifiedAt, 'notifiedAt stamped');
    const opening = await waitFor(() => Notification.findOne({
        where: { recipientRole: 'customer', recipientId: waiter.id, type: 'waitlist.opening' },
    }));
    assert.ok(opening, 'in-app opening alert written for the waiter');
    assert.match(opening.body, new RegExp(salon.name));

    // ── CSV export carries the ledger incl. the PartySize column (#9/#25) ──
    const csvRes = mockRes();
    await exportAppointmentsCsv(mockReq({ user: { role: 'salon', salonId: salon.id }, query: {} }), csvRes);
    assert.equal(csvRes.statusCode, 200);
    assert.equal(csvRes.headers['Content-Type'], 'text/csv; charset=utf-8');

    const lines = csvRes.body.split('\r\n').filter((l) => l !== '');
    const header = lines[0].split(',');
    assert.equal(header.indexOf('PartySize'), header.indexOf('Status') + 1, 'PartySize sits right after Status');
    assert.equal(lines.length, 2, 'exactly this journey\'s booking exports');

    const row = lines[1].split(',');
    assert.equal(row[header.indexOf('AppointmentID')], String(appointment.id));
    assert.equal(row[header.indexOf('Date')], bookingDate);
    assert.equal(row[header.indexOf('Status')], 'cancelled');
    assert.equal(row[header.indexOf('PartySize')], '1');
    assert.equal(row[header.indexOf('Service')], service.name);
    assert.equal(row[header.indexOf('Staff')], staff.name);
    assert.equal(row[header.indexOf('Customer')], customer.name);
});

// ══════════════════════════════ JOURNEY 3 ════════════════════════════════

test('JOURNEY 3 lifecycle edges: referral chain(+100 both,#28) -> waitlist dup-guard(#30) -> upcoming listing(#29) -> GDPR self-deletion(#32)', async () => {
    // Salon fixtures for the referred user's booking (auto-confirm salon).
    const salon = await Salons.create({
        name: 'E2E Referral Retreat', email: 'retreat@e2e.com', password: 'x', phoneNumber: '9000000020',
        address: '9 Welcome Way', pricing: 'Affordable', ...WIDE_HOURS,
    });
    const staff = await Staff.create({ name: 'Stylist Gia', email: 'gia@e2e.com', password: 'x', phoneNumber: '9000000021', salonId: salon.id });
    const service = await Services.create({ name: 'New Client Cut', price: 80, duration: 30, salonId: salon.id });
    await staff.setServices([service]); // /pay enforces staff-service eligibility

    // ── Referral signup chain (#28): referrer exists with a personal code ──
    const referrer = await User.create({ name: 'Rita Referrer', email: 'rita@e2e.com', password: 'x', phoneNumber: '9000000022' });
    assert.equal(referrer.referralCode, null, 'codes are lazy, never minted at creation');
    const code = await ensureReferralCode(referrer);
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);

    const signupRes = mockRes();
    await handleUserSignup(mockReq({
        body: {
            name: 'Nina Newbie',
            email: 'nina@e2e.com',
            password: 'password123',
            phoneNumber: '9000000023',
            referralCode: code.toLowerCase(), // canonicalization must not break the link
        },
    }), signupRes);
    assert.equal(signupRes.statusCode, 201);
    const ninaId = signupRes.body.userId;
    const nina = await User.findByPk(ninaId);
    assert.equal(Number(nina.referredByUserId), Number(referrer.id), 'new row points at the code owner');

    // Both sides credited +100 exactly (fire-and-forget bonus, polled).
    const bothPaid = await waitFor(async () => {
        await referrer.reload();
        await nina.reload();
        return Number(referrer.loyaltyPoints) === 100 && Number(nina.loyaltyPoints) === 100;
    });
    assert.ok(bothPaid, 'both balances reach exactly 100');
    assert.equal(Number(referrer.lifetimePointsEarned), 100);
    assert.equal(Number(nina.lifetimePointsEarned), 100);
    const bonuses = await waitFor(() => Notification.findAll({ where: { type: 'referral.bonus' } })
        .then((rows) => (rows.length === 2 ? rows : null)));
    assert.ok(bonuses, 'referrer and referred each notified once');

    // ── Waitlist duplicate guard (#30) ─────────────────────────────────
    const wlDate = ymd(daysFromNow(4));
    const join1 = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: ninaId },
        body: { salonId: salon.id, date: wlDate },
    }), join1);
    assert.equal(join1.statusCode, 201);
    const wlRow = plain(join1.body);
    assert.equal(wlRow.status, 'waiting');

    const join2 = mockRes();
    await joinWaitlist(mockReq({
        user: { role: 'customer', userId: ninaId },
        body: { salonId: salon.id, date: wlDate },
    }), join2);
    assert.equal(join2.statusCode, 409);
    assert.equal(join2.body.message, 'Already on the waitlist');
    assert.equal(await Waitlist.count({ where: { userId: ninaId, salonId: salon.id, date: wlDate } }), 1,
        'the duplicate join wrote nothing');

    // ── Upcoming listing (#29): empty pre-booking; shows the confirmed future trip ──
    const before = mockRes();
    await getUpcomingAppointments(mockReq({ user: { userId: ninaId, role: 'customer' } }), before);
    assert.equal(before.statusCode, 200);
    assert.deepEqual(before.body, [], 'fresh account has nothing upcoming');

    const bookingDate = ymd(daysFromNow(3));
    const payRes = mockRes();
    await processPayment(mockPayReq({
        user: { userId: ninaId },
        body: {
            serviceId: service.id, salonId: salon.id, staffId: staff.id,
            dateSelect: bookingDate, time: '12:00', duration: 30,
        },
    }), payRes);
    assert.equal(payRes.statusCode, 200);
    const order = await Payment.findOne({ where: { orderId: payRes.body.orderId } });
    order.paymentStatus = 'Success';
    await order.save();
    const appointment = await finalizeAppointmentFromPayment(order);
    assert.ok(appointment && appointment.id);
    await appointment.reload();
    assert.equal(appointment.status, 'confirmed');

    const after = mockRes();
    await getUpcomingAppointments(mockReq({ user: { userId: ninaId, role: 'customer' } }), after);
    assert.equal(after.statusCode, 200);
    assert.ok(Array.isArray(after.body));
    assert.deepEqual(after.body.map((r) => Number(r.id)), [Number(appointment.id)],
        'exactly their future confirmed booking, soonest-first');
    assert.equal(after.body[0].status, 'confirmed');
    assert.equal(after.body[0].date, bookingDate);

    // ── GDPR account self-deletion (#32) ───────────────────────────────
    // Wrong password: 401 and NOTHING is touched.
    const wrongRes = mockRes();
    await deleteMyAccount(mockReq({
        user: { userId: ninaId, role: 'customer' },
        body: { password: 'totallyWrong9' },
    }), wrongRes);
    assert.equal(wrongRes.statusCode, 401);
    assert.equal(wrongRes.body.error, 'Incorrect password');
    await nina.reload();
    assert.equal(nina.email, 'nina@e2e.com', 'identity untouched by the failed attempt');
    await appointment.reload();
    assert.equal(appointment.status, 'confirmed', 'no cancellations on a failed re-auth');
    assert.equal(await AdminAudit.count({ where: { targetId: String(ninaId) } }), 0, 'no audit row either');

    // Correct password: anonymize in place, cancel future bookings, audit lands.
    const okRes = mockRes();
    await deleteMyAccount(mockReq({
        user: { userId: ninaId, role: 'customer' },
        body: { password: 'password123' },
    }), okRes);
    assert.equal(okRes.statusCode, 200);
    assert.deepEqual(Object.keys(okRes.body), ['message'], 'generic confirmation carries no internals');
    assert.equal(okRes.body.message, 'Your account has been deleted.');

    await nina.reload();
    assert.equal(nina.email, `deleted+${ninaId}@anonymized.local`, 'email scrubbed in place');
    assert.equal(nina.name, 'Deleted');
    assert.equal(Number(nina.loyaltyPoints), 0, 'ledger zeroed');
    assert.equal(nina.referralCode, null, 'personal code freed');

    await appointment.reload();
    assert.equal(appointment.status, 'cancelled', 'future booking bulk-cancelled');

    const wlAfter = await Waitlist.findByPk(wlRow.id);
    assert.equal(wlAfter.status, 'left', 'waitlist entry soft-left, row kept');

    const audit = await waitFor(() => AdminAudit.findOne({
        where: { action: 'account.self_delete', targetId: String(ninaId) },
    }));
    assert.ok(audit, 'audit row recorded asynchronously');
    assert.equal(audit.targetType, 'user');
    assert.equal(audit.details.includes('nina@e2e.com'), false, 'no personal data in the log');
    assert.equal(audit.details.includes('Nina'), false);

    // Chained back into #29: the cancelled booking no longer shows as upcoming.
    const post = mockRes();
    await getUpcomingAppointments(mockReq({ user: { userId: ninaId, role: 'customer' } }), post);
    assert.deepEqual(post.body, [], 'cancelled-by-deletion booking left the upcoming list');
});
