const baseurl = "http://127.0.0.1:3000/api"; // Define the base URL

document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("token"); // Assuming token is stored in localStorage
    const userId = localStorage.getItem("userId");
    if (!token) {
        alert("You are not logged in. Please log in to view your appointments.");
        window.location.href = "api/userdashboard/login"; // Redirect to login page
        return;
    }

    try {
        // Fetch all appointments for the user using axios
        const response = await axios.get(`${baseurl}/appointment/getall?userId=${userId}`, {
            headers: {
                Authorization: `Bearer ${token}` // Add token to the request headers
            }
        });

        const appointments = response.data; // Extract appointments from the response
        const upcomingContainer = document.getElementById("upcoming-appointments");
        const pastContainer = document.getElementById("past-appointments");

        const today = new Date();

        // Separate appointments into upcoming and past
        appointments.forEach((appointment) => {
            const appointmentDate = new Date(appointment.date);
            const appointmentCard = document.createElement("div");
            appointmentCard.classList.add("appointment-card");

            // Render appointment details
            appointmentCard.innerHTML = `
                <h3>${appointment.service.name}</h3>
                <p><strong>Salon:</strong> ${appointment.salon.name}</p>
                <p><strong>Date:</strong> ${appointment.date}</p>
                <p><strong>Time:</strong> ${appointment.time} - ${appointment.endTime}</p>
                <p><strong>Staff:</strong> ${appointment.staff.name} (${appointment.staff.phoneNumber})</p>
            `;

            if (appointmentDate >= today) {
                // Upcoming appointment
                upcomingContainer.appendChild(appointmentCard);
            } else {
                // Past appointment
                const reviewButton = document.createElement("button");
                reviewButton.classList.add("review-button");
                reviewButton.textContent = "Write Review";
                reviewButton.onclick = () => {
                    window.location.href = `/review/${appointment.id}`; // Redirect to review page
                };
                appointmentCard.appendChild(reviewButton);
                pastContainer.appendChild(appointmentCard);
            }
        });
    } catch (error) {
        console.error("Error fetching appointments:", error);
        alert("Failed to load appointments. Please try again later.");
    }
});