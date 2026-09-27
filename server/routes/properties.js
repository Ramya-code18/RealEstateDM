/**
 * EstateLead - Properties & Catalog REST API (Stage 2)
 * Handles property search with multi-criteria filters, high-res details view,
 * on-site behavioral tracking (views count & user activity), and customer wishlist bookmarking.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { sanitizeInput } = require('../middleware/security');

/**
 * GET /api/properties
 * Multi-criteria property search and filtering catalog
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      search,
      location,
      property_type,
      type,
      bhk,
      bedrooms,
      purpose,
      availability,
      min_price,
      max_price,
      featured,
      sort = 'newest',
    } = req.query;

    let queryText = `
      SELECT id, title, name, property_type, type, location, bhk, price,
             bedrooms, bathrooms, parking, area, purpose, availability, status,
             featured, description, amenities, image_url, images,
             contact_phone, contact_email, views_count, saves_count, created_at
      FROM properties
      WHERE 1=1
    `;
    const params = [];

    // 1. Keyword Search
    if (search && search.trim()) {
      const term = `%${sanitizeInput(search.trim())}%`;
      params.push(term);
      const pIndex = params.length;
      queryText += ` AND (title LIKE $${pIndex} OR location LIKE $${pIndex} OR description LIKE $${pIndex} OR amenities LIKE $${pIndex})`;
    }

    // 2. Location Filter
    if (location && location.trim() && location.toLowerCase() !== 'all') {
      params.push(`%${sanitizeInput(location.trim())}%`);
      queryText += ` AND location LIKE $${params.length}`;
    }

    // 3. Property Type Filter
    const targetType = property_type || type;
    if (targetType && targetType.trim() && targetType.toLowerCase() !== 'all') {
      params.push(sanitizeInput(targetType.trim()));
      queryText += ` AND (property_type = $${params.length} OR type = $${params.length})`;
    }

    // 4. BHK / Bedrooms Filter
    const targetBhk = bhk || bedrooms;
    if (targetBhk && targetBhk !== 'all' && !isNaN(parseInt(targetBhk, 10))) {
      const bhkVal = parseInt(targetBhk, 10);
      if (bhkVal >= 4) {
        queryText += ` AND bhk >= 4`;
      } else {
        params.push(bhkVal);
        queryText += ` AND bhk = $${params.length}`;
      }
    }

    // 5. Purpose: Buy vs Rent
    if (purpose && purpose.trim() && purpose.toLowerCase() !== 'all') {
      params.push(sanitizeInput(purpose.trim()));
      queryText += ` AND purpose = $${params.length}`;
    }

    // 6. Availability Filter
    if (availability && availability.trim() && availability.toLowerCase() !== 'all') {
      params.push(sanitizeInput(availability.trim()));
      queryText += ` AND availability = $${params.length}`;
    }

    // 7. Price Range Filter
    if (min_price && !isNaN(parseFloat(min_price))) {
      params.push(parseFloat(min_price));
      queryText += ` AND price >= $${params.length}`;
    }
    if (max_price && !isNaN(parseFloat(max_price))) {
      params.push(parseFloat(max_price));
      queryText += ` AND price <= $${params.length}`;
    }

    // 8. Featured Filter
    if (featured === 'true' || featured === '1') {
      queryText += ` AND (featured = TRUE OR featured = 1)`;
    }

    // 9. Sorting
    if (sort === 'price_asc') {
      queryText += ` ORDER BY price ASC`;
    } else if (sort === 'price_desc') {
      queryText += ` ORDER BY price DESC`;
    } else if (sort === 'popular') {
      queryText += ` ORDER BY views_count DESC, saves_count DESC`;
    } else {
      queryText += ` ORDER BY id DESC`;
    }

    const properties = await db.all(queryText, params);

    // If user is authenticated, check which properties are saved in their wishlist
    let savedPropertyIds = new Set();
    if (req.user) {
      const savedRows = await db.all('SELECT property_id FROM saved_properties WHERE user_id = $1', [req.user.id]);
      savedPropertyIds = new Set(savedRows.map((r) => r.property_id));
    }

    const formatted = properties.map((p) => {
      let imagesList = [];
      try {
        imagesList = p.images ? JSON.parse(p.images) : [];
      } catch (e) {
        imagesList = p.images ? p.images.split(',') : [];
      }
      if (imagesList.length === 0 && p.image_url) {
        imagesList = [p.image_url];
      }

      return {
        ...p,
        title: p.title || p.name,
        property_type: p.property_type || p.type || 'Apartments',
        images: imagesList,
        image_url: p.image_url || (imagesList.length > 0 ? imagesList[0] : ''),
        is_saved: req.user ? savedPropertyIds.has(p.id) : false,
      };
    });

    return res.json({
      success: true,
      count: formatted.length,
      properties: formatted,
    });
  } catch (error) {
    console.error('Fetch Properties Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve property listings.' });
  }
});

/**
 * GET /api/properties/featured
 * Spotlight luxury properties for homepage display
 */
