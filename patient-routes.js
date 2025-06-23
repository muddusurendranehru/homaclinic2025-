// patient-routes.js - Safe patient registration routes
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Create patients directory if it doesn't exist
const patientsDir = path.join(__dirname, 'data');
const patientsFile = path.join(patientsDir, 'patients.json');

// Ensure data directory exists
if (!fs.existsSync(patientsDir)) {
    fs.mkdirSync(patientsDir, { recursive: true });
}

// Ensure patients.json exists
if (!fs.existsSync(patientsFile)) {
    fs.writeFileSync(patientsFile, JSON.stringify([], null, 2));
}

// Helper function to read patients from file
function readPatients() {
    try {
        const data = fs.readFileSync(patientsFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log('Error reading patients file, creating new one:', error.message);
        return [];
    }
}

// Helper function to write patients to file
function writePatients(patients) {
    try {
        fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing patients file:', error.message);
        return false;
    }
}

// Helper function to generate simple ID
function generatePatientId() {
    return 'PAT' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// Serve patient registration page
router.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'patient-registration.html'));
});

// Handle patient registration
router.post('/api/register-patient', (req, res) => {
    try {
        const { name, email, phone, password } = req.body;

        // Basic validation
        if (!name || !email || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        // Email validation (simple)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        // Read existing patients
        let patients = readPatients();

        // Check if email already exists
        const existingPatient = patients.find(patient => patient.email === email);
        if (existingPatient) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }

        // Create new patient record
        const newPatient = {
            id: generatePatientId(),
            name: name.trim(),
            email: email.toLowerCase().trim(),
            phone: phone.trim(),
            password: password, // In production, you'd hash this
            registrationDate: new Date().toISOString(),
            status: 'active'
        };

        // Add to patients array
        patients.push(newPatient);

        // Save to file
        if (writePatients(patients)) {
            console.log(`New patient registered: ${newPatient.name} (${newPatient.email})`);
            
            // Don't send password back in response
            const { password: _, ...patientResponse } = newPatient;
            
            res.json({
                success: true,
                message: 'Registration successful',
                patient: patientResponse
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to save registration'
            });
        }

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Get all patients (for admin use - optional)
router.get('/api/patients', (req, res) => {
    try {
        const patients = readPatients();
        // Remove passwords from response
        const safePatients = patients.map(({ password, ...patient }) => patient);
        res.json({
            success: true,
            patients: safePatients,
            count: safePatients.length
        });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch patients'
        });
    }
});

// Search patients by name or email (for admin use - optional)
router.get('/api/patients/search', (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({
                success: false,
                message: 'Search query required'
            });
        }

        const patients = readPatients();
        const searchTerm = q.toLowerCase();
        
        const results = patients.filter(patient => 
            patient.name.toLowerCase().includes(searchTerm) ||
            patient.email.toLowerCase().includes(searchTerm)
        );

        // Remove passwords from response
        const safeResults = results.map(({ password, ...patient }) => patient);

        res.json({
            success: true,
            patients: safeResults,
            count: safeResults.length,
            searchTerm: q
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            message: 'Search failed'
        });
    }
});

module.exports = router;