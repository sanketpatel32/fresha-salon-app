const baseurl = "https://fresha-salon-app.onrender.com/api"; // Base URL for API requests

document.addEventListener("DOMContentLoaded", async () => {
    const staffList = document.getElementById("staffList");

    try {
        // Retrieve token from localStorage
        const token = localStorage.getItem("token");

        if (!token) {
            alert("You are not logged in. Please log in to continue.");
            window.location.href = "/"; // Redirect to login page
            return;
        }

        // Fetch staff for the salon
        const response = await axios.get(`${baseurl}/salonsdashboard/staff/getallstaff`, {
            headers: {
                Authorization: `Bearer ${token}` // Add token to the request headers
            }
        });

        const staff = response.data;

        // Render staff cards
        if (staff.length > 0) {
            staff.forEach((member) => {
                const card = document.createElement("div");
                card.classList.add("staff-card");

                // Display staff details
                card.innerHTML = `
                    <h3>${member.name}</h3>
                    <p><strong>Email:</strong> ${member.email}</p>
                    <p><strong>Phone:</strong> ${member.phoneNumber}</p>
                    <p><strong>Status:</strong> ${member.statusbar}</p>
                    <p><strong>Services:</strong> ${member.services.length > 0 ? member.services.map(service => service.name).join(", ") : "No services assigned"}</p>
                `;

                // Make the card clickable
                card.addEventListener("click", () => {
                    localStorage.setItem("selectedStaff", JSON.stringify(member.id)); 
                    window.location.href = `${baseurl}/salonsdashboard/staff/staffModifyForm`; 
                    // You can redirect or perform any action here
                });

                staffList.appendChild(card);
            });
        } else {
            staffList.innerHTML = "<p>No staff members found.</p>";
        }
    } catch (error) {
        console.error("Error fetching staff:", error);
        alert("Failed to load staff. Please try again.");
    }
});