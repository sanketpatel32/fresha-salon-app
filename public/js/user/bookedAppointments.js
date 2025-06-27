const baseurl = "https://fresha-salon-app.onrender.com/api"; // Define the base URL

document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("token"); // Assuming token is stored in localStorage
    const userId = localStorage.getItem("userId");
    if (!token) {
        alert("You are not logged in. Please log in to view your appointments.");
        window.location.href = "/"; // Redirect to login page
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
        today.setHours(0, 0, 0, 0); // Normalize to midnight for date-only comparison

        // Separate appointments into upcoming and past
        appointments.forEach((appointment) => {
            const appointmentDate = new Date(appointment.date);
            appointmentDate.setHours(0, 0, 0, 0); // Normalize

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
                // Past appointment (completed)
                // Add staff review section only for completed appointments
                const staffReviewDiv = document.createElement("div");
                staffReviewDiv.classList.add("staff-review-section");
                staffReviewDiv.innerHTML = `<strong>Staff Review:</strong> ${appointment.staffReview ? appointment.staffReview : "<em>Yet to receive</em>"}`;
                appointmentCard.appendChild(staffReviewDiv);

                if (!appointment.userReview) {
                    // Show review button if review not submitted
                    const reviewButton = document.createElement("button");
                    reviewButton.classList.add("review-button");
                    reviewButton.textContent = "Write Review";
                    reviewButton.onclick = () => {
                        // Inline review form
                        const form = document.createElement("form");
                        form.innerHTML = `
                            <textarea placeholder="Write your review..." required style="width:100%;min-height:60px;"></textarea>
                            <button type="submit" class="review-submit-btn">Submit</button>
                        `;
                        form.onsubmit = async (e) => {
                            e.preventDefault();
                            const review = form.querySelector("textarea").value;
                            try {
                                await axios.put(`${baseurl}/appointment/review/${appointment.id}`, { review }, {
                                    headers: { Authorization: `Bearer ${token}` }
                                });
                                form.innerHTML = "<span style='color:green;'>Thank you for your review!</span>";
                            } catch (err) {
                                form.innerHTML = "<span style='color:red;'>Failed to submit review.</span>";
                            }
                        };
                        appointmentCard.replaceChild(form, reviewButton);
                    };
                    appointmentCard.appendChild(reviewButton);
                } else {
                    // Show the review if already submitted
                    const reviewText = document.createElement("div");
                    reviewText.classList.add("review-text");
                    reviewText.innerHTML = `<strong>Your review:</strong> ${appointment.userReview}`;
                    appointmentCard.appendChild(reviewText);
                }
                pastContainer.appendChild(appointmentCard);
            }
        });
    } catch (error) {
        console.error("Error fetching appointments:", error);
        alert("Failed to load appointments. Please try again later.");
    }
});