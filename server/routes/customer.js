/**
 * EstateLead - Customer Personalization & Dashboard REST API (Stage 3)
 * Provides personalized property recommendation matching, recently viewed history,
 * customer enquiry status tracking, and strict role-based data isolation.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { sanitizeInput } = require('../middleware/security');

/**
 * Helper to parse budget range string to min and max numbers
 */
function parseBudgetRange(budgetStr) {
  if (!budgetStr) return { min: 0, max: 1000000000 };
  const str = budgetStr.toLowerCase();

  if (str.includes('under 50') || str.includes('under ₹50')) {
    return { min: 0, max: 5000000 };
  }
  if (str.includes('50') && str.includes('80')) {
    return { min: 5000000, max: 8000000 };
  }
  if (str.includes('80') && (str.includes('1.5') || str.includes('150'))) {
    return { min: 8000000, max: 15000000 };
  }
  if (str.includes('above 1.5') || str.includes('above ₹1.5') || str.includes('above 2')) {
    return { min: 15000000, max: 1000000000 };
  }
  return { min: 0, max: 1000000000 };
}

/**
 * GET /api/customer/dashboard
 * Aggregates personalized recommendations, recently viewed history,
 * saved properties, and live enquiry tracking for the authenticated customer.
 */
router.get('/dashboard', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Fetch fresh customer profile & preferences
    const user = await db.get(
      `SELECT id, name, email, phone, role, preferred_property_type, preferred_location, budget_range, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ success: false, error: 'Customer account not found.' });
    }

    const prefLocation = user.preferred_location || 'Chennai';
    const prefType = user.preferred_property_type || 'Apartments';
    const prefBudget = user.budget_range || '₹50L - ₹80L';
    const { min: budgetMin, max: budgetMax } = parseBudgetRange(prefBudget);

    // 2. Compute Personalized Recommended Properties
    // Priority: Location match + Type match + Budget match
    const allProps = await db.all(
      `SELECT id, title, property_type, location, bhk, price, bedrooms, bathrooms, area,
              purpose, availability, status, featured, description, amenities, image_url, images, views_count, saves_count
       FROM properties
       WHERE status = 'Active'`
    );

    // Fetch user's saved property IDs
    const savedRows = await db.all('SELECT property_id FROM saved_properties WHERE user_id = $1', [userId]);
    const savedSet = new Set(savedRows.map((r) => r.property_id));

    const scoredRecommendations = allProps
      .map((p) => {
        let matchScore = 0;
        const reasons = [];

        // Check Location Match (+40 pts)
        if (p.location && p.location.toLowerCase().includes(prefLocation.toLowerCase())) {
          matchScore += 40;
          reasons.push(`In your preferred city (${prefLocation})`);
        }

        // Check Property Type Match (+35 pts)
        if (p.property_type && p.property_type.toLowerCase().includes(prefType.toLowerCase())) {
          matchScore += 35;
          reasons.push(`Matches preferred type (${prefType})`);
        }

        // Check Budget Range Match (+25 pts)
        const price = parseFloat(p.price) || 0;
        if (price >= budgetMin && price <= budgetMax) {
          matchScore += 25;
          reasons.push(`Within your budget range (${prefBudget})`);
        } else if (price >= budgetMin * 0.8 && price <= budgetMax * 1.2) {
          matchScore += 10;
          reasons.push(`Near your target budget`);
        }

        return {
          ...p,
          match_score: matchScore,
          match_percentage: `${matchScore}% Match`,
          match_reasons: reasons,
          is_saved: savedSet.has(p.id),
        };
      })
      .filter((p) => p.match_score >= 35) // Filter out completely unrelated properties
      .sort((a, b) => b.match_score - a.match_score || b.views_count - a.views_count);

    // 3. Fetch Recently Viewed Properties (Distinct via user_activity)
    const recentActivityRows = await db.all(
      `SELECT p.*, ua.timestamp as viewed_at
       FROM user_activity ua
       JOIN properties p ON ua.property_id = p.id
       WHERE ua.user_id = $1 AND ua.activity_type = 'view_property'
       ORDER BY ua.id DESC
       LIMIT 10`,
      [userId]
    );

    // Deduplicate recently viewed properties
    const seenIds = new Set();
    const recentlyViewed = [];
    for (const r of recentActivityRows) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        recentlyViewed.push({
          ...r,
          is_saved: savedSet.has(r.id),
        });
      }
    }

    // 4. Fetch Saved Properties
    const savedProperties = await db.all(
      `SELECT p.*, sp.created_at as saved_at
       FROM saved_properties sp
       JOIN properties p ON sp.property_id = p.id
       WHERE sp.user_id = $1
       ORDER BY sp.id DESC`,
      [userId]
    );

    const formattedSaved = savedProperties.map((p) => ({
      ...p,
      is_saved: true,
    }));

    // 5. Fetch Customer's Submitted Enquiries & Status Progression
    const customerEnquiries = await db.all(
      `SELECT l.id, l.property_id, l.name, l.phone, l.email, l.preferred_location, l.budget,
              l.property_type, l.enquiry_type, l.timeline, l.message, l.lead_score, l.lead_category,
              l.score_reason, l.status, l.follow_up_date, l.notes, l.created_at,
              p.title as property_title, p.location as property_location, p.price as property_price,
              p.image_url as property_image,
              u.name as assigned_agent_name, u.phone as assigned_agent_phone, u.email as assigned_agent_email
       FROM leads l
       LEFT JOIN properties p ON l.property_id = p.id
       LEFT JOIN users u ON l.assigned_to = u.id OR l.assigned_agent_id = u.id
       WHERE l.user_id = $1 OR l.email = $2
       ORDER BY l.id DESC`,
      [userId, user.email]
    );

    // 6. Summary Stats
    const stats = {
      recommended_count: scoredRecommendations.length,
      recently_viewed_count: recentlyViewed.length,
      saved_count: formattedSaved.length,
      enquiries_count: customerEnquiries.length,
    };

    return res.json({
      success: true,
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        preferred_property_type: prefType,
        preferred_location: prefLocation,
        budget_range: prefBudget,
        member_since: user.created_at,
      },
      stats,
      recommendations: scoredRecommendations,
      recently_viewed: recentlyViewed,
      saved_properties: formattedSaved,
      enquiries: customerEnquiries,
    });
  } catch (error) {
    console.error('Customer Dashboard Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load customer dashboard data.' });
  }
});

/**
 * PUT /api/customer/preferences
 * Allows customer to update their criteria and immediately recalculate recommendations
 */
router.put('/preferences', authenticate, async (req, res) => {
  const userId = req.user.id;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let { preferred_location, preferred_property_type, budget_range } = req.body;

  if (!preferred_location || !preferred_property_type || !budget_range) {
    return res.status(400).json({ success: false, error: 'Please provide all preference fields.' });
  }

  preferred_location = sanitizeInput(preferred_location);
  preferred_property_type = sanitizeInput(preferred_property_type);
  budget_range = sanitizeInput(budget_range);

  try {
    await db.query(
      `UPDATE users
       SET preferred_location = $1, preferred_property_type = $2, budget_range = $3
       WHERE id = $4`,
      [preferred_location, preferred_property_type, budget_range, userId]
    );

    await logAudit({
      userId,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PREFERENCES_UPDATED',
      entity: 'USER',
      entityId: userId,
      result: 'SUCCESS',
      ip,
      details: `Updated search preferences to: ${preferred_location}, ${preferred_property_type}, ${budget_range}`,
    });

    return res.json({
      success: true,
      message: 'Personalization criteria updated successfully.',
      preferences: {
        preferred_location,
        preferred_property_type,
        budget_range,
      },
    });
  } catch (error) {
    console.error('Update Preferences Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update preferences.' });
  }
});

module.exports = router;
