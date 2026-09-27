/**
 * EstateLead - Lead Generation & Algorithmic Lead Scoring REST API (Stage 4)
 * Provides rule-based explainable scoring (0-100), categorization (HOT/WARM/COLD),
 * anti-spam rate limiting, automated agent assignment, brochure downloads,
 * site visit bookings, and audit tracking.
 */
const express = require('express');
const router = express.Router();
const validator = require('validator');
const db = require('../config/db');
const { optionalAuth, authenticate } = require('../middleware/auth');
const { sanitizeInput, enquiryLimiter } = require('../middleware/security');
const { logAudit } = require('../middleware/audit');

/**
 * Algorithmic Lead Scoring Engine
 * Computes an explainable score from 0 to 100 based on:
 * 1. Intent & Enquiry Type (up to 25 pts)
 * 2. Purchase Timeline / Urgency (up to 25 pts)
 * 3. Budget Range (up to 25 pts)
 * 4. Contact Information Completeness (up to 15 pts)
 * 5. Behavioral Engagement / Prior Activity (up to 10 pts)
 */
async function computeLeadScore({
  enquiry_type = 'General Enquiry',
  timeline = 'Within 1-3 months',
  budget = '₹50L - ₹80L',
  phone = '',
  email = '',
  userId = null,
  propertyId = null,
}) {
  let score = 0;
  const reasons = [];

  // 1. Enquiry Intent & Commitment (Max 25 pts)
  const normType = (enquiry_type || '').toLowerCase();
  if (normType.includes('site visit') || normType.includes('schedule')) {
    score += 25;
    reasons.push('Schedule Site Visit (+25 pts: High-commitment physical tour intent)');
  } else if (normType.includes('callback') || normType.includes('buy') || normType.includes('property enquiry')) {
    score += 20;
    reasons.push('Direct Callback/Property Enquiry (+20 pts: High purchase consideration)');
  } else if (normType.includes('mortgage') || normType.includes('emi') || normType.includes('finance')) {
    score += 18;
    reasons.push('Financing/Mortgage Consultation (+18 pts: Active loan eligibility check)');
  } else if (normType.includes('brochure')) {
    score += 12;
    reasons.push('Brochure Download (+12 pts: Project asset evaluation)');
  } else {
    score += 10;
    reasons.push('General Web Enquiry (+10 pts: Exploratory interest)');
  }

  // 2. Timeline / Urgency (Max 25 pts)
  const normTimeline = (timeline || '').toLowerCase();
  if (normTimeline.includes('immediate') || normTimeline.includes('15 days') || normTimeline.includes('urgent')) {
    score += 25;
    reasons.push('Immediate/15 Days Timeline (+25 pts: Fast conversion readiness)');
  } else if (normTimeline.includes('1 month') || normTimeline.includes('1-3 month') || normTimeline.includes('3 month')) {
    score += 18;
    reasons.push('1-3 Months Timeline (+18 pts: Active quarter purchase target)');
  } else if (normTimeline.includes('3-6 month') || normTimeline.includes('6 month')) {
    score += 10;
    reasons.push('3-6 Months Timeline (+10 pts: Mid-term pipeline)');
  } else {
    score += 5;
    reasons.push('Long-term / Exploring (+5 pts: Nurturing stage)');
  }

  // 3. Budget Range & Purchasing Capacity (Max 25 pts)
  const normBudget = (budget || '').toLowerCase();
  if (normBudget.includes('above 1.5') || normBudget.includes('above ₹1.5') || normBudget.includes('2 cr') || normBudget.includes('luxury')) {
    score += 25;
    reasons.push('Luxury Tier Budget > ₹1.5 Cr (+25 pts: High transaction value)');
  } else if (normBudget.includes('80') || normBudget.includes('1.5')) {
    score += 20;
    reasons.push('Mid-Premium Tier Budget ₹80L-₹1.5Cr (+20 pts: Prime residential bracket)');
  } else if (normBudget.includes('50') || normBudget.includes('80')) {
    score += 15;
    reasons.push('Standard Tier Budget ₹50L-₹80L (+15 pts: Core market segment)');
  } else {
    score += 10;
    reasons.push('Budget Tier < ₹50L (+10 pts: Entry level housing)');
  }

  // 4. Contact Data Completeness & Verification (Max 15 pts)
  const rawPhone = String(phone).replace(/[\s\-\(\)\+]/g, '');
  const hasValidPhone = rawPhone.length >= 10;
  const hasValidEmail = validator.isEmail(email || '');

  if (hasValidPhone && hasValidEmail) {
    score += 15;
    reasons.push('Verified Contact Data (+15 pts: Valid email & 10-digit mobile)');
  } else if (hasValidPhone) {
    score += 10;
    reasons.push('Phone Verified (+10 pts: Direct dialable mobile)');
  } else if (hasValidEmail) {
    score += 8;
    reasons.push('Email Verified (+8 pts: Electronic contact verified)');
  } else {
    reasons.push('Minimal Contact Info (+0 pts)');
  }

  // 5. Behavioral Engagement Bonus (Max 10 pts)
  if (userId) {
    try {
      const activityRows = await db.all(
        'SELECT count(*) as count FROM user_activity WHERE user_id = $1',
        [userId]
      );
      const activityCount = activityRows[0] ? parseInt(activityRows[0].count, 10) : 0;

      if (activityCount >= 5) {
        score += 10;
        reasons.push(`High Platform Engagement (+10 pts: ${activityCount} property browsing interactions)`);
      } else if (activityCount >= 2) {
        score += 6;
        reasons.push(`Moderate Platform Engagement (+6 pts: ${activityCount} property views)`);
      } else {
        score += 4;
        reasons.push('Authenticated Customer Account (+4 pts: Registered profile)');
      }
    } catch (e) {
      score += 4;
      reasons.push('Authenticated Customer Account (+4 pts)');
    }
  } else {
    score += 2;
    reasons.push('First-Time Web Visitor (+2 pts)');
  }

  // Cap score between 0 and 100
  score = Math.max(0, Math.min(100, score));

  // Determine Categorization
  let category = 'COLD';
  if (score >= 75) {
    category = 'HOT';
  } else if (score >= 50) {
    category = 'WARM';
  }

  const reasonSummary = `[${reasons.join(' | ')}] => Total Score: ${score}/100 (${category} Lead)`;

  return {
    score,
    category,
    reasons,
    reasonSummary,
  };
}

