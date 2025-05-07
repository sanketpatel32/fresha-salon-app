// routes/auth.js
const express = require('express');
const path = require('path');
const router = express.Router();
const salonController = require('../controllers/salonController');

router.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views','salons' ,'signup.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','salons' ,'login.html'));
});

router.post('/signup', salonController.salonSignup);
router.post('/login', salonController.salonLogin);

module.exports = router;