router.get('/featured', optionalAuth, async (req, res) => {
  try {
    const properties = await db.all(
      `SELECT * FROM properties
       WHERE featured = TRUE OR featured = 1
       ORDER BY views_count DESC, id DESC
       LIMIT 6`
    );

    let savedPropertyIds = new Set();
    if (req.user) {
      const savedRows = await db.all('SELECT property_id FROM saved_properties WHERE user_id = $1', [req.user.id]);
      savedPropertyIds = new Set(savedRows.map((r) => r.property_id));
    }

    const formatted = properties.map((p) => ({
      ...p,
      title: p.title || p.name,
      property_type: p.property_type || p.type || 'Apartments',
      is_saved: req.user ? savedPropertyIds.has(p.id) : false,
    }));

    return res.json({ success: true, count: formatted.length, properties: formatted });
  } catch (error) {
    console.error('Featured Properties Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve featured properties.' });
  }
});

/**
 * GET /api/properties/saved
 * Retrieve all saved wishlist properties for the authenticated customer
 */
router.get('/saved', authenticate, async (req, res) => {
  try {
    const properties = await db.all(
      `SELECT p.*, sp.created_at as saved_at
       FROM properties p
       JOIN saved_properties sp ON p.id = sp.property_id
       WHERE sp.user_id = $1
       ORDER BY sp.created_at DESC`,
      [req.user.id]
    );

    const formatted = properties.map((p) => ({
      ...p,
      title: p.title || p.name,
      property_type: p.property_type || p.type || 'Apartments',
      is_saved: true,
    }));

    return res.json({
      success: true,
      count: formatted.length,
      properties: formatted,
    });
  } catch (error) {
    console.error('Fetch Saved Properties Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve saved wishlist properties.' });
  }
});

/**
 * GET /api/properties/:id
 * Retrieve single property specifications, track view count & user activity
 */
router.get('/:id', optionalAuth, async (req, res) => {
  const propertyId = req.params.id;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  try {
    const property = await db.get('SELECT * FROM properties WHERE id = $1', [propertyId]);
    if (!property) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    // 1. Increment on-site view counter
    await db.query('UPDATE properties SET views_count = views_count + 1 WHERE id = $1', [propertyId]);

    // 2. Record behavioral user activity for personalization and lead scoring
    const userId = req.user ? req.user.id : null;
    await db.query(
      `INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address)
       VALUES ($1, $2, 'view_property', $3, $4)`,
      [userId, propertyId, `Viewed property details: ${property.title || property.name}`, ip]
    );

    // 3. Check wishlist bookmark state
    let isSaved = false;
    if (req.user) {
      const bookmark = await db.get(
        'SELECT id FROM saved_properties WHERE user_id = $1 AND property_id = $2',
        [req.user.id, propertyId]
      );
      isSaved = !!bookmark;
    }

    let imagesList = [];
    try {
      imagesList = property.images ? JSON.parse(property.images) : [];
    } catch (e) {
      imagesList = property.images ? property.images.split(',') : [];
    }
    if (imagesList.length === 0 && property.image_url) {
      imagesList = [property.image_url];
    }

    return res.json({
      success: true,
      property: {
        ...property,
        title: property.title || property.name,
        property_type: property.property_type || property.type || 'Apartments',
        images: imagesList,
        image_url: property.image_url || (imagesList.length > 0 ? imagesList[0] : ''),
        is_saved: isSaved,
      },
    });
  } catch (error) {
    console.error('Get Property Details Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve property details.' });
  }
});