/**
 * Helper to select an assigned agent
 */
async function getAssignedAgent() {
  try {
    const agents = await db.all(
      `SELECT id, name, email, phone FROM users WHERE role IN ('agent', 'admin') ORDER BY id ASC`
    );
    if (agents && agents.length > 0) {
      return agents[0];
    }
  } catch (e) {}
  return { id: null, name: 'Senior Consultant', email: 'sales@estatelead.com', phone: '+91 98401 00001' };
}

/**
 * POST /api/leads/enquire
 * Main Lead Capture Endpoint for property enquiries and general interest forms
 */
router.post('/enquire', enquiryLimiter, optionalAuth, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let {
    property_id,
    name,
    phone,
    email,
    location,
    preferred_location,
    budget,
    property_type,
    enquiry_type = 'Property Enquiry',
    timeline = 'Within 1-3 months',
    preferred_contact = 'Phone',
    message = '',
    source_page = 'Website / Property Page',
    consent_given = true,
  } = req.body;

  // Validation
  if (!name || !phone || !email) {
    return res.status(400).json({
      success: false,
      error: 'Please provide your Name, Phone number, and Email address.',
    });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({
      success: false,
      error: 'Please enter a valid email address.',
    });
  }

  const cleanPhone = String(phone).replace(/[\s\-\(\)\+]/g, '');
  if (cleanPhone.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'Please enter a valid phone number (at least 8 digits).',
    });
  }

  // Sanitize Inputs
  name = sanitizeInput(name);
  phone = sanitizeInput(phone);
  email = sanitizeInput(email.toLowerCase());
  location = sanitizeInput(location || preferred_location || 'Chennai');
  budget = sanitizeInput(budget || '₹50L - ₹80L');
  property_type = sanitizeInput(property_type || 'Apartments');
  enquiry_type = sanitizeInput(enquiry_type);
  timeline = sanitizeInput(timeline);
  preferred_contact = sanitizeInput(preferred_contact);
  message = sanitizeInput(message);
  source_page = sanitizeInput(source_page);

  const userId = req.user ? req.user.id : null;
  const propertyId = property_id ? parseInt(property_id, 10) : null;

  try {
    // 1. Calculate Algorithmic Lead Score & Categorization
    const scoreResult = await computeLeadScore({
      enquiry_type,
      timeline,
      budget,
      phone,
      email,
      userId,
      propertyId,
    });

    // 2. Select Assigned Agent
    const assignedAgent = await getAssignedAgent();
    const assignedId = assignedAgent.id;

    // 3. Compute Recommended Follow-Up Date based on Lead Priority
    const now = new Date();
    let followUpDays = 2; // Default for WARM
    if (scoreResult.category === 'HOT') {
      followUpDays = 0; // Immediate (Today)
    } else if (scoreResult.category === 'COLD') {
      followUpDays = 5;
    }
    const followUpDate = new Date(now.getTime() + followUpDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 4. Store Lead Record in Secure Database
    const insertResult = await db.query(
      `INSERT INTO leads (
        user_id, property_id, name, phone, email,
        location, preferred_location, budget, property_type,
        enquiry_type, source, source_page, timeline, preferred_contact,
        message, lead_score, score, lead_category, score_category, score_reason,
        status, assigned_to, assigned_agent_id, follow_up_date, notes,
        consent_given, ip_address
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, 'Website', $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        'New', $20, $21, $22, $23,
        $24, $25
      ) RETURNING id`,
      [
        userId,
        propertyId,
        name,
        phone,
        email,
        location,
        location,
        budget,
        property_type,
        enquiry_type,
        source_page,
        timeline,
        preferred_contact,
        message,
        scoreResult.score,
        scoreResult.score,
        scoreResult.category,
        scoreResult.category,
        scoreResult.reasonSummary,
        assignedId,
        assignedId,
        followUpDate,
        `Automated lead classification: ${scoreResult.category} (${scoreResult.score}/100). Recommended follow-up: ${followUpDays === 0 ? 'Urgent within 30 mins' : `Within ${followUpDays} days`}.`,
        consent_given ? 1 : 0,
        ip,
      ]
    );

    const leadId = (insertResult.rows && insertResult.rows[0] && insertResult.rows[0].id) || insertResult.lastID;

    // 5. Record User Activity if authenticated
    if (userId) {
      await db.query(
        `INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address)
         VALUES ($1, $2, 'submit_enquiry', $3, $4)`,
        [userId, propertyId, `Submitted ${enquiry_type} for ${property_type} in ${location}`, ip]
      );
    }

    // 6. Security Audit Trail
    await logAudit({
      userId: userId || null,
      userName: name,
      userRole: req.user ? req.user.role : 'visitor',
      action: 'LEAD_CAPTURED',
      entity: 'LEAD',
      entityId: leadId,
      result: 'SUCCESS',
      ip,
      details: `Lead #${leadId} captured for ${name}. Score: ${scoreResult.score} (${scoreResult.category})`,
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your enquiry has been received. A property specialist will contact you shortly.',
      lead_id: leadId,
      lead_summary: {
        id: leadId,
        score: scoreResult.score,
        category: scoreResult.category,
        assigned_agent: assignedAgent.name,
        assigned_phone: assignedAgent.phone,
        follow_up_timeline: scoreResult.category === 'HOT' ? 'Priority callback within 30 minutes' : 'Consultant callback within 24 hours',
      },
    });
  } catch (error) {
    console.error('Lead Capture Error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while submitting your enquiry. Please try again.',
    });
  }
});

