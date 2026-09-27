/**
 * EstateLead - Admin & Agent Lead Management CRM REST API (Stage 5)
 * Provides centralized lead pipeline management, multi-criteria filtering,
 * status transitions, agent re-assignments, follow-up interactions,
 * CSV exports, and immutable audit logging.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { sanitizeInput, maskLeadData } = require('../middleware/security');
const { logAudit } = require('../middleware/audit');

// Enforce Agent & Admin RBAC on all CRM routes
router.use(authenticate);
router.use(authorize('admin', 'agent'));

/**
 * GET /api/crm/stats
 * Summary metrics for CRM Overview Dashboard
 */
router.get('/stats', async (req, res) => {
  const user = req.user;
  const isAgent = user.role === 'agent';

  try {
    const filterClause = isAgent ? 'WHERE (assigned_to = $1 OR assigned_agent_id = $1)' : '';
    const filterParams = isAgent ? [user.id] : [];

    const totalRes = await db.get(`SELECT count(*) as count FROM leads ${filterClause}`, filterParams);
    const hotRes = await db.get(`SELECT count(*) as count FROM leads ${filterClause ? filterClause + ' AND' : 'WHERE'} (lead_category = 'HOT' OR score_category = 'HOT')`, filterParams);
    const warmRes = await db.get(`SELECT count(*) as count FROM leads ${filterClause ? filterClause + ' AND' : 'WHERE'} (lead_category = 'WARM' OR score_category = 'WARM')`, filterParams);
    const coldRes = await db.get(`SELECT count(*) as count FROM leads ${filterClause ? filterClause + ' AND' : 'WHERE'} (lead_category = 'COLD' OR score_category = 'COLD')`, filterParams);
    const newRes = await db.get(`SELECT count(*) as count FROM leads ${filterClause ? filterClause + ' AND' : 'WHERE'} status = 'New'`, filterParams);
    const siteVisitRes = await db.get(`SELECT count(*) as count FROM leads ${filterClause ? filterClause + ' AND' : 'WHERE'} (status = 'Site Visit' OR status = 'Site Visit Scheduled' OR enquiry_type = 'Schedule Site Visit')`, filterParams);
    const convertedRes = await db.get(`SELECT count(*) as count FROM leads ${filterClause ? filterClause + ' AND' : 'WHERE'} status = 'Converted'`, filterParams);

    const pendingFollowupsRes = await db.get(
      `SELECT count(*) as count FROM followups f
       JOIN leads l ON f.lead_id = l.id
       ${isAgent ? 'WHERE (l.assigned_to = $1 OR l.assigned_agent_id = $1) AND f.status = \'Pending\'' : 'WHERE f.status = \'Pending\''}`,
      filterParams
    );

    const totalCount = parseInt(totalRes ? totalRes.count : 0, 10);
    const convertedCount = parseInt(convertedRes ? convertedRes.count : 0, 10);
    const conversionRate = totalCount > 0 ? ((convertedCount / totalCount) * 100).toFixed(1) : '0.0';

    return res.json({
      success: true,
      stats: {
        total_leads: totalCount,
        hot_leads: parseInt(hotRes ? hotRes.count : 0, 10),
        warm_leads: parseInt(warmRes ? warmRes.count : 0, 10),
        cold_leads: parseInt(coldRes ? coldRes.count : 0, 10),
        new_leads: parseInt(newRes ? newRes.count : 0, 10),
        site_visits: parseInt(siteVisitRes ? siteVisitRes.count : 0, 10),
        converted_leads: convertedCount,
        pending_followups: parseInt(pendingFollowupsRes ? pendingFollowupsRes.count : 0, 10),
        conversion_rate: `${conversionRate}%`,
      },
    });
  } catch (error) {
    console.error('CRM Stats Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve CRM statistics.' });
  }
});

/**
 * GET /api/crm/agents
 * List active consultants for assignment selection
 */
router.get('/agents', async (req, res) => {
  try {
    const agents = await db.all(
      `SELECT id, name, email, phone, role FROM users WHERE role IN ('agent', 'admin') AND account_status = 'active' ORDER BY name ASC`
    );
    return res.json({ success: true, agents });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to retrieve agents list.' });
  }
});

/**
 * GET /api/crm/leads
 * Filterable, searchable, and paginated lead database query
 */
