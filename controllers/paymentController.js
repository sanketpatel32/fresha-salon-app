const path = require("path");
const {
  createOrder,
  getPaymentStatus,
} = require("../services/cashfreeServices");
const Payment = require("../models/paymentModel");
const userModel = require("../models/userModel");
const appointmentModel = require("../models/appointmentModel");
const { endianness } = require("os");
// const TemplateGenerator = require("../Template/htmltemp");



exports.processPayment = async (req, res) => {

  const userId = req.user.userId;
  console.log(req.body);
  const userDetails = await userModel.findOne({ where: { id: userId } });


  const orderId = "ORDER-" + Date.now();
  const orderAmount = req.body.servicePrice; // Assuming you get the service price from the request body
  const orderCurrency = "INR";
  const customerID = userId.toString();
  const customerPhone = userDetails.phoneNumber; // Assuming you get the phone number from the user details

  try {

    //* Create an order in Cashfree and get the payment session ID
    const paymentSessionId = await createOrder(
      orderId,
      orderAmount,
      orderCurrency,
      customerID,
      customerPhone,
    );
    const [hours, minutes] = req.body.time.split(":").map(Number);
    const startDate = new Date();
    startDate.setHours(hours, minutes, 0); // Set the time to timeSelected
    const endDate = new Date(startDate.getTime() + req.body.duration * 60 * 1000); // Add duration in milliseconds
    const endTime = endDate.toTimeString().slice(0, 5); // Format as "HH:mm"


    //* Save payment details to the database
    try {
      await Payment.create({
        orderId,
        paymentSessionId,
        orderAmount,
        orderCurrency,
        paymentStatus: "Pending",
        customerID: userId,
        dateSelected: req.body.dateSelect,
        timeSelected: req.body.time,
        staffId: req.body.staffId,
        serviceId: req.body.serviceId,
        salonId: req.body.salonId,
        duration: req.body.duration,
        endTime: endTime
      });
    } catch (error) {
      console.error("Error saving payment:", error.message);
    }

    res.json({ paymentSessionId, orderId });
  } catch (error) {
    console.error("Error processing payment:", error.message);
    res.status(500).json({ message: "Error processing payment" });
  }
};

exports.getPaymentStatus_ = async (req, res) => {
  const orderId = req.params.orderId;

  try {
    const orderStatus = await getPaymentStatus(orderId);

    // Update payment status in the database

    const order = await Payment.findOne({ where: { orderId } });
    // console.log("Order:", order); // Log the order for debugging
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    // Update the order's status

    order.paymentStatus = orderStatus;

    await order.save();
    if (orderStatus === "Success") {
      // Update the user's balance or perform any other necessary actions here
      const paymentDetails = await Payment.findOne({ where: { orderId } });
      try {
        appointmentModel.create({
          staffId: paymentDetails.staffId,
          salonId: paymentDetails.salonId,
          serviceId: paymentDetails.serviceId,
          userId: paymentDetails.customerID,
          date: paymentDetails.dateSelected,
          time: paymentDetails.timeSelected,
          endTime: paymentDetails.endTime,
        });
      } catch (error) {
        console.error("Error saving appointment:", error.message);
      }

    }
    // const htmlTemp = TemplateGenerator(order.orderId, orderStatus, order.orderAmount)
    const htmlResponse = `
    <html>
      <head>
        <title>Payment Status</title>
      </head>
      <body>
        <h1>Payment Status</h1>
        <p>Order ID: ${order.orderId}</p>
        <p>Status: ${order.paymentStatus}</p>
        <p>Amount: ${order.orderAmount}</p>
                  <a href="/api/userdashboard">Go to Dashboard</a> 
      </body>
    </html>
  `;
    res.send(htmlResponse); // Send the HTML response

  } catch (error) {
    console.error("Error fetching payment status:", error.message);
    res.status(500).json({ message: "Error fetching payment status" });
  }
};


