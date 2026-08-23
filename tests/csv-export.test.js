const { test, before, after } = require('node:test');
const assert = require('node:assert');
const sequelize = require('../utils/database');
require('../models/associations'); // wire associations
const Appointment = require('../models/appointmentModel');
const User = require('../models/userModel');
const Salons = require('../models/salonsModel');
const Staff = require('../models/staffModel');
const Services = require('../models/servicesModel');
const { toCsv } = require('../utils/csv');
const { validate, csvExportSchema } = require('../utils/validators');
const { exportAppointmentsCsv } = require('../controllers/appointmentController');

// Minimal req/res stubs for invoking the controller directly.
const mockReq = (overrides = {}) => ({ user: {}, query: {}, ...overrides });
const mockRes = () => {
    const r = { statusCode: 200, body: null, headers: {} };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (data) => { r.body = data; return r; };
    r.setHeader = (name, value) => { r.headers[name] = value; return r; };
    r.send = (data) => { r.body = data; return r; };
    return r;
};

// ── toCsv unit tests (pure util) ─────────────────────────────────────────

test('toCsv writes header plus a plain row without any quoting', () => {
    const csv = toCsv(
        [{ a: 1, b: 'plain' }],
        [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]
    );
    assert.equal(csv, 'A,B\r\n1,plain\r\n');
});

test('toCsv escapes commas, doubles embedded quotes, keeps newlines inside quotes', () => {
    const csv = toCsv(
        [{ note: 'He said "hi", then left', multi: 'line1\nline2' }],
        [{ key: 'note', label: 'Note' }, { key: 'multi', label: 'Multi' }]
    );
    assert.equal(csv, 'Note,Multi\r\n"He said ""hi"", then left","line1\nline2"\r\n');
});

test('toCsv terminates every line with CRLF and never emits bare LF', () => {
    const csv = toCsv([{ a: 1 }, { a: 2 }], [{ key: 'a', label: 'A' }]);
    assert.ok(csv.endsWith('\r\n'), 'output ends with CRLF');
    assert.ok(!/[^\r]\n/.test(csv), 'no LF appears without a preceding CR');
    assert.equal(csv.split('\r\n').filter((l) => l !== '').length, 3);
});

test('toCsv renders null/undefined fields as empty strings', () => {
    const csv = toCsv(
        [{ a: null, b: undefined }],
        [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]
    );
    assert.equal(csv, 'A,B\r\n,\r\n');
});

// ── Controller tests (direct invocation, SQLite fixtures) ────────────────

let salonA, salonB;
let apptMarchEarly, apptMidMorning, apptMidAfternoon, apptApril, apptOtherSalon;

before(async () => {
    await sequelize.sync({ force: true });

    const openAllWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    salonA = await Salons.create({
        name: 'SalonA', email: 'sa@t.com', password: 'x', phoneNumber: '3',
        address: 'a', pricing: 'Moderate',
        workingDays: openAllWeek, openingTime: '08:00', closingTime: '20:00',
    });
    salonB = await Salons.create({
        name: 'SalonB', email: 'sb@t.com', password: 'x', phoneNumber: '4',
        address: 'b', pricing: 'Premium',
        workingDays: openAllWeek, openingTime: '08:00', closingTime: '20:00',
    });

    const staffA = await Staff.create({ name: 'StylistA', email: 'sta@t.com', password: 'x', phoneNumber: '5', salonId: salonA.id });
    const staffB = await Staff.create({ name: 'StylistB', email: 'stb@t.com', password: 'x', phoneNumber: '6', salonId: salonB.id });
    const serviceA = await Services.create({ name: 'Signature Cut', price: 100, duration: 30, salonId: salonA.id });
    const serviceB = await Services.create({ name: 'Other-Salon-Facial', price: 80, duration: 45, salonId: salonB.id });

    // One customer with a plain name and one whose name forces RFC-4180
    // quoting end-to-end through the controller.
    const custPlain = await User.create({ name: 'Plain Jane', email: 'pj@t.com', password: 'x', phoneNumber: '7' });
    const custSpecial = await User.create({ name: 'Jane "Doe", Jr.', email: 'jd@t.com', password: 'x', phoneNumber: '8' });

    const booking = (salon, staff, service, user, date, time, endTime, status) =>
        Appointment.create({
            staffId: staff.id, salonId: salon.id, serviceId: service.id, userId: user.id,
            date, time, endTime, status,
        });

    // Salon A ledger: 4 bookings — two share 2026-03-10 to prove time ASC tiebreak.
    apptMarchEarly = await booking(salonA, staffA, serviceA, custPlain, '2026-03-02', '09:00', '09:30', 'confirmed');
    apptMidMorning = await booking(salonA, staffA, serviceA, custSpecial, '2026-03-10', '08:00', '08:30', 'pending');
    apptMidAfternoon = await booking(salonA, staffA, serviceA, custPlain, '2026-03-10', '13:30', '14:00', 'completed');
    apptApril = await booking(salonA, staffA, serviceA, custPlain, '2026-04-01', '10:00', '10:30', 'confirmed');
    // Belongs to the other tenant — must never leak into salon A's export.
    apptOtherSalon = await booking(salonB, staffB, serviceB, custPlain, '2026-03-10', '11:00', '11:45', 'confirmed');
});

