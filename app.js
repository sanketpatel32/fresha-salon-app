// Import dependencies
const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

// Import custom services and routes
const routes = require('./routes/indexRoutes');
const sequelize = require('./utils/database');
require('./models/associations'); // Import relationships

// Initialize express app
const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({ credentials: true })); // Adjust the origin as needed
app.use('/api', routes);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Root route to serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Sync database and start the server
sequelize
  .sync({ alter: false}) // Use alter to update the schema without dropping data
  .then(() => {
    app.listen(process.env.PORT || 3000, () => {
      console.log(`Server is running on port ${process.env.PORT || 3000}`);
    });
  })
  .catch((err) => {
    console.error('Error syncing database:', err);
  });