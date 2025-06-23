// server.js - Homa Clinic Healthcare Appointment Booking System
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const patientRoutes = require('./patient-routes');
const app = express();
const PORT = process.env.PORT || 3001;

console.log('🏥 Starting Homa Clinic System...');

// Security middleware
app.use(express.json());
app.use('/', patientRoutes);
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'homa_clinic',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

// Initialize database
async function initializeDatabase() {
  try {
    console.log('🔌 Connecting to database...');
    
    // Connect without database first
    const tempConfig = { ...dbConfig };
    delete tempConfig.database;
    const tempConnection = await mysql.createConnection(tempConfig);
    
    // Create database if not exists
    await tempConnection.execute(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    await tempConnection.end();
    
    // Connect to actual database
    pool = mysql.createPool(dbConfig);
    const connection = await pool.getConnection();
    
    // Create tables
    await createTables(connection);
    connection.release();
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.log('💡 Make sure MySQL is running');
  }
}

// Create database tables
async function createTables(connection) {
  // Users table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      role ENUM('admin', 'doctor', 'patient') DEFAULT 'patient',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Appointments table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      appointment_date DATETIME NOT NULL,
      duration_minutes INT DEFAULT 30,
      status ENUM('scheduled', 'confirmed', 'cancelled', 'completed') DEFAULT 'scheduled',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(id),
      FOREIGN KEY (doctor_id) REFERENCES users(id)
    )
  `);

  // Create admin user if not exists
  const [adminUsers] = await connection.execute(
    'SELECT id FROM users WHERE role = "admin" LIMIT 1'
  );

  if (adminUsers.length === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 12);
    await connection.execute(
      'INSERT INTO users (email, password, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      ['admin@homaclinic.com', hashedPassword, 'Admin', 'User', 'admin']
    );
    console.log('👤 Admin user created: admin@homaclinic.com / admin123');
  }
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Routes

// Home page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🏥 Homa Clinic System</title>
        <style>
            body { font-family: Arial; max-width: 800px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; background: #007bff; color: white; padding: 20px; border-radius: 10px; }
            .status { background: #d4edda; padding: 15px; margin: 20px 0; border-radius: 5px; }
            .endpoint { margin: 10px 0; padding: 10px; background: #f8f9fa; border-left: 4px solid #007bff; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🏥 Homa Clinic Healthcare System</h1>
            <p>Appointment Booking & Management Platform</p>
        </div>
        
        <div class="status">
            <h3>✅ System Status: ONLINE</h3>
            <p><strong>Server:</strong> Running on port ${PORT}</p>
            <p><strong>Database:</strong> ${pool ? 'Connected' : 'Not connected'}</p>
        </div>

        <div class="endpoint">
            <h3>🔑 Default Admin Login</h3>
            <p><strong>Email:</strong> admin@homaclinic.com</p>
            <p><strong>Password:</strong> admin123</p>
        </div>

        <div class="endpoint">
            <h3>📋 API Endpoints</h3>
            <p><strong>POST /api/register</strong> - Register new user</p>
            <p><strong>POST /api/login</strong> - User login</p>
            <p><strong>GET /api/doctors</strong> - List doctors</p>
            <p><strong>POST /api/appointments</strong> - Book appointment</p>
            <p><strong>GET /health</strong> - Health check</p>
        </div>
    </body>
    </html>
  `);
});

// User registration
app.post('/api/register', [
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('first_name').trim().isLength({ min: 1 }),
  body('last_name').trim().isLength({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, first_name, last_name, phone, role = 'patient' } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12);
    
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, first_name, last_name, phone, role) VALUES (?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, first_name, last_name, phone, role]
    );

    res.status(201).json({ message: 'User created successfully', userId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login
app.post('/api/login', [
  body('email').isEmail(),
  body('password').exists()
], async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const [users] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get doctors
app.get('/api/doctors', authenticateToken, async (req, res) => {
  try {
    const [doctors] = await pool.execute(
      'SELECT id, first_name, last_name, email FROM users WHERE role = "doctor"'
    );
    res.json(doctors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log('');
      console.log('✅ =======================================');
      console.log('🏥 HOMA CLINIC SYSTEM STARTED!');
      console.log('=======================================');
      console.log(`🌐 Open: http://localhost:${PORT}`);
      console.log('🔑 Admin: admin@homaclinic.com / admin123');
      console.log('=======================================');
      console.log('🛑 Press Ctrl+C to stop');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
  }
}

startServer();