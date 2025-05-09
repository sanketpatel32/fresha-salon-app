const baseurl = "http://127.0.0.1:3000/api";
document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("token");
    const staffId = localStorage.getItem("staffId");
    const staffName = localStorage.getItem("staffName");

    // Set staff name in header
    document.getElementById("staff-name").textContent = staffName || "Staff";

    // Logout
    document.getElementById("logout-btn").onclick = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("staffId");
        localStorage.removeItem("staffName");
        window.location.href = "/";
    };

    if (!token || !staffId) {
        alert("You are not logged in. Please log in.");
        window.location.href = "api/staff/login";
        return;
    }

    try {
        // Fetch staff appointments
        const response = await axios.get(`${baseurl}/staff/appointments?staffId=${staffId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const appointments = response.data;

        const upcomingContainer = document.getElementById("upcoming-appointments");
        const completedContainer = document.getElementById("completed-appointments");
        const now = new Date();

        appointments.forEach(app => {
            const appDate = new Date(`${app.date}T${app.endTime}`);
            const card = document.createElement("div");
            card.classList.add("appointment-card");
            card.innerHTML = `
                <h3>${app.service?.name || "Service"}</h3>
                <p><strong>Customer:</strong> ${app.user?.name || "N/A"}</p>
                <p><strong>Date:</strong> ${app.date}</p>
                <p><strong>Time:</strong> ${app.time} - ${app.endTime}</p>
                <p><strong>Status:</strong> ${app.status || (appDate < now ? "Completed" : "Upcoming")}</p>
            `;

            if (appDate < now) {
                // Completed appointment: staff review section
                if (!app.staffReview) {
                    // Show review button if not submitted
                    const reviewBtn = document.createElement("button");
                    reviewBtn.textContent = "Write Staff Review";
                    reviewBtn.className = "review-btn";
                    reviewBtn.onclick = () => {
                        // Inline review form
                        const form = document.createElement("form");
                        form.innerHTML = `
                            <textarea placeholder="Write your review for the customer..." required style="width:100%;min-height:60px;"></textarea>
                            <button type="submit" class="review-submit-btn">Submit</button>
                        `;
                        form.onsubmit = async (e) => {
                            e.preventDefault();
                            const review = form.querySelector("textarea").value;
                            try {
                                await axios.put(`${baseurl}/appointment/staffreview/${app.id}`, { review }, {
                                    headers: { Authorization: `Bearer ${token}` }
                                });
                                form.innerHTML = "<span style='color:green;'>Thank you for your review!</span>";
                            } catch (err) {
                                form.innerHTML = "<span style='color:red;'>Failed to submit review.</span>";
                            }
                        };
                        card.replaceChild(form, reviewBtn);
                    };
                    card.appendChild(reviewBtn);
                } else {
                    // Show the staff review if already submitted
                    const reviewText = document.createElement("div");
                    reviewText.classList.add("review-text");
                    reviewText.innerHTML = `<strong>Your staff review:</strong> ${app.staffReview}`;
                    card.appendChild(reviewText);
                }

                // Show user review (customer review) or "Yet to receive"
                const userReviewDiv = document.createElement("div");
                userReviewDiv.classList.add("user-review-section");
                userReviewDiv.innerHTML = `<strong>User Review:</strong> ${app.userReview ? app.userReview : "<em>Yet to receive</em>"}`;
                card.appendChild(userReviewDiv);

                completedContainer.appendChild(card);
            } else {
                upcomingContainer.appendChild(card);
            }
        });
    } catch (err) {
        console.error("Error fetching appointments:", err);
        alert("Failed to load appointments.");
    }
});