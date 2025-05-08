const baseurl = "http://127.0.0.1:3000/api"; // Define the base URL

document.addEventListener("DOMContentLoaded", async () => {
    const salonsContainer = document.getElementById("salons-container");

    try {
        // Fetch data from the API
        const response = await axios.get(`${baseurl}/buisness/getall`);
        const salons = response.data;

        // Check if salons exist
        if (salons.length > 0) {
            salons.forEach((salon) => {
                // Create a card for each salon
                const card = document.createElement("div");
                card.classList.add("salon-card");

                card.innerHTML = `
                    <h3>${salon.name}</h3>
                    <p><strong>Phone:</strong> ${salon.phoneNumber}</p>
                    <p><strong>Email:</strong> ${salon.email}</p>
                    <p><strong>Address:</strong> ${salon.address}</p>
                    <p><strong>Pricing:</strong> ${salon.pricing}</p>
                    <p><strong>Status:</strong> ${salon.statusbar === 'active' ? "Opened" : "Temperorily Closed"}</p>
                    <p><strong>Working Days:</strong> ${salon.workingDays ? salon.workingDays.join(', ') : 'Not Available'}</p>
                    <p><strong>Working Hours:</strong> ${salon.openingTime}:00 - ${salon.closingTime}:00 </p>
                `;

                // Add click event listener to redirect to the salon services page
                card.addEventListener("click", () => {
                    localStorage.setItem("salonId", salon.id); // Store the salon ID in local storage
                    window.location.href = "/api/userdashboard/salonservices"; // Redirect to salon services
                });

                salonsContainer.appendChild(card);
            });
        } else {
            salonsContainer.innerHTML = "<p>No salons available.</p>";
        }
    } catch (error) {
        console.error("Error fetching salons:", error);
        salonsContainer.innerHTML = "<p>Failed to load salons. Please try again later.</p>";
    }
});