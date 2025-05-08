// routes/auth.js
const express = require('express');
const path = require('path');
const router = express.Router();
const salonController = require('../controllers/salonController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views','salons' ,'signup.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','salons' ,'login.html'));
});

router.post('/signup', salonController.salonSignup);
router.post('/login', salonController.salonLogin);
router.get('/getall', salonController.getAllSalons);
router.get('/getsalonbyId', salonController.getSalonById);
router.get('/getsalonbyIdSalonId',authMiddleware, salonController.getSalonBySalonId)
router.put('/changeSalonDetail', authMiddleware, salonController.updateSalonDetails);
module.exports = router;
