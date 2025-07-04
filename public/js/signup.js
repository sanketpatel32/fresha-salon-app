const baseurl = "https://fresha-salon-app.onrender.com/api"; // Base URL for API requests

const handleUserSignup = async (event) => {
    event.preventDefault();
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();
    const password = document.getElementById("password").value.trim();
    const signupError = document.getElementById("signupError");

    // Clear previous error message
    signupError.textContent = "";

    const user = {
        name: name,
        email: email,
        password: password,
        phoneNumber: phoneNumber,
    };

    try {
        const response = await axios.post(`${baseurl}/user/signup`, user);
        if (response.status === 201) {
            console.log("User created successfully");
            const { token } = response.data; // Get JWT token
            localStorage.setItem("token", token); // Store JWT in local storage

            window.location.href = "/userdashboard"; // Redirect to the expense page
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 409) {
                signupError.textContent = "Signup failed: User already exists.";
            } else if (error.response.status === 500) {
                signupError.textContent = "Server error. Please try again later.";
            } else {
                signupError.textContent = error.response.data.message || "An unexpected error occurred.";
            }
        } else {
            console.error("Error signing up user:", error);
            signupError.textContent = "An unexpected error occurred. Please try again.";
        }
    }
};

const handleSalonSignup = async (event) => {
    event.preventDefault();
    const name = document.getElementById("name").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const address = document.getElementById("address").value.trim();
    const pricing = document.getElementById("pricing").value.trim();
    const signupError = document.getElementById("signupError");

    // Clear previous error message
    signupError.textContent = "";

    const salon = {
        name,
        phoneNumber,
        email,
        password,
        address,
        pricing,
    };

    try {
        const response = await axios.post(`${baseurl}/buisness/signup`, salon);
        if (response.status === 201) {
            console.log("Salon registered successfully");
            window.location.href = "/api/salonsdashboard"; // Redirect to the dashboard
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 409) {
                signupError.textContent = "Signup failed: Salon already exists.";
            } else if (error.response.status === 500) {
                signupError.textContent = "Server error. Please try again later.";
            } else {
                signupError.textContent = error.response.data.message || "An unexpected error occurred.";
            }
        } else {
            console.error("Error signing up salon:", error);
            signupError.textContent = "An unexpected error occurred. Please try again.";
        }
    }
};