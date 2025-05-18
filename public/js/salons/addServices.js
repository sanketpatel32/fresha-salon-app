const baseurl = "http://localhost:3000/api"; // Base URL for API requests

const handleAddService = async (event) => {
    event.preventDefault();

    const name = document.getElementById("name").value.trim();
    const price = parseFloat(document.getElementById("price").value);
    const duration = parseInt(document.getElementById("duration").value, 10);
    const errorMessage = document.getElementById("errorMessage");

    // Clear previous error message
    errorMessage.textContent = "";
    
    // Retrieve token from localStorage
    const token = localStorage.getItem("token");
    
    const service = { name, price, duration };

    try {
        const response = await axios.post(`${baseurl}/salonsdashboard/services/add`, service, {
            headers: {
                Authorization: `Bearer ${token}` // Add token to the request headers
            }
        });
        if (response.status === 201) {
            alert("Service added successfully!");
            window.location.href = "/salonsdashboard"; // Redirect to the dashboard
        }
    } catch (error) {
        // Handle and display error messages
        console.error("Error occurred:", error);
        if (error.response) {
            errorMessage.textContent = error.response.data.message || "An error occurred.";
        } else {
            // console.error("Error Message:", error.message);
            errorMessage.textContent = "Unable to add service. Please try again.";
        }
    }
};