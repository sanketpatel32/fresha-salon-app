const baseurl = "http://127.0.0.1:3000/api";

document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
        window.location.href = "/admin";
        return;
    }

    document.getElementById("logout-btn").onclick = function() {
        localStorage.removeItem("adminToken");
        window.location.href = "/admin";
    };

    const usersContainer = document.getElementById("users-container");
    const noUsersDiv = document.getElementById("no-users");
    const searchBtn = document.getElementById("search-btn");
    const searchInput = document.getElementById("search-input");

    async function searchUsers() {
        const searchTerm = searchInput.value.trim();
        usersContainer.innerHTML = "";
        noUsersDiv.style.display = "none";

        try {
            const res = await axios.get(`${baseurl}/admin/users/search`, {
                params: { searchTerm },
                headers: { Authorization: `Bearer ${token}` }
            });
            const users = res.data;

            if (!users.length) {
                noUsersDiv.style.display = "block";
                return;
            }

            users.forEach(user => {
                const card = document.createElement("div");
                card.className = "user-card";
                card.innerHTML = `
                    <h3>${user.name || "No Name"}</h3>
                    <p><strong>Email:</strong> ${user.email || "N/A"}</p>
                    <p><strong>Phone:</strong> ${user.phoneNumber || "N/A"}</p>
                `;

                const delBtn = document.createElement("button");
                delBtn.className = "delete-btn";
                delBtn.textContent = "Delete";
                delBtn.onclick = async () => {
                    try {
                        await axios.delete(`${baseurl}/admin/users/${user.id}`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        card.remove();
                        if (!usersContainer.children.length) {
                            noUsersDiv.style.display = "block";
                        }
                    } catch (err) {
                        alert("Failed to delete user.");
                    }
                };
                card.appendChild(delBtn);
                usersContainer.appendChild(card);
            });
        } catch (err) {
            noUsersDiv.style.display = "block";
            noUsersDiv.textContent = "Failed to load users.";
        }
    }

    searchBtn.onclick = searchUsers;
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") searchUsers();
    });
});