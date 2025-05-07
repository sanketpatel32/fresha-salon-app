const baseurl = "http://localhost:3000/api"; 

const handleUserLogin = async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const loginError = document.getElementById("loginError");

    // Clear previous error message
    loginError.textContent = "";

    try {
        const response = await axios.post(`${baseurl}/user/login`, { email, password });

        if (response.status === 200) {
            const { token } = response.data; // Get JWT token
            localStorage.setItem("token", token); // Store JWT in local storage
            window.location.href = "/api/dashboard"; // Redirect to the home page
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 404) {
                loginError.textContent = "User not found. Please check your email.";
            } else if (error.response.status === 401) {
                loginError.textContent = "Incorrect password. Please try again.";
            } else if (error.response.status === 500) {
                loginError.textContent = "Server error. Please try again later.";
            } else {
                loginError.textContent = error.response.data.error || "An unexpected error occurred.";
            }
        } else if (error.request) {
            console.error("No response received:", error.request);
            loginError.textContent = "Unable to connect to the server. Please try again later.";
        } else {
            console.error("Error logging in:", error.message);
            loginError.textContent = "An unexpected error occurred. Please try again.";
        }
    }
};