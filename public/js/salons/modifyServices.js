const baseurl = "http://localhost:3000/api"; // Base URL for API requests

const fetchServices = async () => {
    try {
        const token = localStorage.getItem("token"); // Retrieve token from localStorage
        if (!token) {
            alert("You are not logged in. Please log in to continue.");
            window.location.href = "/"; // Redirect to login page
            return;
        }

        const response = await axios.get(`${baseurl}/salonsdashboard/services/getall`, {
            headers: {
                Authorization: `Bearer ${token}` // Add token to the request headers
            }
        });

        if (response.status === 200) {
            const services = response.data; // Array of services
            renderServices(services);
        } else {
            console.error("Unexpected response:", response);
            alert("Failed to fetch services. Please try again.");
        }
    } catch (error) {
        console.error("Error fetching services:", error);
        if (error.response && error.response.status === 403) {
            alert("Your session has expired. Please log in again.");
            window.location.href = "/"; // Redirect to login page
        } else {
            alert("Failed to fetch services. Please try again.");
        }
    }
};

const renderServices = (services) => {
    const container = document.getElementById("services-container");
    container.innerHTML = ""; // Clear existing content

    services.forEach((service) => {
        const card = document.createElement("div"); 
        card.className = "service-card";
        card.onclick = () => {
            window.location.href = `${baseurl}/salonsdashboard/services/modifyForm?id=${service.id}`;
        };
        
        card.innerHTML = `
            <h3>${service.name}</h3>
            <p>Price: ₹${service.price.toFixed(2)}</p>
            <p>Duration: ${service.duration} minutes</p>
            <p class="statusbar">Status: ${service.statusbar}</p>
        `;

        container.appendChild(card);
    });
};
fetchServices();