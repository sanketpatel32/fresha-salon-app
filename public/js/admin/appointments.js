const baseurl = "https://fresha-salon-app.onrender.com/api";

document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
        window.location.href = "/admin";
        return;
    }

    document.getElementById("logout-btn").onclick = function() {
        localStorage.removeItem("adminToken");
        window.location.href = "/";
    };

    const container = document.getElementById("appointments-container");
    const noAppointmentsDiv = document.getElementById("no-appointments");

    try {
        const res = await axios.get(`${baseurl}/admin/appointments/getall`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const appointments = res.data;

        if (!appointments.length) {
            noAppointmentsDiv.style.display = "block";
            return;
        }

        appointments.forEach(app => {
            const card = document.createElement("div");
            card.className = "appointment-card";
            card.innerHTML = `
                <h3>${app.service?.name || "Service"}</h3>
                <p><strong>Customer:</strong> ${app.user?.name || "N/A"}</p>
                <p><strong>Salon:</strong> ${app.salon?.name || "N/A"}</p>
                <p><strong>Date:</strong> ${app.date}</p>
                <p><strong>Time:</strong> ${app.time} - ${app.endTime}</p>
                `;

            const delBtn = document.createElement("button");
            delBtn.className = "delete-btn";
            delBtn.textContent = "Delete";
            delBtn.onclick = async () => {
                try {
                    await axios.delete(`${baseurl}/admin/appointments/${app.id}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    card.remove();
                    if (!container.children.length) {
                        noAppointmentsDiv.style.display = "block";
                    }
                } catch (err) {
                    alert("Failed to delete appointment.");
                }
            };
            card.appendChild(delBtn);
            container.appendChild(card);
        });
    } catch (err) {
        noAppointmentsDiv.style.display = "block";
        noAppointmentsDiv.textContent = "Failed to load appointments.";
    }
});