
// const token = localStorage.getItem("token");
const cashfree = Cashfree({
    mode: "sandbox",
  });
  
  document.getElementById("renderBtn").addEventListener("click", async () => {
  try {
    
    // Fetch payment session ID from backend
    const response = await axios.post("http://localhost:3000/pay/",{}, {
      headers: { Authorization: `Bearer ${token}` }
  });
    // console.log(data)
    const data = response.data;
    const paymentSessionId = data.paymentSessionId;
    const orderId = data.orderId;
  
    // Initialize checkout options
    let checkoutOptions = {
        paymentSessionId: paymentSessionId,
      
      //? Modal payment options
        redirectTarget: "_self",
    };
  
    // Start the checkout process
    const result = await cashfree.checkout(checkoutOptions);
  
    if(result.error){
  console.log("User has closed the popup or there is some payment error, Check for Payment Status");
        console.log(result.error);
    }
    if(result.redirect){
        console.log("Payment will be redirected");
    }
    if (result.paymentDetails) {
      // This will be called whenever the payment is completed irrespective of transaction status
      console.log("Payment has been completed, Check for Payment Status");
      
      try {
        const response = await axios.get(`http://localhost:3000/pay/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` }
      });
        const data = response.data;
        alert("Your payment is " + data.orderStatus);
    
      } catch (err) {
        console.error("Error fetching payment status:", err);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
  });