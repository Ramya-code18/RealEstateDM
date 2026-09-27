/**
 * EstateLead - Database Seeding Module (SecureEstate Layer)
 * Populates verified administrator accounts (Ramya & Rohini), luxury property catalog,
 * and initializes a clean production database without dummy demo leads.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function seedDatabase() {
  console.log('🌱 Initializing EstateLead Database & Seeding Clean Production State...');

  try {
    await db.initConnection();
    await db.createSchema();

    // Clean tables in reverse dependency order
    await db.query('DELETE FROM followups');
    await db.query('DELETE FROM saved_properties');
    await db.query('DELETE FROM user_activity');
    await db.query('DELETE FROM leads');
    await db.query('DELETE FROM properties');
    await db.query('DELETE FROM users');
    await db.query('DELETE FROM audit_logs');
    await db.query('DELETE FROM security_events');

    // 1. Seed Administrator Accounts (Ramya & Rohini)
    console.log(' -> Seeding Administrators (Ramya & Rohini)...');
    const adminHash = await bcrypt.hash('Admin@123', 10);

    const usersToInsert = [
      {
        name: 'Ramya (Admin)',
        email: '953624244046@ritrjpm.ac.in',
        phone: '7418738393',
        password_hash: adminHash,
        role: 'admin',
        preferred_property_type: 'Luxury Villas',
        preferred_location: 'Chennai',
        budget_range: 'Above ₹1.5 Cr',
      },
      {
        name: 'Rohini (Admin)',
        email: '953624244048@ritrjpm.ac.in',
        phone: '9789165375',
        password_hash: adminHash,
        role: 'admin',
        preferred_property_type: 'Apartments',
        preferred_location: 'Bangalore',
        budget_range: 'Above ₹1.5 Cr',
      },
    ];

    const userMap = {};
    for (const u of usersToInsert) {
      const res = await db.query(
        `INSERT INTO users (
          name, email, phone, password_hash, role,
          preferred_property_type, preferred_location, budget_range,
          account_status, failed_login_attempts
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 0) RETURNING id`,
        [u.name, u.email, u.phone, u.password_hash, u.role, u.preferred_property_type, u.preferred_location, u.budget_range]
      );
      const insertedId = (res.rows && res.rows[0] && res.rows[0].id) || res.lastID;
      userMap[u.email] = insertedId;
    }
    console.log(` ✅ Inserted ${usersToInsert.length} administrator accounts.`);

    // 2. Seed Real Estate Property Catalog
    console.log(' -> Seeding Property Inventory Catalog...');
    const propertiesToInsert = [
      {
        title: 'Green Valley Residency',
        property_type: 'Apartments',
        location: 'Chennai, OMR',
        bhk: 3,
        price: 8500000,
        bedrooms: 3,
        bathrooms: 3,
        parking: 2,
        area: 1650,
        purpose: 'Buy',
        availability: 'Available',
        featured: true,
        description: 'Ultra-modern 3 BHK luxury apartment situated in the heart of OMR IT corridor with panoramic city views, club house, infinity swimming pool, and Italian marble flooring.',
        amenities: 'Infinity Pool, Clubhouse, 24/7 Security, Power Backup, Gym, EV Charging Station, Children Play Area',
        image_url: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1000&q=80',
        images: '["https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1000&q=80","https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=80"]',
        contact_phone: '7418738393',
        contact_email: '953624244046@ritrjpm.ac.in',
        views_count: 142,
        saves_count: 28,
      },
      {
        title: 'Silicon Grandeur Villa',
        property_type: 'Luxury Villas',
        location: 'Bangalore, Whitefield',
        bhk: 4,
        price: 24000000,
        bedrooms: 4,
        bathrooms: 5,
        parking: 3,
        area: 3400,
        purpose: 'Buy',
        availability: 'Available',
        featured: true,
        description: 'Exquisite 4 BHK private gated villa featuring landscaped zen gardens, private jacuzzi, solar energy grid, and smart home automation in prime Whitefield.',
        amenities: 'Private Garden, Smart Home Automation, Jacuzzi, Solar Grid, 3-Car Parking, Tennis Court',
        image_url: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1000&q=80',
        images: '["https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1000&q=80","https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1000&q=80"]',
        contact_phone: '9789165375',
        contact_email: '953624244048@ritrjpm.ac.in',
        views_count: 210,
        saves_count: 45,
      },
      {
        title: 'Skyline Palms Penthouse',
        property_type: 'Penthouses',
        location: 'Chennai, ECR',
        bhk: 4,
        price: 31000000,
        bedrooms: 4,
        bathrooms: 4,
        parking: 2,
        area: 4200,
        purpose: 'Buy',
        availability: 'Available',
        featured: true,
        description: 'Breathtaking sea-view penthouse with private rooftop infinity deck, floor-to-ceiling glass architecture, and private elevator foyer along scenic East Coast Road.',
        amenities: 'Sea View Terrace, Private Elevator, Helipad Access, Wine Cellar, Concierge Service',
        image_url: 'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1000&q=80',
        images: '["https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1000&q=80"]',
        contact_phone: '7418738393',
        contact_email: '953624244046@ritrjpm.ac.in',
        views_count: 315,
        saves_count: 67,
      },
      {
        title: 'Marutham Heritage Enclave',
        property_type: 'Apartments',
        location: 'Coimbatore, RS Puram',
        bhk: 2,
        price: 5800000,
        bedrooms: 2,
        bathrooms: 2,
        parking: 1,
        area: 1250,
        purpose: 'Buy',
        availability: 'Available',
        featured: false,
        description: 'Peaceful luxury apartment facing the Nilgiri foothills, offering clean air, lush community parks, and direct access to RS Puram commercial centers.',
        amenities: '24/7 Water Supply, Landscape Garden, Solar Streetlights, Covered Parking, CCTV Surveillance',
        image_url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=80',
        images: '["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=80"]',
        contact_phone: '9789165375',
        contact_email: '953624244048@ritrjpm.ac.in',
        views_count: 94,
        saves_count: 15,
      },
      {
        title: 'Cyber Towers Luxury Suite',
        property_type: 'Apartments',
        location: 'Hyderabad, HITEC City',
        bhk: 3,
        price: 11500000,
        bedrooms: 3,
        bathrooms: 3,
        parking: 2,
        area: 1900,
        purpose: 'Buy',
        availability: 'Available',
        featured: true,
        description: 'Premium modern apartment located 5 minutes from Cyber Towers, with world-class clubhouse amenities and walking distance to metro line.',
        amenities: 'Metro Connectivity, Rooftop Pool, Badminton Court, 24/7 Generator, Video Door Phone',
        image_url: 'https://images.unsplash.com/photo-1574362848149-11496d93a7c7?auto=format&fit=crop&w=1000&q=80',
        images: '["https://images.unsplash.com/photo-1574362848149-11496d93a7c7?auto=format&fit=crop&w=1000&q=80"]',
        contact_phone: '7418738393',
        contact_email: '953624244046@ritrjpm.ac.in',
        views_count: 175,
        saves_count: 32,
      },
      {
        title: 'Serene Bay Waterfront Home',
        property_type: 'Apartments',
        location: 'Chennai, Adyar',
        bhk: 2,
        price: 45000,
        bedrooms: 2,
        bathrooms: 2,
        parking: 1,
        area: 1100,
        purpose: 'Rent',
        availability: 'Available',
        featured: false,
        description: 'Fully-furnished executive 2 BHK rental apartment facing Adyar river estuary with premium wooden flooring and modular appliances.',
        amenities: 'Fully Furnished, River View, Lift, Security, Water Treatment Plant',
        image_url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1000&q=80',
        images: '["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1000&q=80"]',
        contact_phone: '9789165375',
        contact_email: '953624244048@ritrjpm.ac.in',
        views_count: 82,
        saves_count: 19,
      },
    ];

    for (const p of propertiesToInsert) {
      await db.query(
        `INSERT INTO properties (
          title, property_type, location, bhk, price,
          bedrooms, bathrooms, parking, area, purpose, availability, status,
          featured, description, amenities, image_url, images,
          contact_phone, contact_email, views_count, saves_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          p.title,
          p.property_type,
          p.location,
          p.bhk,
          p.price,
          p.bedrooms,
          p.bathrooms,
          p.parking,
          p.area,
          p.purpose,
          p.availability,
          'Active',
          p.featured ? 1 : 0,
          p.description,
          p.amenities,
          p.image_url,
          p.images,
          p.contact_phone,
          p.contact_email,
          p.views_count,
          p.saves_count,
        ]
      );
    }
    console.log(` ✅ Inserted ${propertiesToInsert.length} active property catalog listings.`);

    // 3. Initial Audit Trail
    const ramyaId = userMap['953624244046@ritrjpm.ac.in'];
    await db.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, entity, entity_id, result, ip_address, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '127.0.0.1', $8)`,
      [ramyaId, 'Ramya (Admin)', 'admin', 'SYSTEM_INITIALIZATION', 'SYSTEM', '1', 'SUCCESS', 'Clean database initialized. Demo users and demo leads removed. Ready for live capture.']
    );
    console.log(' ✅ Clean audit logs initialized.');

    console.log('\n======================================================================');
    console.log('🎉 [SUCCESS] EstateLead Database Initialized Cleanly!');
    console.log('======================================================================');
    console.log('Active Administrators:');
    console.log(' • Ramya  : 953624244046@ritrjpm.ac.in / Admin@123 (Mob: 7418738393)');
    console.log(' • Rohini : 953624244048@ritrjpm.ac.in / Admin@123 (Mob: 9789165375)');
    console.log('======================================================================\n');
  } catch (error) {
    console.error('Fatal Seeding Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  seedDatabase().then(() => process.exit(0));
}

module.exports = { seedDatabase };