router.get('/leads', async (req, res) => {
  const { search, category, status, agent_id, sort_by = 'id_desc', limit = 50, offset = 0 } = req.query;
  const user = req.user;

  try {
    const conditions = [];
    const params = [];
    let pIdx = 1;

    // Search query across name, phone, email, location, property_type
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      conditions.push(`(l.name LIKE $${pIdx} OR l.phone LIKE $${pIdx + 1} OR l.email LIKE $${pIdx + 2} OR l.location LIKE $${pIdx + 3} OR p.title LIKE $${pIdx + 4})`);
      params.push(q, q, q, q, q);
      pIdx += 5;
    }

    // Category filter (HOT, WARM, COLD)
    if (category && category !== 'ALL') {
      conditions.push(`(l.lead_category = $${pIdx} OR l.score_category = $${pIdx})`);
      params.push(category);
      pIdx += 1;
    }

    // Status filter
    if (status && status !== 'ALL') {
      conditions.push(`l.status = $${pIdx}`);
      params.push(status);
      pIdx += 1;
    }

    // Agent assignment filter
    if (agent_id && agent_id !== 'ALL') {
      conditions.push(`(l.assigned_to = $${pIdx} OR l.assigned_agent_id = $${pIdx})`);
      params.push(parseInt(agent_id, 10));
      pIdx += 1;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Sorting
    let orderClause = 'ORDER BY l.id DESC';
    if (sort_by === 'score_desc') orderClause = 'ORDER BY l.lead_score DESC, l.id DESC';
    if (sort_by === 'score_asc') orderClause = 'ORDER BY l.lead_score ASC, l.id DESC';
    if (sort_by === 'date_asc') orderClause = 'ORDER BY l.id ASC';

    // Query Leads with Property & Agent Joins
    const leadsQuery = `
      SELECT l.*,
             p.title as property_title, p.price as property_price, p.location as property_location, p.image_url as property_image,
             u.name as assigned_agent_name, u.phone as assigned_agent_phone, u.email as assigned_agent_email
      FROM leads l
      LEFT JOIN properties p ON l.property_id = p.id
      LEFT JOIN users u ON l.assigned_to = u.id OR l.assigned_agent_id = u.id
      ${whereClause}
      ${orderClause}
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const leads = await db.all(leadsQuery, params);

    // Get Total Count for Pagination
    const countQuery = `
      SELECT count(*) as count
      FROM leads l
      LEFT JOIN properties p ON l.property_id = p.id
      ${whereClause}
    `;
    const countRes = await db.get(countQuery, params.slice(0, -2));
    const totalCount = countRes ? parseInt(countRes.count, 10) : 0;

    // Apply PII Masking if viewer is an unauthorized agent viewing unassigned lead
    const processedLeads = leads.map(lead => maskLeadData(lead, user));

    return res.json({
      success: true,
      count: processedLeads.length,
      total: totalCount,
      leads: processedLeads,
    });
  } catch (error) {
    console.error('CRM Fetch Leads Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to query leads.' });
  }
});

/**
 * GET /api/crm/leads/:id
 * Retrieve single lead details with explainable score & follow-up logs
 */
router.get('/leads/:id', async (req, res) => {
  const leadId = req.params.id;
  const user = req.user;

  try {
    const lead = await db.get(
      `SELECT l.*,
              p.title as property_title, p.price as property_price, p.location as property_location,
              p.property_type as property_type_val, p.image_url as property_image,
              u.name as assigned_agent_name, u.phone as assigned_agent_phone, u.email as assigned_agent_email
       FROM leads l
       LEFT JOIN properties p ON l.property_id = p.id
       LEFT JOIN users u ON l.assigned_to = u.id OR l.assigned_agent_id = u.id
       WHERE l.id = $1`,
      [leadId]
    );

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead record not found.' });
    }

    // Fetch followups for this lead
    const followups = await db.all(
      `SELECT f.*, u.name as agent_name
       FROM followups f
       LEFT JOIN users u ON f.agent_id = u.id OR f.staff_id = u.id
       WHERE f.lead_id = $1
       ORDER BY f.id DESC`,
      [leadId]
    );

    const safeLead = maskLeadData(lead, user);

    return res.json({
      success: true,
      lead: safeLead,
      followups,
    });
  } catch (error) {
    console.error('Fetch Single Lead Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve lead details.' });
  }
});

/**
 * PATCH /api/crm/leads/:id/status
 * Update lead pipeline stage
 */
router.patch('/leads/:id/status', async (req, res) => {
  const leadId = req.params.id;
  let { status, notes } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  const validStatuses = ['New', 'Contacted', 'Site Visit', 'Site Visit Scheduled', 'Negotiation', 'Converted', 'Lost', 'Closed'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Invalid status. Valid values are: ${validStatuses.join(', ')}`,
    });
  }

  status = sanitizeInput(status);
  notes = sanitizeInput(notes || '');

  try {
    const existing = await db.get('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    const previousStatus = existing.status;
    const updatedNotes = notes
      ? `${existing.notes || ''}\n[${new Date().toISOString().split('T')[0]}] Status changed from ${previousStatus} to ${status}: ${notes}`.trim()
      : existing.notes;

    await db.query(
      'UPDATE leads SET status = $1, notes = $2 WHERE id = $3',
      [status, updatedNotes, leadId]
    );

    // Log Audit Trail
    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'LEAD_STATUS_UPDATED',
      entity: 'LEAD',
      entityId: leadId,
      result: 'SUCCESS',
      ip,
      details: `Lead #${leadId} (${existing.name}) status changed from '${previousStatus}' to '${status}'`,
    });

    return res.json({
      success: true,
      message: `Lead #${leadId} status updated to '${status}' successfully.`,
      lead_id: leadId,
      previous_status: previousStatus,
      new_status: status,
    });
  } catch (error) {
    console.error('Update Status Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update lead status.' });
  }
});

