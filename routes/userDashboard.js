const router = require('express').Router();
const path = require('path');

router.get('/',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','user' ,'dashboard.html'));
})

router.get('/salonservices',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','user' ,'salonservices.html'));
})

module.exports = router;