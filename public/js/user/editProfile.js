const baseurl = "http://127.0.0.1:3000/api";
const userId = localStorage.getItem("userId");
const token = localStorage.getItem("token");

document.getElementById("main-menu-btn").onclick = () => {
    window.location.href = "/api/userdashboard";
};

document.addEventListener("DOMContentLoaded", async () => {
    if (!userId || !token) {
        alert("You are not logged in.");
        window.location.href = "/login";
        return;
    }

    // Fetch user details and prefill form
    try {
        const res = await axios.get(`${baseurl}/user/profile?userId=${userId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const user = res.data;
        document.getElementById("name").value = user.name || "";
        document.getElementById("email").value = user.email || "";
        document.getElementById("phoneNumber").value = user.phoneNumber || "";
    } catch (err) {
        document.getElementById("edit-profile-message").textContent = "Could not load profile.";
    }
});

document.getElementById("edit-profile-form").addEventListener("submit", async function(e) {
    e.preventDefault();
    const data = {
        name: this.name.value,
        email: this.email.value,
        phoneNumber: this.phoneNumber.value,
        password: this.password.value
    };
    try {
        const res = await axios.put(`${baseurl}/user/edit?userId=${userId}`, data, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            }
        });
        document.getElementById("edit-profile-message").style.color = "#28a745";
        document.getElementById("edit-profile-message").textContent = "Profile updated successfully!";
        this.password.value = "";
    } catch (err) {
        document.getElementById("edit-profile-message").style.color = "#ff4d4f";
        if (err.response && err.response.data && err.response.data.message) {
            document.getElementById("edit-profile-message").textContent = err.response.data.message;
        } else {
            document.getElementById("edit-profile-message").textContent = "Update failed.";
        }
    }
});