/**
 * PATCH /api/crm/leads/:id/assign
 * Reassign lead to a specific consultant / agent
 */
router.patch('/leads/:id/assign', async (req, res) => {
  const leadId = req.params.id;
  const { agent_id } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  if (!agent_id) {
    return res.status(400).json({ success: false, error: 'Please specify the target agent ID.' });
  }

  try {
    const targetAgent = await db.get('SELECT id, name, email, role FROM users WHERE id = $1', [agent_id]);
    if (!targetAgent || (targetAgent.role !== 'agent' && targetAgent.role !== 'admin')) {
      return res.status(400).json({ success: false, error: 'Target user is not an active agent or administrator.' });
    }

    const lead = await db.get('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    await db.query(
      'UPDATE leads SET assigned_to = $1, assigned_agent_id = $2 WHERE id = $3',
      [targetAgent.id, targetAgent.id, leadId]
    );

    // Audit Log
    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'LEAD_REASSIGNED',
      entity: 'LEAD',
      entityId: leadId,
      result: 'SUCCESS',
      ip,
      details: `Lead #${leadId} reassigned to ${targetAgent.name} (${targetAgent.role})`,
    });

    return res.json({
      success: true,
      message: `Lead #${leadId} successfully reassigned to ${targetAgent.name}.`,
      assigned_agent: {
        id: targetAgent.id,
        name: targetAgent.name,
        email: targetAgent.email,
      },
    });
  } catch (error) {
    console.error('Assign Lead Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to reassign lead.' });
  }
});

/**
 * POST /api/crm/leads/:id/followups
 * Log a new follow-up interaction and set next reminder date
 */
router.post('/leads/:id/followups', async (req, res) => {
  const leadId = req.params.id;
  let { followup_date, followup_time = '10:00 AM', notes, status = 'Pending', next_action } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  if (!followup_date || !notes) {
    return res.status(400).json({
      success: false,
      error: 'Please provide Follow-up Date and Interaction Notes.',
    });
  }

  followup_date = sanitizeInput(followup_date);
  followup_time = sanitizeInput(followup_time);
  notes = sanitizeInput(notes);
  status = sanitizeInput(status);
  next_action = sanitizeInput(next_action || 'Client Follow-up');

  try {
    const lead = await db.get('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    const insertRes = await db.query(
      `INSERT INTO followups (
        lead_id, agent_id, staff_id, followup_date, followup_time, notes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [leadId, req.user.id, req.user.id, followup_date, followup_time, notes, status]
    );

    const followupId = (insertRes.rows && insertRes.rows[0] && insertRes.rows[0].id) || insertRes.lastID;

    // Update follow-up date on lead record
    await db.query(
      'UPDATE leads SET follow_up_date = $1 WHERE id = $2',
      [followup_date, leadId]
    );

    // Audit Log
    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'FOLLOWUP_LOGGED',
      entity: 'FOLLOWUP',
      entityId: followupId,
      result: 'SUCCESS',
      ip,
      details: `Follow-up logged for Lead #${leadId} scheduled on ${followup_date}: ${notes}`,
    });

    return res.status(201).json({
      success: true,
      message: 'Follow-up interaction logged successfully.',
      followup_id: followupId,
      lead_id: leadId,
      followup_date,
    });
  } catch (error) {
    console.error('Create Followup Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to record follow-up.' });
  }
});

