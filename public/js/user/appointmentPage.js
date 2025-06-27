const baseurl = "https://fresha-salon-app.onrender.com/api"; // Define the base URL

document.addEventListener("DOMContentLoaded", async () => {
    const dateSelect = document.getElementById("date");
    const timeSelect = document.getElementById("time");
    const messageDiv = document.getElementById("message");
    const staffContainer = document.getElementById("staff-container");
    const payNowButton = document.getElementById("pay-now");

    // Populate date and time dropdowns based on salon working days and service duration
    const populateDateAndTimeDropdowns = async () => {
        try {
            const salonId = JSON.parse(localStorage.getItem("salonId"));
            const salonResponse = await axios.get(`${baseurl}/buisness/getSalonById?salonId=${salonId}`);
            const salon = salonResponse.data;

            const today = new Date();
            const workingDays = salon.workingDays;
            const nextWorkingDays = [];
            let currentDate = new Date(today);

            while (nextWorkingDays.length < 5) {
                currentDate.setDate(currentDate.getDate() + 1);
                const dayName = currentDate.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
                if (workingDays.includes(dayName)) {
                    nextWorkingDays.push(new Date(currentDate));
                }
            }

            nextWorkingDays.forEach((date) => {
                const option = document.createElement("option");
                option.value = date.toISOString().split("T")[0];
                option.textContent = date.toDateString();
                dateSelect.appendChild(option);
            });

            // Generate time slots based on service duration
            const openingTime = salon.openingTime; // e.g., 9
            const closingTime = salon.closingTime; // e.g., 18
            const serviceDuration = parseInt(localStorage.getItem("serviceDuration")) || 30; // in minutes

            timeSelect.innerHTML = "";
            for (
                let hour = openingTime, minute = 0;
                hour < closingTime || (hour === closingTime && minute === 0);
            ) {
                const formattedHour = hour.toString().padStart(2, "0");
                const formattedMinute = minute.toString().padStart(2, "0");
                const timeValue = `${formattedHour}:${formattedMinute}`;

                // Only add slots that fit within closing time
                const endMinutes = hour * 60 + minute + serviceDuration;
                if (endMinutes <= closingTime * 60) {
                    const option = document.createElement("option");
                    option.value = timeValue;
                    option.textContent = timeValue;
                    timeSelect.appendChild(option);
                }

                minute += serviceDuration;
                if (minute >= 60) {
                    hour += Math.floor(minute / 60);
                    minute = minute % 60;
                }
            }
        } catch (error) {
            console.error("Error populating date and time dropdowns:", error);
        }
    };

    await populateDateAndTimeDropdowns();

    const form = document.getElementById("appointment-form");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const selectedDate = dateSelect.value;
        const selectedTime = timeSelect.value;

        try {
            const FormData = {
                dateSelect: selectedDate,
                time: selectedTime,
                salonId: JSON.parse(localStorage.getItem("salonId")),
                serviceId: JSON.parse(localStorage.getItem("serviceId")),
                serviceName: localStorage.getItem("serviceName"),
                servicePrice: localStorage.getItem("servicePrice"),
                serviceDuration: localStorage.getItem("serviceDuration"),
                duration: 30,
            };
            console.log("Form Data:", FormData);
            const response = await axios.post(`${baseurl}/appointment/check`, FormData);
            const staffList = response.data;

            if (staffList.length > 0) {
                messageDiv.textContent = "You can book an appointment.";
                messageDiv.style.color = "green";

                staffContainer.innerHTML = "";
                staffList.forEach((staff) => {
                    const staffCard = document.createElement("div");
                    staffCard.classList.add("staff-card");
                    staffCard.innerHTML = `
                        <p><strong>Name:</strong> ${staff.name}</p>
                        <p><strong>Phone:</strong> ${staff.phoneNumber}</p>
                        <input type="radio" name="staff" value="${staff.id}" />
                    `;
                    staffContainer.appendChild(staffCard);
                });

                payNowButton.style.display = "block";

                payNowButton.onclick = async () => {
                    const selectedStaff = document.querySelector('input[name="staff"]:checked');
                    if (!selectedStaff) {
                        alert("Please select a staff member before proceeding.");
                        return;
                    }

                    const paymentData = {
                        ...FormData,
                        staffId: selectedStaff.value,
                    };

                    console.log("Payment Data:", paymentData);

                    try {
                        const token = localStorage.getItem("token");
                        const response = await axios.post(`${baseurl}/pay`, paymentData, {
                            headers: {
                                Authorization: `Bearer ${token}`
                            }
                        });
                        const data = response.data;
                        const paymentSessionId = data.paymentSessionId;
                        const orderId = data.orderId;

                        const cashfree = Cashfree({ mode: "sandbox" });
                        const checkoutOptions = {
                            paymentSessionId: paymentSessionId,
                            redirectTarget: "_self",
                        };

                        const result = await cashfree.checkout(checkoutOptions);

                        if (result.error) {
                            console.error("Payment error:", result.error);
                            alert("Payment failed. Please try again.");
                        } else if (result.paymentDetails) {
                            console.log("Payment completed. Checking status...");

                            const statusResponse = await axios.get(`${baseurl}/payurl/${orderId}`);
                            const statusData = statusResponse.data;
                            alert("Your payment is " + statusData.orderStatus);
                        }

                        console.log("Payment result:", result);
                    } catch (error) {
                        console.error("Error initiating payment:", error);
                        alert("Failed to initiate payment. Please try again.");
                    }
                };
            } else {
                messageDiv.textContent = "No staff available for the selected time.";
                messageDiv.style.color = "red";
                staffContainer.innerHTML = "";
                payNowButton.style.display = "none";
            }
        } catch (error) {
            console.error("Error checking availability:", error);
            messageDiv.textContent = "Failed to check availability. Please try again.";
            messageDiv.style.color = "red";
        }
    });
});