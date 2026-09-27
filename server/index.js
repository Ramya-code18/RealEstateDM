/**
 * EstateLead - Server Entrypoint
 * Node.js + Express Server with Helmet Security Headers, CORS, Rate Limiting,
 * REST APIs, and Single-Page Application Client Routing.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const db = require('./config/db');

// Import REST API Route Modules
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const propertyRoutes = require('./routes/properties');
const customerRoutes = require('./routes/customer');
const leadRoutes = require('./routes/leads');
const crmRoutes = require('./routes/crm');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Security Headers via Helmet with Open Local Access
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// 2. Universal CORS configuration (Supports localhost, 127.0.0.1, and file:// origins)
app.use(cors({ origin: true, credentials: true }));

// 3. Request Parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// 4. Request Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// 5. Static Frontend Files
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// 6. Mount REST APIs
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/analytics', analyticsRoutes);

// 7. System Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    system: 'EstateLead - Real Estate Digital Marketing & Secure Lead Generation System',
    security_layer: 'SecureEstate Active',
    timestamp: new Date().toISOString(),
    database: db.getDbType(),
  });
});

// 8. Public SPA Fallback Routes
app.get('/properties', (req, res) => {
  res.sendFile(path.join(publicDir, 'properties.html'));
});

app.get('/property/:id', (req, res) => {
  res.sendFile(path.join(publicDir, 'property-details.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

app.get('/crm', (req, res) => {
  res.sendFile(path.join(publicDir, 'crm.html'));
});

app.get('/admin/leads', (req, res) => {
  res.sendFile(path.join(publicDir, 'crm.html'));
});

app.get('/analytics', (req, res) => {
  res.sendFile(path.join(publicDir, 'analytics.html'));
});

app.get('/admin/analytics', (req, res) => {
  res.sendFile(path.join(publicDir, 'analytics.html'));
});

app.get('/saved', (req, res) => {
  res.sendFile(path.join(publicDir, 'saved.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(publicDir, 'register.html'));
});

// 9. Centralized Error Handler (Never leak stack traces)
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err);
  const statusCode = err.status || 500;
  const message = statusCode === 500 ? 'An internal server error occurred.' : err.message;
  res.status(statusCode).json({
    success: false,
    error: message,
    code: err.code || 'SERVER_ERROR',
  });
});

async function startServer() {
  try {
    await db.initConnection();
    await db.createSchema();

    const server = app.listen(PORT, () => {
      console.log(`🚀 EstateLead Server running on: http://localhost:${PORT}`);
      console.log(`🔒 Security Layer: SecureEstate Active | Database: ${db.getDbType()}`);
    });

    return server;
  } catch (error) {
    console.error('Fatal Server Startup Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