/**
 * POST /api/leads/site-visit
 * Dedicated endpoint to schedule an on-site property tour
 */
router.post('/site-visit', enquiryLimiter, optionalAuth, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let {
    property_id,
    name,
    phone,
    email,
    visit_date,
    visit_time = '10:00 AM',
    notes = '',
    budget = '₹80L - ₹1.5 Cr',
    property_type = 'Apartments',
  } = req.body;

  if (!name || !phone || !email || !visit_date) {
    return res.status(400).json({
      success: false,
      error: 'Please provide Name, Phone, Email, and Preferred Visit Date.',
    });
  }

  name = sanitizeInput(name);
  phone = sanitizeInput(phone);
  email = sanitizeInput(email.toLowerCase());
  visit_date = sanitizeInput(visit_date);
  visit_time = sanitizeInput(visit_time);
  notes = sanitizeInput(notes);

  const message = `Scheduled Site Visit for ${visit_date} at ${visit_time}. Notes: ${notes}`;

  req.body = {
    ...req.body,
    name,
    phone,
    email,
    property_id,
    enquiry_type: 'Schedule Site Visit',
    timeline: 'Immediate / Within 15 days',
    budget,
    property_type,
    message,
    source_page: 'Property Page / Site Visit Scheduler',
  };

  return router.handle(
    Object.assign(req, { url: '/enquire', method: 'POST' }),
    res
  );
});

/**
 * POST /api/leads/callback
 * Instant 1-click callback request
 */
