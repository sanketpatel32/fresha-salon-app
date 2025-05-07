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

router.get('/services/getall',authMiddleware, salonServices.getAllServices);
router.get('/services/modifyForm', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'modifyForm.html'));
});

router.get('/services/get/:id', authMiddleware, salonServices.getServiceById);
router.put('/services/update/:id', authMiddleware, salonServices.updateService);
router.delete('/services/delete/:id', authMiddleware, salonServices.deleteService);
module.exports = router;