after(async () => { await sequelize.close(); });

test('export returns text/csv attachment with header row, correct count, scoped to own salon only', async () => {
    const req = mockReq({ user: { salonId: salonA.id }, query: {} });
    const res = mockRes();
    await exportAppointmentsCsv(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.match(
        res.headers['Content-Disposition'],
        new RegExp(`^attachment; filename="appointments-${salonA.id}-\\d{8}\\.csv"$`)
    );

    const lines = res.body.split('\r\n').filter((l) => l !== '');
    // PartySize added after Status in iteration #25 (group bookings).
    assert.equal(lines[0], 'AppointmentID,Date,Time,EndTime,Status,PartySize,Service,Staff,Customer');
    // Exactly salon A's four bookings — no pagination cap.
    assert.equal(lines.length - 1, 4);

    const body = res.body;
    assert.ok(body.includes('"Jane ""Doe"", Jr."'), 'special-char customer name is quoted correctly');
    assert.ok(body.includes('Signature Cut'));
    assert.ok(body.includes('StylistA'));
    // Other salon's data must be absent.
    assert.ok(!body.includes('Other-Salon-Facial'));
    assert.ok(!body.includes('StylistB'));

    // Ordering: date ASC, then time ASC for same-day rows.
    const rows = lines.slice(1).map((l) => l.split(','));
    const dates = rows.map((c) => c[1]);
    assert.deepEqual(dates, [...dates].sort());
    const midMorningRow = rows.find((c) => c[0] === String(apptMidMorning.id));
    const midAfternoonRow = rows.find((c) => c[0] === String(apptMidAfternoon.id));
    assert.ok(rows.indexOf(midMorningRow) < rows.indexOf(midAfternoonRow), '08:00 row precedes 13:30 row');
});

test('date range filter (from & to) returns only in-window rows', async () => {
    const req = mockReq({ user: { salonId: salonA.id }, query: { from: '2026-03-01', to: '2026-03-31' } });
    const res = mockRes();
    await exportAppointmentsCsv(req, res);

    assert.equal(res.statusCode, 200);
    const lines = res.body.split('\r\n').filter((l) => l !== '');
    const dates = lines.slice(1).map((l) => l.split(',')[1]);
    assert.equal(dates.length, 3); // April booking excluded
    assert.ok(dates.every((d) => d >= '2026-03-01' && d <= '2026-03-31'));
    const ids = lines.slice(1).map((l) => l.split(',')[0]);
    assert.ok(!ids.includes(String(apptApril.id)));
});

test('single-bound filters work (to-only excludes later bookings)', async () => {
    const req = mockReq({ user: { salonId: salonA.id }, query: { to: '2026-03-02' } });
    const res = mockRes();
    await exportAppointmentsCsv(req, res);

    assert.equal(res.statusCode, 200);
    const lines = res.body.split('\r\n').filter((l) => l !== '');
    assert.equal(lines.length - 1, 1);
    assert.equal(lines[1].split(',')[0], String(apptMarchEarly.id));
});

test('validate(csvExportSchema) middleware rejects from>to and malformed dates with 400', () => {
    const runMw = (query) => {
        let err = null;
        let ok = false;
        validate(csvExportSchema, 'query')({ query }, {}, (e) => {
            if (e) err = e; else ok = true;
        });
        return { err, ok };
    };

    const inverted = runMw({ from: '2026-03-10', to: '2026-03-01' });
    assert.equal(inverted.ok, false);
    assert.equal(inverted.err.status, 400);
    assert.match(inverted.err.message, /from must be on or before to/);

    const malformed = runMw({ from: '03/10/2026' });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.err.status, 400);

    // Happy path: empty query passes; valid bounds pass through parsed values.
    assert.ok(runMw({}).ok);
    const good = { query: { from: '2026-03-01', to: '2026-03-31' } };
    let passed = false;
    validate(csvExportSchema, 'query')(good, {}, () => { passed = true; });
    assert.ok(passed);
    assert.deepEqual(good.query, { from: '2026-03-01', to: '2026-03-31' });
});
