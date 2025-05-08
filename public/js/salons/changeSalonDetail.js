const baseurl = "http://127.0.0.1:3000/api"; // Define the base URL

document.addEventListener("DOMContentLoaded", async () => {
    const form = document.getElementById("salon-details-form");

    try {
        const token = localStorage.getItem("token");
        if (!token) {
            alert("You are not logged in. Please log in to continue.");
            window.location.href = "/"; // Redirect to login page
            return;
        }

        // Fetch salon details
        const response = await axios.get(`${baseurl}/buisness/getsalonbyIdSalonId`, {
            headers: {
                Authorization: `Bearer ${token}` 
            }
        });
        const salon = response.data;

        // Populate the form with salon details
        document.getElementById("name").value = salon.name;
        document.getElementById("phoneNumber").value = salon.phoneNumber;
        // document.getElementById("email").value = salon.email; // Email is non-editable
        document.getElementById("address").value = salon.address;
        // document.getElementById("pricing").value = salon.pricing;

        // Populate working days checkboxes
        salon.workingDays.forEach(day => {
            const checkbox = document.getElementById(day);
            if (checkbox) checkbox.checked = true;
        });

        // Populate opening and closing times
        document.getElementById("openingTime").value = salon.openingTime;
        document.getElementById("closingTime").value = salon.closingTime;

        // Handle form submission
        form.addEventListener("submit", async (event) => {
            event.preventDefault();

            // Get selected working days
            const workingDays = Array.from(document.querySelectorAll('#workingDays input:checked')).map(input => input.value);

            const updatedDetails = {
                name: document.getElementById("name").value,
                phoneNumber: document.getElementById("phoneNumber").value,
                address: document.getElementById("address").value,
                workingDays, // Selected working days
                openingTime: parseInt(document.getElementById("openingTime").value, 10),
                closingTime: parseInt(document.getElementById("closingTime").value, 10),
            };

            try {
                // Send updated details to the server
                const updateResponse = await axios.put(`${baseurl}/buisness/changeSalonDetail`, {
                    salonId: salon.id, // Include the salon ID
                    ...updatedDetails,
                }, {
                    headers: {
                        Authorization: `Bearer ${token}` 
                    }
                });

                if (updateResponse.status === 200) {
                    alert("Salon details updated successfully!");
                    window.location.href = "/api/salonsdashboard"; // Redirect to dashboard
                }
            } catch (error) {
                console.error("Error updating salon details:", error);
                alert("Failed to update salon details. Please try again.");
            }
        });
    } catch (error) {
        console.error("Error fetching salon details:", error);
        alert("Failed to load salon details. Please try again.");
    }
});