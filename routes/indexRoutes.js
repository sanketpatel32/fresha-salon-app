const express = require('express');
const router = express.Router();
const path = require('path');
// baseroutes 
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});

// admin routes
router.get('/admin/dashboard', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../views/admin/index.html'));
});

router.get('/admin/appointments', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../views/admin/appointments.html'));
});

router.get('/admin/users', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../views/admin/user.html'));
});

//business routes
router.get('buisness/signup', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'signup.html'));
});

router.get('buisness/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'login.html'));
});

// salon routes
router.get('/salonsdashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'dashboard.html'));
})


router.get('/salonsdashboard/services/add', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'addServices.html'));
})

router.get('/salonsdashboard/services/modify', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'modifyServices.html'));
})

router.get('/salonsdashboard/services/modifyForm', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'modifyForm.html'));
});

router.get('/salonsdashboard/staff/add', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'addStaff.html'));
})

router.get('/salonsdashboard/staff/assignStaff', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'assignStaffService.html'));
})
router.get('/salonsdashboard/staff/staffModifyForm', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'staffModifyForm.html'));
});

router.get('/salonsdashboard/managament/changeSalonDetail', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'changeSalonDetail.html'));
});

router.get('/salonsdashboard/managament/salonSceduledAppointments', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'salons', 'salonSceduledAppointments.html'));
});

// staff routes

router.get('/staff/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','staff' ,'login.html'));
});


router.get('/staff/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','staff' ,'dashboard.html'));
});

// user dashboard routes

router.get('/userdashboard',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','user' ,'dashboard.html'));
})

router.get('/userdashboard/salonservices',(req,res)=>{
    res.sendFile(path.join(__dirname, '..', 'views','user' ,'salonservices.html'));
})


router.get('/userdashboard/appointmentPage', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'user', 'appointmentPage.html'));
});

router.get('/userdashboard/bookedAppointments', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'user', 'bookedAppointments.html'));
}
);

// user routes
router.get('/user/signup', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views','user' ,'signup.html'));
});

router.get('/user/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','user' ,'login.html'));
});

router.get('/user/edit', (req, res) => {
    res.sendFile(path.join(__dirname, '..','views','user' ,'editProfile.html'));
});


module.exports = router;