/**
 * GET /api/crm/leads/:id/followups
 * Retrieve all interaction history for a lead
 */
router.get('/leads/:id/followups', async (req, res) => {
  const leadId = req.params.id;
  try {
    const followups = await db.all(
      `SELECT f.*, u.name as agent_name, u.email as agent_email
       FROM followups f
       LEFT JOIN users u ON f.agent_id = u.id OR f.staff_id = u.id
       WHERE f.lead_id = $1
       ORDER BY f.id DESC`,
      [leadId]
    );

    return res.json({ success: true, count: followups.length, followups });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to retrieve follow-up history.' });
  }
});

/**
 * GET /api/crm/export
 * Export filtered leads to CSV format with audit tracking
 */
router.get('/export', async (req, res) => {
  const { category, status } = req.query;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  try {
    const conditions = [];
    const params = [];
    let pIdx = 1;

    if (category && category !== 'ALL') {
      conditions.push(`(l.lead_category = $${pIdx} OR l.score_category = $${pIdx})`);
      params.push(category);
      pIdx += 1;
    }

    if (status && status !== 'ALL') {
      conditions.push(`l.status = $${pIdx}`);
      params.push(status);
      pIdx += 1;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const leads = await db.all(
      `SELECT l.id, l.name, l.phone, l.email, l.location, l.budget, l.property_type,
              l.enquiry_type, l.timeline, l.lead_score, l.lead_category, l.status,
              l.follow_up_date, l.created_at,
              p.title as property_title,
              u.name as assigned_agent
       FROM leads l
       LEFT JOIN properties p ON l.property_id = p.id
       LEFT JOIN users u ON l.assigned_to = u.id OR l.assigned_agent_id = u.id
       ${whereClause}
       ORDER BY l.id DESC`,
      params
    );

    // Build CSV Content
    const headers = [
      'Lead ID',
      'Customer Name',
      'Phone Number',
      'Email Address',
      'Target City',
      'Budget',
      'Property Type',
      'Enquiry Type',
      'Timeline',
      'Lead Score',
      'Score Category',
      'Pipeline Status',
      'Property Interest',
      'Assigned Agent',
      'Follow-up Date',
      'Captured Date',
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvRows = [headers.join(',')];
    for (const lead of leads) {
      const row = [
        lead.id,
        escapeCsv(lead.name),
        escapeCsv(lead.phone),
        escapeCsv(lead.email),
        escapeCsv(lead.location),
        escapeCsv(lead.budget),
        escapeCsv(lead.property_type),
        escapeCsv(lead.enquiry_type),
        escapeCsv(lead.timeline),
        lead.lead_score || 0,
        escapeCsv(lead.lead_category),
        escapeCsv(lead.status),
        escapeCsv(lead.property_title || 'General Enquiry'),
        escapeCsv(lead.assigned_agent || 'Unassigned'),
        escapeCsv(lead.follow_up_date || ''),
        escapeCsv(lead.created_at || ''),
      ];
      csvRows.push(row.join(','));
    }

    const csvData = csvRows.join('\r\n');

    // Audit Log
    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'LEADS_EXPORTED',
      entity: 'LEAD_EXPORT',
      entityId: `COUNT_${leads.length}`,
      result: 'SUCCESS',
      ip,
      details: `Exported ${leads.length} lead records to CSV`,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="estatelead-leads-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.status(200).send(csvData);
  } catch (error) {
    console.error('Export Leads Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to export leads data.' });
  }
});

module.exports = router;
