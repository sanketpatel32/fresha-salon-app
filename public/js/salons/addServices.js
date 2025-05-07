const baseurl = "http://localhost:3000/api"; // Base URL for API requests

const handleAddService = async (event) => {
    event.preventDefault();

    const name = document.getElementById("name").value.trim();
    const price = parseFloat(document.getElementById("price").value);
    const duration = parseInt(document.getElementById("duration").value, 10);
    const errorMessage = document.getElementById("errorMessage");

    // Clear previous error message
    // console.log("Stage 1")
    errorMessage.textContent = "";
    
    // Retrieve token from localStorage
    const token = localStorage.getItem("token");
    // console.log("Token:", token); // Log the token for debugging
    // console.log("Stage 2")
    
    const service = { name, price, duration };
    // console.log("Service object:", service); // Log the service object for debugging

    try {
        const response = await axios.post(`${baseurl}/salonsdashboard/services/add`, service, {
        // const response = await axios.post(`http://localhost:3000/api/salonsdashboard/services/add`, service, {
            headers: {
                Authorization: `Bearer ${token}` // Add token to the request headers
            }
        });
        // console.log("Response:", response); // Log the response for debugging
        if (response.status === 201) {
            alert("Service added successfully!");
            window.location.href = "../services/add"; // Redirect to the dashboard
            // window.location.href = "../"
        }
    } catch (error) {
        console.error("Error occurred:", error); // Log the full error object
        if (error.response) {
            console.error("Error Response Data:", error.response.data); // Log the response data
            console.error("Error Response Status:", error.response.status); // Log the status code
            console.error("Error Response Headers:", error.response.headers); // Log the headers
            errorMessage.textContent = error.response.data.message || "An error occurred.";
        } else {
            console.error("Error Message:", error.message); // Log the error message
            errorMessage.textContent = "Unable to add service. Please try again.";
        }
    }
};