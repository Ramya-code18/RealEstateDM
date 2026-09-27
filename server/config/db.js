/**
 * EstateLead - Universal Database Adapter (SQLite / PostgreSQL)
 * Provides parameterized query execution, robust relational schema management,
 * connection pooling, and data integrity safeguards.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

let dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
let pgPool = null;
let sqliteDb = null;

function convertPgToSqlite(sql) {
  return sql.replace(/\$\d+/g, '?');
}

const dbDir = path.join(__dirname, '..', '..', 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const sqlitePath = path.join(dbDir, 'realestate.db');

async function initConnection() {
  if (dbType === 'postgres') {
    try {
      const { Pool } = require('pg');
      const connectionConfig = process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.PGHOST || 'localhost',
            port: parseInt(process.env.PGPORT || '5432'),
            user: process.env.PGUSER || 'postgres',
            password: process.env.PGPASSWORD || 'postgres',
            database: process.env.PGDATABASE || 'estatelead_db',
          };

      pgPool = new Pool(connectionConfig);
      const client = await pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('✅ Connected to PostgreSQL database successfully.');
      return 'postgres';
    } catch (err) {
      console.warn('⚠️ PostgreSQL connection failed. Gracefully falling back to embedded SQLite.');
      dbType = 'sqlite';
    }
  }

  const sqlite3 = require('sqlite3').verbose();
  return new Promise((resolve, reject) => {
    sqliteDb = new sqlite3.Database(sqlitePath, (err) => {
      if (err) {
        console.error('❌ SQLite connection error:', err);
        return reject(err);
      }
      sqliteDb.serialize(() => {
        sqliteDb.run('PRAGMA foreign_keys = ON;');
        sqliteDb.run('PRAGMA journal_mode = WAL;');
        sqliteDb.run('PRAGMA busy_timeout = 10000;');
      });
      console.log('✅ Connected to SQLite database at:', sqlitePath);
      resolve('sqlite');
    });
  });
}

async function query(text, params = [], silent = false) {
  if (!pgPool && !sqliteDb) {
    await initConnection();
  }

  if (dbType === 'postgres' && pgPool) {
    try {
      const res = await pgPool.query(text, params);
      return {
        rows: res.rows || [],
        rowCount: res.rowCount || 0,
      };
    } catch (err) {
      if (!silent) console.error('Database Query Error (PostgreSQL):', err.message, '\nQuery:', text);
      throw err;
    }
  } else {
    const sqliteSql = convertPgToSqlite(text);
    return new Promise((resolve, reject) => {
      const trimmed = text.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.includes('RETURNING')) {
        sqliteDb.all(sqliteSql, params, (err, rows) => {
          if (err) {
            if (!silent) console.error('Database Query Error (SQLite):', err.message, '\nQuery:', sqliteSql);
            return reject(err);
          }
          resolve({
            rows: rows || [],
            rowCount: (rows || []).length,
          });
        });
      } else {
        sqliteDb.run(sqliteSql, params, function (err) {
          if (err) {
            if (!silent) console.error('Database Run Error (SQLite):', err.message, '\nQuery:', sqliteSql);
            return reject(err);
          }
          resolve({
            rows: [],
            rowCount: this.changes || 0,
            lastID: this.lastID,
          });
        });
      }
    });
  }
}

async function get(text, params = []) {
  const result = await query(text, params);
  return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function all(text, params = []) {
  const result = await query(text, params);
  return result.rows || [];
}

async function createSchema() {
  const isPg = dbType === 'postgres';

  // 1. Users Table
  const userTable = `
    CREATE TABLE IF NOT EXISTS users (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(30),
      role VARCHAR(30) NOT NULL DEFAULT 'customer',
      preferred_property_type VARCHAR(50) DEFAULT 'Apartments',
      preferred_location VARCHAR(100) DEFAULT 'Chennai',
      budget_range VARCHAR(100) DEFAULT '₹50L - ₹80L',
      account_status VARCHAR(20) NOT NULL DEFAULT 'active',
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until ${isPg ? 'TIMESTAMP' : 'DATETIME'} DEFAULT NULL,
      created_at ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
    );
  `;

  // 2. Properties Table
  const propertiesTable = `
    CREATE TABLE IF NOT EXISTS properties (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      title VARCHAR(200) NOT NULL,
      name VARCHAR(200),
      property_type VARCHAR(50) DEFAULT 'Apartment',
      type VARCHAR(50) DEFAULT 'Apartment',
      location VARCHAR(150) NOT NULL,
      bhk INTEGER DEFAULT 2,
      price NUMERIC(15, 2) NOT NULL,
      bedrooms INTEGER DEFAULT 2,
      bathrooms INTEGER DEFAULT 2,
      parking INTEGER DEFAULT 1,
      area NUMERIC(10, 2) NOT NULL,
      purpose VARCHAR(20) DEFAULT 'Buy',
      availability VARCHAR(30) DEFAULT 'Available',
      status VARCHAR(30) NOT NULL DEFAULT 'Active',
      featured BOOLEAN DEFAULT FALSE,
      description TEXT,
      amenities TEXT,
      images TEXT,
      image TEXT,
      image_url TEXT,
      contact_phone VARCHAR(30),
      contact_email VARCHAR(150),
      views_count INTEGER DEFAULT 0,
      saves_count INTEGER DEFAULT 0,
      created_at ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
    );
  `;

  // 3. Leads Table
  const leadsTable = `
    CREATE TABLE IF NOT EXISTS leads (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      user_id INTEGER,
      property_id INTEGER,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      email VARCHAR(150) NOT NULL,
      location VARCHAR(150),
      preferred_location VARCHAR(150),
      budget VARCHAR(50),
      property_type VARCHAR(50),
      enquiry_type VARCHAR(50) DEFAULT 'General Enquiry',
      source VARCHAR(50) NOT NULL DEFAULT 'Website',
      source_page VARCHAR(150) DEFAULT 'Website / Property Catalog',
      timeline VARCHAR(50) DEFAULT 'Within 1 month',
      preferred_contact VARCHAR(30) DEFAULT 'Phone',
      message TEXT,
      lead_score INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0,
      lead_category VARCHAR(20) DEFAULT 'WARM',
      score_category VARCHAR(20) DEFAULT 'WARM',
      score_reason TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'New',
      assigned_to INTEGER,
      assigned_agent_id INTEGER,
      follow_up_date DATE,
      notes TEXT,
      consent_given BOOLEAN NOT NULL DEFAULT TRUE,
      ip_address VARCHAR(50),
      created_at ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_agent_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `;

  // 4. Saved Properties Table (Wishlist Bookmarks)
  const savedPropertiesTable = `
    CREATE TABLE IF NOT EXISTS saved_properties (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      user_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      created_at ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      UNIQUE(user_id, property_id)
    );
  `;

  // 5. User Activity Table (Personalization & Lead Intent Engine)
  const userActivityTable = `
    CREATE TABLE IF NOT EXISTS user_activity (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      user_id INTEGER,
      property_id INTEGER,
      activity_type VARCHAR(50) NOT NULL,
      metadata TEXT,
      ip_address VARCHAR(50),
      timestamp ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
    );
  `;

  // 6. Follow-ups Table
  const followupsTable = `
    CREATE TABLE IF NOT EXISTS followups (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      lead_id INTEGER NOT NULL,
      agent_id INTEGER,
      staff_id INTEGER,
      followup_date DATE NOT NULL,
      followup_time VARCHAR(20) DEFAULT '10:00 AM',
      notes TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Pending',
      created_at ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'},
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `;

  // 7. Audit Logs Table
  const auditLogsTable = `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      user_id INTEGER,
      user_name VARCHAR(100),
      user_role VARCHAR(30),
      action VARCHAR(100) NOT NULL,
      entity VARCHAR(50) NOT NULL,
      entity_id VARCHAR(50),
      result VARCHAR(30) NOT NULL DEFAULT 'SUCCESS',
      ip_address VARCHAR(50),
      details TEXT,
      timestamp ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
    );
  `;

  // 8. Security Events Table
  const securityEventsTable = `
    CREATE TABLE IF NOT EXISTS security_events (
      id ${isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      event_type VARCHAR(100) NOT NULL,
      user_id INTEGER,
      user_identifier VARCHAR(150),
      description TEXT NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
      result VARCHAR(30) NOT NULL DEFAULT 'BLOCKED',
      ip_address VARCHAR(50),
      timestamp ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
    );
  `;

  // 9. System Settings Table
  const systemSettingsTable = `
    CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at ${isPg ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP'}
    );
  `;

  await query(userTable);
  await query(propertiesTable);
  await query(leadsTable);
  await query(savedPropertiesTable);
  await query(userActivityTable);
  await query(followupsTable);
  await query(auditLogsTable);
  await query(securityEventsTable);
  await query(systemSettingsTable);

  // Non-destructive auto-migrations for existing DB files
  const columnsToAdd = [
    { table: 'users', column: 'preferred_property_type', type: 'VARCHAR(50) DEFAULT "Apartments"' },
    { table: 'users', column: 'preferred_location', type: 'VARCHAR(100) DEFAULT "Chennai"' },
    { table: 'users', column: 'budget_range', type: 'VARCHAR(100) DEFAULT "₹50L - ₹80L"' },
    { table: 'properties', column: 'title', type: 'VARCHAR(200)' },
    { table: 'properties', column: 'purpose', type: 'VARCHAR(20) DEFAULT "Buy"' },
    { table: 'properties', column: 'availability', type: 'VARCHAR(30) DEFAULT "Available"' },
    { table: 'properties', column: 'views_count', type: 'INTEGER DEFAULT 0' },
    { table: 'properties', column: 'saves_count', type: 'INTEGER DEFAULT 0' },
    { table: 'properties', column: 'images', type: 'TEXT' },
    { table: 'leads', column: 'user_id', type: 'INTEGER' },
    { table: 'leads', column: 'preferred_location', type: 'VARCHAR(150)' },
    { table: 'leads', column: 'enquiry_type', type: 'VARCHAR(50) DEFAULT "General Enquiry"' },
    { table: 'leads', column: 'score_reason', type: 'TEXT' },
    { table: 'leads', column: 'source_page', type: 'VARCHAR(150) DEFAULT "Website"' },
    { table: 'leads', column: 'assigned_agent_id', type: 'INTEGER' },
    { table: 'leads', column: 'follow_up_date', type: 'DATE' },
    { table: 'leads', column: 'notes', type: 'TEXT' },
    { table: 'followups', column: 'agent_id', type: 'INTEGER' },
    { table: 'audit_logs', column: 'user_role', type: 'VARCHAR(30)' },
  ];

  for (const col of columnsToAdd) {
    try {
      await query(`ALTER TABLE ${col.table} ADD COLUMN ${col.column}`, [], true);
    } catch (e) {
      // Column already exists
    }
  }

  console.log('✅ EstateLead database schema verified and initialized.');
}

module.exports = {
  initConnection,
  createSchema,
  query,
  get,
  all,
  getDbType: () => dbType,
};
