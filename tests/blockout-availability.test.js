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