router.post('/callback', enquiryLimiter, optionalAuth, async (req, res) => {
  let { name, phone, email, property_id, property_title, preferred_time = 'Immediate' } = req.body;

  if (!name || !phone) {
    return res.status(400).json({
      success: false,
      error: 'Please provide your Name and Phone number for the instant callback.',
    });
  }

  const generatedEmail = email || `${String(phone).replace(/\D/g, '')}@lead.estatelead.com`;

  req.body = {
    ...req.body,
    name,
    phone,
    email: generatedEmail,
    property_id,
    enquiry_type: 'Instant Callback',
    timeline: 'Immediate / Within 15 days',
    message: `Requested instant callback for ${property_title || 'property'}. Preferred time: ${preferred_time}`,
    source_page: 'Quick Callback Widget',
  };

  return router.handle(
    Object.assign(req, { url: '/enquire', method: 'POST' }),
    res
  );
});

/**
 * POST /api/leads/brochure
 * Gated brochure download: captures lead first, calculates score, then unlocks brochure asset
 */
router.post('/brochure', enquiryLimiter, optionalAuth, async (req, res) => {
  let { property_id, name, phone, email } = req.body;

  if (!name || !phone || !email) {
    return res.status(400).json({
      success: false,
      error: 'Please fill in your contact details to download the property brochure.',
    });
  }

  // Fetch property details to construct brochure package
  let propTitle = 'EstateLead Premium Residence';
  if (property_id) {
    const prop = await db.get('SELECT title FROM properties WHERE id = $1', [property_id]);
    if (prop) propTitle = prop.title;
  }

  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  name = sanitizeInput(name);
  phone = sanitizeInput(phone);
  email = sanitizeInput(email.toLowerCase());

  try {
    const scoreResult = await computeLeadScore({
      enquiry_type: 'Download Brochure',
      timeline: 'Within 1-3 months',
      budget: '₹80L - ₹1.5 Cr',
      phone,
      email,
      userId: req.user ? req.user.id : null,
      propertyId: property_id ? parseInt(property_id, 10) : null,
    });

    const assignedAgent = await getAssignedAgent();

    const insertResult = await db.query(
      `INSERT INTO leads (
        user_id, property_id, name, phone, email,
        location, preferred_location, budget, property_type,
        enquiry_type, source, source_page, timeline, preferred_contact,
        message, lead_score, score, lead_category, score_category, score_reason,
        status, assigned_to, assigned_agent_id, follow_up_date, notes,
        consent_given, ip_address
      ) VALUES (
        $1, $2, $3, $4, $5,
        'Chennai', 'Chennai', '₹80L - ₹1.5 Cr', 'Apartments',
        'Download Brochure', 'Website', 'Gated Brochure Modal', 'Within 1-3 months', 'Email',
        $6, $7, $8, $9, $10, $11,
        'New', $12, $13, $14, $15,
        1, $16
      ) RETURNING id`,
      [
        req.user ? req.user.id : null,
        property_id ? parseInt(property_id, 10) : null,
        name,
        phone,
        email,
        `Downloaded project brochure & floor plans for ${propTitle}`,
        scoreResult.score,
        scoreResult.score,
        scoreResult.category,
        scoreResult.category,
        scoreResult.reasonSummary,
        assignedAgent.id,
        assignedAgent.id,
        new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        `Automated lead from brochure download. Assigned: ${assignedAgent.name}`,
        ip,
      ]
    );

    const leadId = (insertResult.rows && insertResult.rows[0] && insertResult.rows[0].id) || insertResult.lastID;

    return res.status(200).json({
      success: true,
      message: 'Brochure unlocked! Downloading your digital specifications package now.',
      lead_id: leadId,
      brochure_url: `/brochures/property-${property_id || 1}-specifications.pdf`,
      property_title: propTitle,
    });
  } catch (err) {
    console.error('Brochure Gate Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to unlock brochure.' });
  }
});

/**
 * GET /api/leads/score-breakdown/:id
 * Retrieve explainable lead scoring breakdown for transparency and testing
 */
router.get('/score-breakdown/:id', optionalAuth, async (req, res) => {
  const leadId = req.params.id;
  try {
    const lead = await db.get(
      `SELECT id, name, email, phone, enquiry_type, timeline, budget, property_type,
              lead_score, lead_category, score_reason, created_at
       FROM leads WHERE id = $1`,
      [leadId]
    );

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    return res.json({
      success: true,
      lead_id: lead.id,
      score: lead.lead_score,
      category: lead.lead_category,
      rationale: lead.score_reason,
      created_at: lead.created_at,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to retrieve score breakdown.' });
  }
});

module.exports = router;
module.exports.computeLeadScore = computeLeadScore;
