// Auto-intercept fetch for /api endpoints across localhost:5000, 127.0.0.1, LiveServer, and file://
(function() {
  if (typeof window !== 'undefined' && window.fetch) {
    const origFetch = window.fetch;
    window.fetch = function(resource, init) {
      let url = resource;
      if (typeof resource === 'string' && (resource.startsWith('/api/') || resource.startsWith('api/'))) {
        const clean = resource.startsWith('/') ? resource : '/' + resource;
        if (window.location.protocol === 'file:' || (window.location.port !== '5000' && !window.location.host.includes('5000'))) {
          url = `http://localhost:5000${clean}`;
        } else {
          url = clean;
        }
      }
      return origFetch.call(this, url, init);
    };
  }
})();

// Global State
const EstateLead = {
  token: typeof localStorage !== 'undefined' ? localStorage.getItem('estatelead_token') : null,
  user: null,

  init() {
    try {
      const stored = localStorage.getItem('estatelead_user');
      if (stored) {
        this.user = JSON.parse(stored);
      }
    } catch (e) {
      this.user = null;
    }
    this.updateNav();
    this.updateSavedBadgeCount();
  },

  setAuth(token, user) {
    this.token = token;
    this.user = user;
    try {
      localStorage.setItem('estatelead_token', token);
      localStorage.setItem('estatelead_user', JSON.stringify(user));
    } catch (e) {}
    this.updateNav();
    this.updateSavedBadgeCount();
  },

  apiUrl(endpoint) {
    const clean = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (window.location.port !== '5000' && !window.location.host.includes('5000')))) {
      return `http://localhost:5000${clean}`;
    }
    return clean;
  },

  pageUrl(path) {
    const clean = path.startsWith('/') ? path.substring(1) : path;
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      return clean;
    }
    return '/' + clean;
  },

  async directLogin(email, password, redirectPath = null) {
    try {
      this.showToast(`Authenticating ${email}...`, 'info');
      const res = await fetch(this.apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        this.setAuth(data.token, data.user);
        this.showToast(`Welcome back, ${data.user.name.split(' ')[0]}! (${data.user.role.toUpperCase()})`, 'success');
        let target = redirectPath;
        if (!target) {
          target = (data.user.role === 'admin' || data.user.role === 'agent') ? 'crm.html' : 'dashboard.html';
        }
        setTimeout(() => {
          window.location.href = target;
        }, 500);
        return { success: true, user: data.user };
      } else {
        this.showToast(data.error || 'Authentication failed', 'error');
        return { success: false, error: data.error };
      }
    } catch (err) {
      this.showToast('Could not reach server at http://localhost:5000', 'error');
      return { success: false, error: err.message };
    }
  },

  logout() {
    if (this.token) {
      fetch(this.apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
      }).catch(() => {});
    }
    this.token = null;
    this.user = null;
    localStorage.removeItem('estatelead_token');
    localStorage.removeItem('estatelead_user');
    this.showToast('Signed out successfully.');
    this.updateNav();
    setTimeout(() => {
      window.location.href = '/';
    }, 600);
  },

  updateNav() {
    const authContainer = document.getElementById('nav-auth-actions');
    const navLinks = document.querySelector('.nav-links');

    if (this.user) {
      const isStaff = this.user.role === 'admin' || this.user.role === 'agent';

      if (navLinks) {
        if (isStaff) {
          navLinks.innerHTML = `
            <li><a href="/" class="nav-link">Home</a></li>
            <li><a href="/properties.html" class="nav-link">Portfolio</a></li>
            <li><a href="/crm.html" class="nav-link">Lead CRM</a></li>
            <li><a href="/analytics.html" class="nav-link">Analytics BI</a></li>
          `;
        } else {
          navLinks.innerHTML = `
            <li><a href="/" class="nav-link">Home</a></li>
            <li><a href="/properties.html" class="nav-link">Portfolio</a></li>
            <li><a href="/dashboard.html" class="nav-link">My Suite</a></li>
            <li><a href="/saved.html" class="nav-link">Saved Wishlist</a></li>
          `;
        }
      }

      if (authContainer) {
        authContainer.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            ${!isStaff ? `
              <a href="/saved.html" class="btn btn-outline btn-sm" title="Saved Collection">
                ❤️ <span id="nav-saved-count" class="brand-badge" style="margin-left: 2px;">0</span>
              </a>
            ` : ''}
            <div style="font-size: 0.88rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 8px;">
              <span>👤 ${this.escapeHTML(this.user.name.split(' ')[0])}</span>
              <span class="brand-badge" style="background: ${isStaff ? 'var(--dark-gradient)' : 'var(--accent-light)'}; color: ${isStaff ? 'var(--accent-gold)' : 'var(--accent-bronze)'};">
                ${this.user.role.toUpperCase()}
              </span>
            </div>
            <button onclick="EstateLead.logout()" class="btn btn-outline btn-sm" style="padding: 6px 14px;">Sign Out</button>
          </div>
        `;
      }
    } else {
      if (authContainer) {
        authContainer.innerHTML = `
          <a href="/login.html" class="btn btn-outline btn-sm">Sign In</a>
          <a href="/register.html" class="btn btn-accent btn-sm btn-shimmer">Register</a>
        `;
      }
    }
  },

  async updateSavedBadgeCount() {
    const badge = document.getElementById('nav-saved-count');
    if (!badge || !this.token) return;

    try {
      const res = await fetch(this.apiUrl('/api/properties/saved'), {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = await res.json();
      if (data.success) {
        badge.innerText = data.count;
      }
    } catch (e) {}
  },

  formatINR(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return '₹0';
    if (num >= 10000000) {
      return `₹${(num / 10000000).toFixed(2)} Cr`;
    }
    if (num >= 100000) {
      return `₹${(num / 100000).toFixed(2)} Lakhs`;
    }
    return `₹${num.toLocaleString('en-IN')}`;
  },

  escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  showToast(msg, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '⚜️' : type === 'error' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span style="font-size: 1.1rem; color: var(--accent-gold);">${icon}</span><span>${this.escapeHTML(msg)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3600);
  },

  async toggleWishlist(propertyId, btnEl) {
    if (!this.token) {
      this.showToast('Please sign in to save properties to your curated wishlist.', 'error');
      setTimeout(() => {
        window.location.href = `/login.html?redirect=/property/${propertyId}`;
      }, 1000);
      return;
    }

    try {
      const res = await fetch(this.apiUrl(`/api/properties/${propertyId}/save`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      if (data.success) {
        if (data.is_saved) {
          btnEl.classList.add('active');
          btnEl.innerHTML = '❤️';
          this.showToast('Residence added to your private portfolio wishlist!', 'success');
        } else {
          btnEl.classList.remove('active');
          btnEl.innerHTML = '🤍';
          this.showToast('Residence removed from your wishlist.', 'info');
        }
        this.updateSavedBadgeCount();
      } else {
        this.showToast(data.error || 'Failed to update saved property.', 'error');
      }
    } catch (err) {
      this.showToast('Network error while updating wishlist.', 'error');
    }
  },

  calculateEMI(price, downPaymentPct = 20, tenureYears = 20, annualRatePct = 8.5) {
    const p = price * (1 - downPaymentPct / 100);
    const monthlyRate = annualRatePct / (12 * 100);
    const months = tenureYears * 12;

    if (p <= 0 || monthlyRate <= 0 || months <= 0) return { emi: 0, loanAmount: 0, totalInterest: 0, totalPayable: 0 };

    const emi = (p * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
    const totalPayable = emi * months;
    const totalInterest = totalPayable - p;

    return {
      emi: Math.round(emi),
      loanAmount: Math.round(p),
      totalInterest: Math.round(totalInterest),
      totalPayable: Math.round(totalPayable),
    };
  },

  renderPropertyCard(p) {
    const isRental = p.purpose === 'Rent';
    const priceDisplay = isRental ? `${this.formatINR(p.price)} <span style="font-size: 0.95rem; font-weight: 500; color: var(--text-muted);">/ month</span>` : this.formatINR(p.price);
    const heartIcon = p.is_saved ? '❤️' : '🤍';
    const activeClass = p.is_saved ? 'active' : '';

    return `
      <div class="property-card" data-id="${p.id}">
        <div class="property-thumb">
          <img src="${this.escapeHTML(p.image_url)}" alt="${this.escapeHTML(p.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80'">
          <div class="property-badges">
            ${p.featured ? '<span class="badge badge-featured">⚜️ Featured</span>' : ''}
            <span class="badge badge-purpose">${this.escapeHTML(p.purpose || 'Buy')}</span>
            <span class="badge badge-status">✓ ${this.escapeHTML(p.availability || 'Available')}</span>
          </div>
          <button class="btn-wishlist ${activeClass}" onclick="EstateLead.toggleWishlist(${p.id}, this)" title="Save to wishlist">
            ${heartIcon}
          </button>
        </div>
        <div class="property-body">
          <div class="property-price">
            <span class="price-val">${priceDisplay}</span>
          </div>
          <h3 class="property-title">
            <a href="/property-details.html?id=${p.id}">${this.escapeHTML(p.title)}</a>
          </h3>
          <div class="property-location">
            📍 <span>${this.escapeHTML(p.location)}</span>
          </div>
          <div class="property-specs">
            <div class="spec-item">🛏️ ${p.bhk || p.bedrooms || 2} BHK</div>
            <div class="spec-item">🚿 ${p.bathrooms || 2} Baths</div>
            <div class="spec-item">📐 ${p.area || 1200} sq.ft</div>
          </div>
          <div class="property-footer">
            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">👁️ ${p.views_count || 0} views</span>
            <a href="/property-details.html?id=${p.id}" class="btn btn-outline btn-sm">Explore Residence &rarr;</a>
          </div>
        </div>
      </div>
    `;
  },

  async submitEnquiry(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(this.apiUrl('/api/leads/enquire'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return await res.json();
  },

  async scheduleSiteVisit(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(this.apiUrl('/api/leads/site-visit'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return await res.json();
  },

  async requestBrochure(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(this.apiUrl('/api/leads/brochure'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return await res.json();
  },

  async requestCallback(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(this.apiUrl('/api/leads/callback'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return await res.json();
  },
};

document.addEventListener('DOMContentLoaded', () => {
  EstateLead.init();
});
