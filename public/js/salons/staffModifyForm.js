const baseurl = "http://localhost:3000/api"; // Base URL for API requests

document.addEventListener("DOMContentLoaded", async () => {
    const staffDetails = document.getElementById("staffDetails");
    const servicesList = document.getElementById("servicesList");
    const assignServicesForm = document.getElementById("assignServicesForm");
    // const staffStatusDropdown = document.getElementById("staffStatus");

    try {
        // Retrieve the selected staff ID from localStorage
        const staffId = JSON.parse(localStorage.getItem("selectedStaff"));
        //
        if (!staffId) {
            alert("No staff selected. Redirecting to staff list...");
            window.location.href = "/"; 
            return;
        }

        // Fetch staff details
        const staffResponse = await axios.get(`${baseurl}/salonsdashboard/staff/getStaff?staffid=${staffId}`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`
            }
        });

        const staff = staffResponse.data;

        // Populate staff details
        staffDetails.innerHTML = `
            <h2>Staff Details</h2>
            <p><strong>Name:</strong> ${staff.name}</p>
            <p><strong>Email:</strong> ${staff.email}</p>
            <p><strong>Phone:</strong> ${staff.phoneNumber}</p>
            <p><strong>Status:</strong>
                <select id="staffStatus" class="status-dropdown">
                    <option value="active" ${staff.statusbar === "active" ? "selected" : ""}>Active</option>
                    <option value="inactive" ${staff.statusbar === "inactive" ? "selected" : ""}>Inactive</option>
                </select>
            </p>
        `;

        // Handle status change
        const staffStatusDropdown = document.getElementById("staffStatus");
        staffStatusDropdown.addEventListener("change", async () => {
            const newStatus = staffStatusDropdown.value;

            try {
                const statusUpdateResponse = await axios.put(`${baseurl}/salonsdashboard/staff/updateStatus`, {
                    staffId: staffId,
                    status: newStatus
                }, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`
                    }
                });

                if (statusUpdateResponse.status === 200) {
                    alert("Status updated successfully!");
                }
            } catch (error) {
                console.error("Error updating status:", error);
                alert("Failed to update status. Please try again.");
            }
        });

        // Fetch available services for the salon
        const servicesResponse = await axios.get(`${baseurl}/salonsdashboard/services/getAll`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`
            }
        });

        const services = servicesResponse.data;

        // Render services as checkboxes and pre-select assigned services
        if (services.length > 0) {
            services.forEach((service) => {
                const isChecked = staff.services.some((assignedService) => assignedService.id === service.id); // Check if the service is already assigned
                const checkbox = document.createElement("div");
                checkbox.classList.add("service-checkbox");
                checkbox.innerHTML = `
                    <input type="checkbox" id="service-${service.id}" name="services" value="${service.id}" ${isChecked ? "checked" : ""}>
                    <label for="service-${service.id}">${service.name}</label>
                `;
                servicesList.appendChild(checkbox);
            });
        } else {
            servicesList.innerHTML = "<p>No services available for this salon.</p>";
        }

        // Handle form submission
        assignServicesForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            // Get selected services
            const selectedServices = Array.from(document.querySelectorAll('input[name="services"]:checked')).map(
                (checkbox) => checkbox.value
            );

            try {
                // Assign services to the staff
                const assignResponse = await axios.put(`${baseurl}/salonsdashboard/staff/assignServices?staffid=${staffId}`, {
                    services: selectedServices 
                }, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`
                    }
                });

                if (assignResponse.status === 200) {
                    alert("Services assigned successfully!");
                    window.location.href = "/salonsdashboard/staff/assignStaff"; // Redirect to staff list
                }
            } catch (error) {
                console.error("Error assigning services:", error);

                // Handle specific backend errors
                if (error.response && error.response.data && error.response.data.message) {
                    alert(`Error: ${error.response.data.message}`);
                } else {
                    alert("Failed to assign services. Please try again.");
                }
            }
        });
    } catch (error) {
        console.error("Error loading staff or services:", error);
        alert("Failed to load staff or services. Please try again.");
    }
});