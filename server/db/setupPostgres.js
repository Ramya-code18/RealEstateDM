const { Client } = require('pg');

async function setupPostgres() {
  const adminClient = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: 'Ramya1811#',
    port: 5432,
  });

  try {
    console.log('Connecting to PostgreSQL server...');
    await adminClient.connect();
    console.log('✅ Connected to PostgreSQL server on localhost:5432 with user postgres!');

    const checkRes = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = 'estatelead_db'");
    if (checkRes.rows.length === 0) {
      console.log('Creating estatelead_db database...');
      await adminClient.query('CREATE DATABASE estatelead_db');
      console.log('✅ Database estatelead_db created successfully!');
    } else {
      console.log('✅ Database estatelead_db already exists.');
    }
    await adminClient.end();

    // Verify connection to the new database
    const dbClient = new Client({
      user: 'postgres',
      host: 'localhost',
      database: 'estatelead_db',
      password: 'Ramya1811#',
      port: 5432,
    });
    await dbClient.connect();
    console.log('✅ Successfully connected to estatelead_db database!');
    await dbClient.end();
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL setup error:', err.message);
    return false;
  }
}

if (require.main === module) {
  setupPostgres();
}

module.exports = setupPostgres;
