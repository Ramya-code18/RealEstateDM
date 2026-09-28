/**
 * EstateLead - Database Seeding Module (SecureEstate Layer)
 * Populates verified administrator accounts (Ramya, Rohini, System Admin),
 * agent accounts (Vikram), test customers (Priya, Rahul), luxury properties,
 * and initializes realistic lead pipelines for CRM and Analytics.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function seedDatabase() {
  console.log('🌱 Initializing EstateLead Database & Seeding Data...');

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

    // 1. Seed Accounts (Admins, Agents, Customers)
    console.log(' -> Seeding User Accounts...');
    const adminHash = await bcrypt.hash('Admin@123', 10);
    const agentHash = await bcrypt.hash('Agent@123', 10);
    const customerHash = await bcrypt.hash('Customer@123', 10);

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
      {
        name: 'System Administrator',
        email: 'admin@estatelead.com',
        phone: '9840001122',
        password_hash: adminHash,
        role: 'admin',
        preferred_property_type: 'Luxury Villas',
        preferred_location: 'Chennai',
        budget_range: 'Above ₹1.5 Cr',
      },
      {
        name: 'Vikram Sharma',
        email: 'agent.vikram@estatelead.com',
        phone: '9840199887',
        password_hash: agentHash,
        role: 'agent',
        preferred_property_type: 'Apartments',
        preferred_location: 'Chennai',
        budget_range: '₹80L - ₹1.5 Cr',
      },
      {
        name: 'Priya Sundaram',
        email: 'priya.sundaram@example.com',
        phone: '9840122334',
        password_hash: customerHash,
        role: 'customer',
        preferred_property_type: 'Apartments',
        preferred_location: 'Chennai',
        budget_range: '₹50L - ₹80L',
      },
      {
        name: 'Rahul Sharma',
        email: 'rahul.sharma@example.com',
        phone: '9840133445',
        password_hash: customerHash,
        role: 'customer',
        preferred_property_type: 'Luxury Villas',
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
    console.log(` ✅ Inserted ${usersToInsert.length} user accounts.`);

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

    const propMap = [];
    for (const p of propertiesToInsert) {
      const res = await db.query(
        `INSERT INTO properties (
          title, property_type, location, bhk, price,
          bedrooms, bathrooms, parking, area, purpose, availability, status,
          featured, description, amenities, image_url, images,
          contact_phone, contact_email, views_count, saves_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING id`,
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
          Boolean(p.featured),
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
      const insertedId = (res.rows && res.rows[0] && res.rows[0].id) || res.lastID;
      propMap.push(insertedId);
    }
    console.log(` ✅ Inserted ${propertiesToInsert.length} active property catalog listings.`);

    // 3. Seed Realistic Leads & Pipeline
    console.log(' -> Seeding Leads Pipeline & Followups...');
    const vikramId = userMap['agent.vikram@estatelead.com'];
    const priyaId = userMap['priya.sundaram@example.com'];
    const rahulId = userMap['rahul.sharma@example.com'];

    const sampleLeads = [
      {
        user_id: priyaId,
        property_id: propMap[0],
        name: 'Priya Sundaram',
        phone: '9840122334',
        email: 'priya.sundaram@example.com',
        location: 'Chennai',
        preferred_location: 'Chennai',
        budget: '₹50L - ₹80L',
        property_type: 'Apartments',
        enquiry_type: 'Schedule Site Visit',
        source: 'Website',
        source_page: 'Property Details - Green Valley Residency',
        timeline: 'Within 15 days',
        lead_score: 85,
        lead_category: 'HOT',
        score_category: 'HOT',
        score_reason: '• High Intent (+25 pts): Schedule Site Visit\n• Urgency (+25 pts): Within 15 days\n• Budget Match (+20 pts): ₹50L - ₹80L\n• Verified Contact (+15 pts)',
        status: 'Site Visit',
        assigned_to: vikramId,
        assigned_agent_id: vikramId,
      },
      {
        user_id: rahulId,
        property_id: propMap[1],
        name: 'Rahul Sharma',
        phone: '9840133445',
        email: 'rahul.sharma@example.com',
        location: 'Bangalore',
        preferred_location: 'Bangalore',
        budget: 'Above ₹1.5 Cr',
        property_type: 'Luxury Villas',
        enquiry_type: 'Schedule Site Visit',
        source: 'Website',
        source_page: 'Property Details - Silicon Grandeur Villa',
        timeline: 'Immediate',
        lead_score: 92,
        lead_category: 'HOT',
        score_category: 'HOT',
        score_reason: '• High Intent (+25 pts): Schedule Site Visit\n• Urgency (+25 pts): Immediate\n• Premium Ticket Size (+25 pts): Above ₹1.5 Cr\n• Complete Contact Data (+15 pts)',
        status: 'Negotiation',
        assigned_to: vikramId,
        assigned_agent_id: vikramId,
      },
      {
        user_id: null,
        property_id: propMap[2],
        name: 'Ananya Krishnan',
        phone: '9840144556',
        email: 'ananya.k@example.com',
        location: 'Chennai',
        preferred_location: 'Chennai',
        budget: 'Above ₹1.5 Cr',
        property_type: 'Penthouses',
        enquiry_type: 'Property Enquiry',
        source: 'Website',
        source_page: 'Property Details - Skyline Palms Penthouse',
        timeline: 'Within 1-3 months',
        lead_score: 72,
        lead_category: 'WARM',
        score_category: 'WARM',
        score_reason: '• Verified Inquiry (+20 pts)\n• Timeline (+15 pts): Within 1-3 months\n• Luxury Tier (+25 pts)\n• Mobile Verified (+12 pts)',
        status: 'Contacted',
        assigned_to: vikramId,
        assigned_agent_id: vikramId,
      },
      {
        user_id: null,
        property_id: propMap[3],
        name: 'Karthik Raja',
        phone: '9840155667',
        email: 'karthik.raja@example.com',
        location: 'Coimbatore',
        preferred_location: 'Coimbatore',
        budget: '₹50L - ₹80L',
        property_type: 'Apartments',
        enquiry_type: 'Instant Callback',
        source: 'Website',
        source_page: 'Property Details - Marutham Heritage',
        timeline: 'Within 1-3 months',
        lead_score: 65,
        lead_category: 'WARM',
        score_category: 'WARM',
        score_reason: '• Instant Callback (+18 pts)\n• Budget alignment (+20 pts)\n• Timeline (+15 pts)',
        status: 'New',
        assigned_to: vikramId,
        assigned_agent_id: vikramId,
      },
      {
        user_id: null,
        property_id: propMap[4],
        name: 'Sneha Reddy',
        phone: '9840166778',
        email: 'sneha.reddy@example.com',
        location: 'Hyderabad',
        preferred_location: 'Hyderabad',
        budget: 'Under ₹50 Lakhs',
        property_type: 'Apartments',
        enquiry_type: 'Gated Brochure',
        source: 'Website',
        source_page: 'Property Catalog',
        timeline: 'Exploring / Long-term',
        lead_score: 42,
        lead_category: 'COLD',
        score_category: 'COLD',
        score_reason: '• Exploratory Brochure Download (+10 pts)\n• Flexible Timeline (+10 pts)\n• Under-budget (+10 pts)\n• Single Channel (+12 pts)',
        status: 'New',
        assigned_to: null,
        assigned_agent_id: null,
      },
      {
        user_id: null,
        property_id: propMap[0],
        name: 'Dinesh Kumar',
        phone: '9840177889',
        email: 'dinesh.k@example.com',
        location: 'Chennai',
        preferred_location: 'Chennai',
        budget: '₹80L - ₹1.5 Cr',
        property_type: 'Apartments',
        enquiry_type: 'Property Enquiry',
        source: 'Website',
        source_page: 'Property Details - Green Valley Residency',
        timeline: 'Immediate',
        lead_score: 95,
        lead_category: 'HOT',
        score_category: 'HOT',
        score_reason: '• Converted deal (+25 pts)\n• High Budget Tier (+25 pts)\n• Immediate purchase (+25 pts)\n• Complete verification (+20 pts)',
        status: 'Converted',
        assigned_to: vikramId,
        assigned_agent_id: vikramId,
      },
    ];

    const leadIds = [];
    for (const lead of sampleLeads) {
      const res = await db.query(
        `INSERT INTO leads (
          user_id, property_id, name, phone, email, location, preferred_location,
          budget, property_type, enquiry_type, source, source_page, timeline,
          lead_score, score, lead_category, score_category, score_reason,
          status, assigned_to, assigned_agent_id, consent_given, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, TRUE, '127.0.0.1') RETURNING id`,
        [
          lead.user_id,
          lead.property_id,
          lead.name,
          lead.phone,
          lead.email,
          lead.location,
          lead.preferred_location,
          lead.budget,
          lead.property_type,
          lead.enquiry_type,
          lead.source,
          lead.source_page,
          lead.timeline,
          lead.lead_score,
          lead.lead_score,
          lead.lead_category,
          lead.score_category,
          lead.score_reason,
          lead.status,
          lead.assigned_to,
          lead.assigned_agent_id,
        ]
      );
      const insertedId = (res.rows && res.rows[0] && res.rows[0].id) || res.lastID;
      leadIds.push(insertedId);
    }
    console.log(` ✅ Inserted ${sampleLeads.length} sample leads across HOT/WARM/COLD categories.`);

    // 4. Seed Follow-ups
    if (leadIds.length > 0) {
      const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];

      await db.query(
        `INSERT INTO followups (lead_id, agent_id, followup_date, followup_time, notes, status)
         VALUES ($1, $2, $3, '11:00 AM', 'Confirmed site visit at Green Valley Residency. Customer requested floor plans.', 'Pending')`,
        [leadIds[0], vikramId, tomorrowStr]
      );
      await db.query(
        `INSERT INTO followups (lead_id, agent_id, followup_date, followup_time, notes, status)
         VALUES ($1, $2, $3, '03:30 PM', 'Discussed customization options for private garden and solar grid with Rahul.', 'Completed')`,
        [leadIds[1], vikramId, todayStr]
      );
      console.log(' ✅ Inserted sample CRM follow-ups.');
    }

    // 5. Seed User Activity & Wishlist
    if (priyaId && propMap[0]) {
      await db.query(
        `INSERT INTO saved_properties (user_id, property_id) VALUES ($1, $2)`,
        [priyaId, propMap[0]]
      );
      await db.query(
        `INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address)
         VALUES ($1, $2, 'view_property', 'Viewed Green Valley Residency details', '127.0.0.1')`,
        [priyaId, propMap[0]]
      );
    }

    // 6. Seed Security Events & Audit Logs
    const ramyaId = userMap['953624244046@ritrjpm.ac.in'];
    await db.query(
      `INSERT INTO security_events (event_type, user_id, user_identifier, description, severity, result, ip_address)
       VALUES ('SYSTEM_BOOTSTRAP', $1, '953624244046@ritrjpm.ac.in', 'SecureEstate intermediate security layer initialized and active.', 'LOW', 'SUCCESS', '127.0.0.1')`,
      [ramyaId]
    );

    await db.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, entity, entity_id, result, ip_address, details)
       VALUES ($1, 'Ramya (Admin)', 'admin', 'SYSTEM_INITIALIZATION', 'SYSTEM', '1', 'SUCCESS', '127.0.0.1', 'EstateLead platform initialized with verified security layers.')`,
      [ramyaId]
    );

    console.log(' ✅ Security events and audit trails initialized.');

    console.log('\n======================================================================');
    console.log('🎉 [SUCCESS] EstateLead Database Initialized Cleanly!');
    console.log('======================================================================');
    console.log('Active Administrators:');
    console.log(' • Ramya  : 953624244046@ritrjpm.ac.in / Admin@123 (Mob: 7418738393)');
    console.log(' • Rohini : 953624244048@ritrjpm.ac.in / Admin@123 (Mob: 9789165375)');
    console.log(' • Admin  : admin@estatelead.com / Admin@123');
    console.log('Active Agent:');
    console.log(' • Vikram : agent.vikram@estatelead.com / Agent@123');
    console.log('Active Customers:');
    console.log(' • Priya  : priya.sundaram@example.com / Customer@123');
    console.log(' • Rahul  : rahul.sharma@example.com / Customer@123');
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