/**
 * POST /api/properties/:id/save
 * Toggle wishlist save / bookmark state for customer
 */
router.post('/:id/save', authenticate, async (req, res) => {
  const propertyId = req.params.id;
  const userId = req.user.id;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  try {
    const property = await db.get('SELECT id, title, name FROM properties WHERE id = $1', [propertyId]);
    if (!property) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    const existing = await db.get(
      'SELECT id FROM saved_properties WHERE user_id = $1 AND property_id = $2',
      [userId, propertyId]
    );

    if (existing) {
      // Unsave / Remove from wishlist
      await db.query('DELETE FROM saved_properties WHERE id = $1', [existing.id]);
      await db.query('UPDATE properties SET saves_count = MAX(0, saves_count - 1) WHERE id = $1', [propertyId]);

      await db.query(
        `INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address)
         VALUES ($1, $2, 'unsave_property', $3, $4)`,
        [userId, propertyId, `Removed from wishlist: ${property.title || property.name}`, ip]
      );

      return res.json({
        success: true,
        is_saved: false,
        message: 'Property removed from your saved wishlist.',
      });
    } else {
      // Save / Bookmark to wishlist
      await db.query(
        'INSERT INTO saved_properties (user_id, property_id) VALUES ($1, $2)',
        [userId, propertyId]
      );
      await db.query('UPDATE properties SET saves_count = saves_count + 1 WHERE id = $1', [propertyId]);

      // Record activity for personalization & lead scoring engine
      await db.query(
        `INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address)
         VALUES ($1, $2, 'save_property', $3, $4)`,
        [userId, propertyId, `Saved to wishlist: ${property.title || property.name}`, ip]
      );

      return res.json({
        success: true,
        is_saved: true,
        message: 'Property saved to your wishlist!',
      });
    }
  } catch (error) {
    console.error('Toggle Saved Property Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update saved property state.' });
  }
});

/**
 * POST /api/properties
 * Create new property (Admin / Agent only)
 */
router.post('/', authenticate, requireRole(['admin', 'agent']), async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let {
    title,
    property_type = 'Apartment',
    location,
    bhk = 2,
    price,
    bedrooms = 2,
    bathrooms = 2,
    parking = 1,
    area,
    purpose = 'Buy',
    availability = 'Available',
    featured = false,
    description = '',
    amenities = '',
    image_url = '',
    images = '',
    contact_phone = '',
    contact_email = '',
  } = req.body;

  if (!title || !location || !price || !area) {
    return res.status(400).json({ success: false, error: 'Please provide title, location, price, and area.' });
  }

  title = sanitizeInput(title);
  location = sanitizeInput(location);
  property_type = sanitizeInput(property_type);
  description = sanitizeInput(description);
  amenities = sanitizeInput(amenities);

  try {
    const result = await db.query(
      `INSERT INTO properties (
        title, name, property_type, type, location, bhk, price,
        bedrooms, bathrooms, parking, area, purpose, availability, status,
        featured, description, amenities, image_url, images,
        contact_phone, contact_email, views_count, saves_count
      ) VALUES ($1, $1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Active', $12, $13, $14, $15, $16, $17, $18, 0, 0) RETURNING id`,
      [
        title,
        property_type,
        location,
        parseInt(bhk, 10) || 2,
        parseFloat(price),
        parseInt(bedrooms, 10) || 2,
        parseInt(bathrooms, 10) || 2,
        parseInt(parking, 10) || 1,
        parseFloat(area),
        purpose,
        availability,
        featured ? 1 : 0,
        description,
        amenities,
        image_url,
        typeof images === 'object' ? JSON.stringify(images) : images,
        contact_phone,
        contact_email,
      ]
    );

    const newPropId = (result.rows && result.rows[0] && result.rows[0].id) || result.lastID;

    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'PROPERTY_CREATE',
      entity: 'PROPERTY',
      entityId: newPropId,
      result: 'SUCCESS',
      ip,
      details: `Created property listing '${title}' in ${location} for ₹${price}.`,
    });

    return res.status(201).json({
      success: true,
      message: 'Property created successfully.',
      propertyId: newPropId,
    });
  } catch (error) {
    console.error('Create Property Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create property listing.' });
  }
});

module.exports = router;
