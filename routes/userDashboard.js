const router = require('express').Router();
const path = require('path');
const salonServices = require('../controllers/salonServicesController');
router.get('/',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','user' ,'dashboard.html'));
})

router.get('/salonservices',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','user' ,'salonservices.html'));
})

router.get('/getAllActiveServicesBySalonId',salonServices.getAllActiveServicesBySalonId)

router.get('/appointmentPage', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'user', 'appointmentPage.html'));
});
module.exports = router;