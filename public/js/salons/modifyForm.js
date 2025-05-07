const baseurl = "http://localhost:3000/api"; // Base URL for API requests

const fetchServiceDetails = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const serviceId = urlParams.get("id"); // Extract the service ID from the URL

    if (!serviceId) {
        alert("Service ID is missing in the URL.");
        return;
    }

    try {
        const token = localStorage.getItem("token"); // Retrieve token from localStorage
        const response = await axios.get(`${baseurl}/salonsdashboard/services/get/${serviceId}`, {
            headers: {
                Authorization: `Bearer ${token}` // Add token to the request headers
            }
        });

        if (response.status === 200) {
            const service = response.data;
            populateForm(service);
        } else {
            alert("Failed to fetch service details.");
        }
    } catch (error) {
        console.error("Error fetching service details:", error);
        alert("An error occurred while fetching service details.");
    }
};

const populateForm = (service) => {
    document.getElementById("name").value = service.name;
    document.getElementById("price").value = service.price;
    document.getElementById("duration").value = service.duration;
    document.getElementById("statusbar").value = service.statusbar;
};

const handleFormSubmit = async (event) => {
    event.preventDefault();

    const urlParams = new URLSearchParams(window.location.search);
    const serviceId = urlParams.get("id");

    const name = document.getElementById("name").value.trim();
    const price = parseFloat(document.getElementById("price").value);
    const duration = parseInt(document.getElementById("duration").value, 10);
    const statusbar = document.getElementById("statusbar").value;

    try {
        const token = localStorage.getItem("token");
        const response = await axios.put(`${baseurl}/salonsdashboard/services/update/${serviceId}`, {
            name,
            price,
            duration,
            statusbar
        }, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (response.status === 200) {
            alert("Service updated successfully!");
            window.location.href = "./modify";
        } else {
            alert("Failed to update service.");
        }
    } catch (error) {
        console.error("Error updating service:", error);
        alert("An error occurred while updating the service.");
    }
};

document.getElementById("removeServiceBtn").addEventListener("click", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const serviceId = urlParams.get("id");

    if (!serviceId) {
        alert("Service ID is missing.");
        return;
    }

    const confirmDelete = confirm("Are you sure you want to remove this service?");
    if (!confirmDelete) return;

    try {
        const token = localStorage.getItem("token");
        const response = await axios.delete(`${baseurl}/salonsdashboard/services/delete/${serviceId}`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (response.status === 200) {
            alert("Service removed successfully!");
            window.location.href = "http://localhost:3000/api/salonsdashboard";
        } else {
            alert("Failed to remove service.");
        }
    } catch (error) {
        console.error("Error removing service:", error);
        alert("An error occurred while removing the service.");
    }
});

document.getElementById("modifyServiceForm").addEventListener("submit", handleFormSubmit);

// Fetch service details on page load
fetchServiceDetails();