const baseurl = "http://localhost:3000/api"; // Base URL for API requests

document.getElementById("addStaffForm").addEventListener("submit", async (event) => {
    event.preventDefault(); // Prevent the default form submission behavior

    // Get form data
    const name = document.getElementById("name").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    console.log("Form Data:", { name, phoneNumber, email, password });

    try {
        // Retrieve token from localStorage
        const token = localStorage.getItem("token");
        console.log("Token:", token);

        if (!token) {
            alert("You are not logged in. Please log in to continue.");
            window.location.href = "/"; // Redirect to login page
            return;
        }

        // Send POST request to the server
        const response = await axios.post(`${baseurl}/salonsdashboard/staff/add`, {
            name,
            phoneNumber,
            email,
            password,
        }, {
            headers: {
                Authorization: `Bearer ${token}` // Add token to the request headers
            }
        });

        console.log("Response:", response);

        if (response.status === 201) {
            alert("Staff added successfully!");
            document.getElementById("addStaffForm").reset(); // Reset the form
        } else {
            alert("Failed to add staff. Please try again.");
        }
    } catch (error) {
        console.error("Error adding staff:", error);

        if (error.response) {
            console.log("Error Response:", error.response);
            console.log("Status Code:", error.response.status);
            console.log("Data:", error.response.data);

            if (error.response.data && error.response.data.message) {
                alert(`Error: ${error.response.data.message}`);
            } else {
                alert("An error occurred while adding staff. Please try again.");
            }
        } else {
            alert("An error occurred while adding staff. Please try again.");
        }
    }
});