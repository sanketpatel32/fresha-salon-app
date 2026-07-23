const router = require('express').Router();
const salonServices = require('../controllers/salonServicesController');
const authMiddleware = require('../middlewares/authMiddleware');
const salonStaff = require('../controllers/salonStaffController');
const {
  validate,
  serviceAddSchema,
  serviceUpdateSchema,
  staffAddSchema,
  staffUpdateStatusSchema,
  staffAssignServicesSchema,
} = require('../utils/validators');

// The dead res.sendFile HTML routes are removed — the SPA serves all views.
// Every endpoint here is a salon-owner console action, so all require a valid
// salon token. Individual controllers enforce per-salon ownership where needed.
const salonOnly = [authMiddleware, authMiddleware.requireRole('salon')];

// Services catalog
router.post('/services/add', salonOnly, validate(serviceAddSchema), salonServices.addService);
router.get('/services/getall', salonOnly, salonServices.getAllServices);
router.get('/services/get/:id', salonOnly, salonServices.getServiceById);
router.put('/services/update/:id', salonOnly, validate(serviceUpdateSchema), salonServices.updateService);
router.delete('/services/delete/:id', salonOnly, salonServices.deleteService);

// Staff management
router.post('/staff/add', salonOnly, validate(staffAddSchema), salonStaff.addStaff);
router.get('/staff/getallstaff', salonOnly, salonStaff.getStaff);
router.get('/staff/getStaff', salonOnly, salonStaff.getStaffById);
router.put('/staff/assignServices', salonOnly, validate(staffAssignServicesSchema), salonStaff.assignServices);
router.put('/staff/updateStatus', salonOnly, validate(staffUpdateStatusSchema), salonStaff.updateStatus);

// Staff blockouts
router.post('/staff/blockouts', salonOnly, salonStaff.addBlockout);
router.get('/staff/blockouts', salonOnly, salonStaff.getBlockouts);
router.delete('/staff/blockouts/:id', salonOnly, salonStaff.removeBlockout);

module.exports = router;
