const baseurl = "https://fresha-salon-app.onrender.com";

document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
        window.location.href = "/admin";
        return;
    }

    // Logout functionality
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.onclick = function() {
            localStorage.removeItem("adminToken");
            window.location.href = "/admin";
        };
    }

    // Appointments card click
    document.getElementById("salon-card").onclick = () => {
        window.location.href = `${baseurl}/admin/appointments`;
    };

    // Customer card click
    document.getElementById("customer-card").onclick = () => {
        window.location.href = `${baseurl}/admin/users`;
    };
});