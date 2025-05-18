const baseurl = "http://127.0.0.1:3000/api"; // Define the base URL

document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("token"); 

    if (!token) {
        alert("You are not logged in. Please log in to view appointments.");
        window.location.href = "/"; // Redirect to login page
        return;
    }

    try {
        const response = await axios.get(`${baseurl}/appointment/sceduledAppointments`, {
            headers: {
                Authorization: `Bearer ${token}` 
            }
        });

        const appointments = response.data; 
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
                <p><strong>Customer:</strong> ${appointment.user.name}</p>
                <p><strong>Staff:</strong> ${appointment.staff.name}</p>
                <p><strong>Date:</strong> ${appointment.date}</p>
                <p><strong>Time:</strong> ${appointment.time} - ${appointment.endTime}</p>
            `;

            if (appointmentDate >= today) {
                upcomingContainer.appendChild(appointmentCard);
            } else {
                pastContainer.appendChild(appointmentCard);
            }
        });
    } catch (error) {
        console.error("Error fetching appointments:", error);
        alert("Failed to load appointments. Please try again later.");
    }
});