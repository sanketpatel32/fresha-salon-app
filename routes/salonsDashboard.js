const router = require('express').Router();
const path = require('path');
const salonServices = require('../controllers/salonServicesController');
const authMiddleware = require('../middlewares/authMiddleware');
router.get('/',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','salons' ,'dashboard.html'));
})
router.get('/services/add',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','salons' ,'addServices.html'));
})
router.post('/services/add',authMiddleware, salonServices.addService);

router.get('/services/modify',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','salons' ,'modifyServices.html'));
})

module.exports = router;