const baseurl = "http://127.0.0.1:3000/api"; // Define the base URL

document.addEventListener("DOMContentLoaded", async () => {
    const salonNameElement = document.querySelector("#salon-name span");
    const servicesContainer = document.getElementById("services-container");

    try {
        // Get the salon ID from localStorage
        const salonId = JSON.parse(localStorage.getItem("salonId"));
        if (!salonId) {
            alert("No salon selected. Redirecting to main menu...");
            window.location.href = "/user/dashboard"; // Redirect to main menu
            return;
        }

        // Fetch salon details (optional, if you want to display the salon name)
        const salonResponse = await axios.get(`${baseurl}/buisness/getSalonById?salonId=${salonId}`);
        const salon = salonResponse.data;
        salonNameElement.textContent = salon.name;

        // Fetch all active services for the salon
        const servicesResponse = await axios.get(`${baseurl}/userdashboard/getAllActiveServicesBySalonId?salonId=${salonId}`);
        const services = servicesResponse.data;

        // Check if services exist
        if (services.length > 0) {
            services.forEach((service) => {
                // Create a card for each service
                const card = document.createElement("div");
                card.classList.add("service-card");

                card.innerHTML = `
                    <h3>${service.name}</h3>
                    <p><strong>Price:</strong> ${service.price || "N/A"}</p>
                    <p><strong>Duration:</strong> ${service.duration || "N/A"} min</p>
                `;

                servicesContainer.appendChild(card);
            });
        } else {
            servicesContainer.innerHTML = "<p>No services available for this salon.</p>";
        }
    } catch (error) {
        console.error("Error fetching salon or services:", error);
        servicesContainer.innerHTML = "<p>Failed to load services. Please try again later.</p>";
    }
});