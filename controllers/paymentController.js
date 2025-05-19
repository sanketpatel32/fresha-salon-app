const path = require("path");
const {
  createOrder,
  getPaymentStatus,
} = require("../services/cashfreeServices");
const Payment = require("../models/paymentModel");
const userModel = require("../models/userModel");
const appointmentModel = require("../models/appointmentModel");

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
    startDate.setHours(hours, minutes, 0); 
    const endDate = new Date(startDate.getTime() + req.body.duration * 60 * 1000); 
    const endTime = endDate.toTimeString().slice(0, 5);


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
        await appointmentModel.create({
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

    // Generate the HTML response with additional details
    const htmlResponse = `
      <html>
        <head>
          <title>Payment Status</title>
        </head>
        <body>
          <div style="text-align: center; font-family: Arial, sans-serif; margin: 20px;">
            <h1 style="color: #4CAF50;">Payment Status</h1>
            <p style="font-size: 18px;">Your payment was processed successfully!</p>
            <table border="1" cellpadding="10" cellspacing="0" style="margin: 20px auto; border-collapse: collapse; font-size: 16px;">
              <tr>
                <th style="text-align: left;">Payment Status:</th>
                <td><strong>${order.paymentStatus}</strong></td>
              </tr>
              <tr>
                <th style="text-align: left;">Order ID:</th>
                <td>${order.orderId}</td>
              </tr>
              <tr>
                <th style="text-align: left;">Amount:</th>
                <td>₹${order.orderAmount}</td>
              </tr>
              <tr>
                <th style="text-align: left;">Appointment Date:</th>
                <td>${order.dateSelected}</td>
              </tr>
              <tr>
                <th style="text-align: left;">Appointment Time:</th>
                <td>${order.timeSelected} - ${order.endTime}</td>
              </tr>
            </table>
            <a href="/userdashboard" style="text-decoration: none; font-size: 18px; color: #007BFF;">Go to Dashboard</a>
            <br><br>
            <button onclick="sendEmailNotification()" style="font-size: 16px; padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer;">Email Notification</button>
            <p style="margin-top: 20px; font-size: 16px;">Thank you for your payment!<br>We appreciate your business.</p>
          </div>
          <script>
            function sendEmailNotification() {
              fetch('http://localhost:3000/api/appointment/mail', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ orderId: '${order.orderId}' })
              })
              .then(response => response.json())
              .then(data => {
                alert(data.message || 'Email notification sent successfully!');
              })
              .catch(error => {
                console.error('Error sending email notification:', error);
                alert('Failed to send email notification.');
              });
            }
          </script>
        </body>
      </html>
    `;

    res.send(htmlResponse); // Send the HTML response
  } catch (error) {
    console.error("Error fetching payment status:", error.message);
    res.status(500).json({ message: "Error fetching payment status" });
  }
};
