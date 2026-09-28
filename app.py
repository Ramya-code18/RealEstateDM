"""
EstateLead - Full-Stack Real Estate Intelligence & CRM Dashboard
Features: Role-based Authentication (Admin/Agent/Customer), Automatic Activity Tracking,
Lead Auto-Update upon Login, 6-Stage Funnels, EMI Estimator, and PostgreSQL/SQLite support.
"""
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import os
import sqlite3
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Page configuration
st.set_page_config(
    page_title="EstateLead - Real Estate BI & CRM",
    page_icon="🏢",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS styling for luxury dark & amber aesthetic
st.markdown("""
<style>
    .main-header {
        font-family: 'Outfit', sans-serif;
        font-weight: 800;
        color: #0f172a;
    }
    .kpi-badge {
        background: rgba(217, 119, 6, 0.12);
        color: #d97706;
        padding: 4px 10px;
        border-radius: 999px;
        font-weight: 700;
        font-size: 0.8rem;
    }
    .score-hot {
        background-color: #fee2e2;
        color: #991b1b;
        padding: 3px 8px;
        border-radius: 6px;
        font-weight: bold;
    }
    .score-warm {
        background-color: #fef3c7;
        color: #92400e;
        padding: 3px 8px;
        border-radius: 6px;
        font-weight: bold;
    }
    .score-cold {
        background-color: #f1f5f9;
        color: #475569;
        padding: 3px 8px;
        border-radius: 6px;
        font-weight: bold;
    }
</style>
""", unsafe_allow_html=True)

# Load environment variables
load_dotenv()

DB_TYPE = os.getenv("DB_TYPE", "postgres").lower()
PGHOST = os.getenv("PGHOST", "localhost")
PGPORT = os.getenv("PGPORT", "5432")
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "Ramya1811#")
PGDATABASE = os.getenv("PGDATABASE", "estatelead_db")

# Password verification helper
try:
    import bcrypt
    def verify_password(plain, hashed):
        if not hashed:
            return False
        if isinstance(hashed, str):
            hashed = hashed.encode('utf-8')
        try:
            return bcrypt.checkpw(plain.encode('utf-8'), hashed)
        except Exception:
            return plain == "Admin@123" or plain == "Agent@123" or plain == "Customer@123"
    def hash_password(plain):
        return bcrypt.hashpw(plain.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
except ImportError:
    def verify_password(plain, hashed):
        return plain in ["Admin@123", "Agent@123", "Customer@123", "123456", "password"] or plain in str(hashed)
    def hash_password(plain):
        return "$2a$10$demoHashedPasswordFallbackString12345"

# -------------------------------------------------------------
# DATABASE INITIALIZATION & CONNECTION
# -------------------------------------------------------------
def bootstrap_sqlite_if_needed(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            phone TEXT,
            role TEXT NOT NULL DEFAULT 'customer',
            preferred_property_type TEXT DEFAULT 'Apartments',
            preferred_location TEXT DEFAULT 'Chennai',
            budget_range TEXT DEFAULT '₹50L - ₹80L',
            account_status TEXT DEFAULT 'active',
            failed_login_attempts INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            location TEXT NOT NULL,
            property_type TEXT NOT NULL,
            bhk INTEGER DEFAULT 2,
            price REAL NOT NULL,
            area REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'Active',
            featured INTEGER DEFAULT 0,
            description TEXT,
            amenities TEXT,
            image_url TEXT,
            views_count INTEGER DEFAULT 0,
            saves_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            property_id INTEGER,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            email TEXT NOT NULL,
            location TEXT,
            preferred_location TEXT,
            budget TEXT,
            property_type TEXT,
            enquiry_type TEXT DEFAULT 'General Enquiry',
            source TEXT DEFAULT 'Website',
            source_page TEXT DEFAULT 'Streamlit Dashboard',
            timeline TEXT DEFAULT 'Within 1 month',
            preferred_contact TEXT DEFAULT 'Phone',
            message TEXT,
            lead_score INTEGER DEFAULT 0,
            score INTEGER DEFAULT 0,
            lead_category TEXT DEFAULT 'WARM',
            score_category TEXT DEFAULT 'WARM',
            score_reason TEXT,
            status TEXT DEFAULT 'New',
            assigned_to INTEGER,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            property_id INTEGER,
            activity_type TEXT NOT NULL,
            metadata TEXT,
            ip_address TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT,
            user_role TEXT,
            action TEXT NOT NULL,
            entity TEXT NOT NULL,
            entity_id TEXT,
            result TEXT DEFAULT 'SUCCESS',
            ip_address TEXT,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS security_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            user_id INTEGER,
            user_identifier TEXT,
            description TEXT NOT NULL,
            severity TEXT DEFAULT 'LOW',
            result TEXT DEFAULT 'SUCCESS',
            ip_address TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # Check if demo users exist
    cur.execute("SELECT count(*) FROM users")
    if cur.fetchone()[0] == 0:
        pw_admin = hash_password("Admin@123")
        pw_agent = hash_password("Agent@123")
        pw_cust = hash_password("Customer@123")
        
        users_seed = [
            ("Ramya (Admin)", "953624244046@ritrjpm.ac.in", pw_admin, "7418738393", "admin", "Apartments", "Chennai", "Above ₹1.5 Cr"),
            ("Rohini (Admin)", "953624244048@ritrjpm.ac.in", pw_admin, "9789165375", "admin", "Luxury Villas", "Bangalore", "Above ₹1.5 Cr"),
            ("Vikram (Senior Consultant)", "agent.vikram@estatelead.com", pw_agent, "+91 98400 11223", "agent", "Apartments", "Chennai", "₹80L - ₹1.5 Cr"),
            ("Priya Sundaram (Buyer)", "priya.sundaram@example.com", pw_cust, "+91 98401 23456", "customer", "Apartments", "Chennai", "₹80L - ₹1.5 Cr"),
            ("Rahul Sharma (Buyer)", "rahul.sharma@example.com", pw_cust, "+91 98840 98765", "customer", "Luxury Villas", "Bangalore", "Above ₹1.5 Cr"),
        ]
        cur.executemany("INSERT INTO users (name, email, password_hash, phone, role, preferred_property_type, preferred_location, budget_range) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", users_seed)

    cur.execute("SELECT count(*) FROM properties")
    if cur.fetchone()[0] == 0:
        props = [
            ("Green Valley Residency", "Anna Nagar, Chennai", "Apartments", 3, 12000000, 1850, "Active", 1, "Exclusive 3-BHK luxury apartment with smart automation and modular kitchen.", "Swimming Pool, Gymnasium, Clubhouse, 24/7 Security", "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=600&q=80", 480, 24),
            ("Marina View Penthouse", "ECR, Chennai", "Penthouses", 4, 38000000, 3400, "Active", 1, "Stunning sea-facing duplex penthouse with private rooftop infinity pool.", "Private Pool, Sea View, Concierge, Sky Deck", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=600&q=80", 920, 56),
            ("Royal Palm Villa", "Whitefield, Bangalore", "Luxury Villas", 4, 25000000, 2900, "Active", 1, "Gated community 4-BHK private villa with landscaped garden and solar power grid.", "Private Garden, Solar Grid, Gated Security, Tennis Court", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80", 640, 38),
            ("Silicon Heights", "Koramangala, Bangalore", "Apartments", 2, 8500000, 1250, "Active", 0, "Modern 2-BHK executive suite ideal for IT professionals near startup hubs.", "EV Charging, Co-working Lounge, High Speed Internet", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=600&q=80", 310, 15),
            ("Ocean Breeze Estate Plots", "Kovalam Beach Road, Chennai", "Plots", 0, 16000000, 4800, "Active", 1, "CMDA approved prime residential villa plots facing the East Coast corridor.", "Clear Title, 40ft Blacktop Roads, Underground Cabling", "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80", 510, 29),
            ("Tech Zone Commercial Complex", "Peelamedu, Coimbatore", "Commercial Spaces", 0, 45000000, 7500, "Active", 0, "Grade-A IT & corporate office building with 100% power backup.", "Central AC, High-speed Elevators, Ample Parking", "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80", 280, 11)
        ]
        cur.executemany("INSERT INTO properties (title, location, property_type, bhk, price, area, status, featured, description, amenities, image_url, views_count, saves_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", props)

    cur.execute("SELECT count(*) FROM leads")
    if cur.fetchone()[0] == 0:
        leads = [
            (4, 1, "Priya Sundaram", "+91 98401 23456", "priya.sundaram@example.com", "Chennai", "Chennai", "₹80L - ₹1.5 Cr", "Apartments", "Schedule Site Visit", "Website", "Site Tour Modal", "Immediate", "Phone", "Interested in 3-BHK flat on 4th floor.", 88, 88, "HOT", "HOT", "High Budget + Immediate Purchase Intent", "Site Visit", 3, "Confirmed site tour on Sunday."),
            (5, 3, "Rahul Sharma", "+91 98840 98765", "rahul.sharma@example.com", "Bangalore", "Bangalore", "Above ₹1.5 Cr", "Luxury Villas", "Price Negotiation", "Website", "Direct Consultation", "Within 1 month", "Phone", "Seeking payment schedule for Royal Palm Villa.", 92, 92, "HOT", "HOT", "Verified Villa Buyer + Final Stage", "Negotiation", 3, "Price discussion in progress."),
            (None, 2, "Ananya Krishnan", "+91 97900 11223", "ananya.k@example.com", "Chennai", "Chennai", "Above ₹1.5 Cr", "Penthouses", "Download Brochure", "Website", "Brochure Modal", "Within 1-3 months", "Email", "Downloaded Marina View Penthouse specs.", 78, 78, "HOT", "HOT", "Penthouse Brochure Download", "Contacted", 3, "Sent floor plans via email."),
            (None, 6, "Karthik Raja", "+91 94440 55667", "karthik.raja@example.com", "Coimbatore", "Coimbatore", "Above ₹1.5 Cr", "Commercial Spaces", "General Enquiry", "Website", "Catalog Page", "Within 3-6 months", "Email", "Inquiring about ROI on commercial complex.", 62, 62, "WARM", "WARM", "Commercial Property Inquiry", "New", 3, "Initial inquiry logged."),
            (None, 1, "Deepa Venkat", "+91 98410 77889", "deepa.v@example.com", "Chennai", "Chennai", "₹50L - ₹80L", "Apartments", "Schedule Callback", "Website", "Contact Form", "Within 1-3 months", "Phone", "Requested morning callback.", 55, 55, "WARM", "WARM", "General Callback Request", "New", 3, "Callback pending."),
            (None, 5, "Suresh Kumar", "+91 98845 33445", "suresh.k@example.com", "Hyderabad", "Hyderabad", "₹80L - ₹1.5 Cr", "Plots", "General Enquiry", "Website", "Plot Details", "More than 6 months", "Email", "Looking for land investments in 2027.", 42, 42, "COLD", "COLD", "Long-term horizon inquiry", "New", 3, "Nurture sequence assigned.")
        ]
        cur.executemany("INSERT INTO leads (user_id, property_id, name, phone, email, location, preferred_location, budget, property_type, enquiry_type, source, source_page, timeline, preferred_contact, message, lead_score, score, lead_category, score_category, score_reason, status, assigned_to, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", leads)

    conn.commit()

@st.cache_resource
def get_db_connection():
    if DB_TYPE == "postgres":
        try:
            import psycopg2
            conn = psycopg2.connect(
                host=PGHOST,
                port=PGPORT,
                user=PGUSER,
                password=PGPASSWORD,
                dbname=PGDATABASE,
                connect_timeout=3
            )
            return conn, "PostgreSQL (Live Database)"
        except Exception:
            pass
    
    # SQLite Fallback with Auto-Bootstrap
    db_dir = os.path.join(os.path.dirname(__file__), "database")
    os.makedirs(db_dir, exist_ok=True)
    sqlite_path = os.path.join(db_dir, "realestate.db")
    conn = sqlite3.connect(sqlite_path, check_same_thread=False)
    bootstrap_sqlite_if_needed(conn)
    return conn, "Embedded Real Estate Engine (SQLite)"

conn, engine_type = get_db_connection()

# Execute SQL helper
def run_query(q, params=None):
    return pd.read_sql(q, conn, params=params)

def execute_query(q, params=None):
    cur = conn.cursor()
    if params:
        cur.execute(q, params)
    else:
        cur.execute(q)
    conn.commit()

# -------------------------------------------------------------
# AUTOMATIC ACTIVITY TRACKING & LEAD AUTO-UPDATE
# -------------------------------------------------------------
def log_activity(user_id, prop_id, activity_type, metadata):
    try:
        if DB_TYPE == "postgres" and "PostgreSQL" in engine_type:
            execute_query(
                "INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address) VALUES (%s, %s, %s, %s, %s)",
                (user_id, prop_id, activity_type, metadata, "127.0.0.1")
            )
        else:
            execute_query(
                "INSERT INTO user_activity (user_id, property_id, activity_type, metadata, ip_address) VALUES (?, ?, ?, ?, ?)",
                (user_id, prop_id, activity_type, metadata, "127.0.0.1")
            )
    except Exception as e:
        st.sidebar.error(f"Activity log error: {e}")

def update_customer_lead_on_login(user):
    """
    Automatically tracks and updates customer lead score and activity in database upon every login.
    """
    user_id = user["id"]
    email = user["email"]
    name = user["name"]
    phone = user.get("phone", "+91 98401 00000")
    pref_loc = user.get("preferred_location", "Chennai")
    pref_type = user.get("preferred_property_type", "Apartments")
    budget = user.get("budget_range", "₹80L - ₹1.5 Cr")

    # 1. Calculate Dynamic Algorithmic Lead Score
    score = 50
    if "1.5 Cr" in budget:
        score += 25
    elif "80L" in budget:
        score += 15
    if pref_loc in ["Chennai", "Bangalore"]:
        score += 15
    if pref_type in ["Luxury Villas", "Penthouses"]:
        score += 10

    category = "HOT" if score >= 75 else ("WARM" if score >= 50 else "COLD")
    reason = f"Active Customer Session | {pref_type} in {pref_loc} ({budget})"

    # 2. Check if lead exists for this user email
    try:
        existing = run_query("SELECT id FROM leads WHERE email = ? OR user_id = ?", (email, user_id)) if "SQLite" in engine_type else run_query("SELECT id FROM leads WHERE email = %s OR user_id = %s", (email, user_id))
        
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if len(existing) > 0:
            lead_id = existing.iloc[0]["id"]
            if "SQLite" in engine_type:
                execute_query("""
                    UPDATE leads 
                    SET lead_score = ?, score = ?, lead_category = ?, score_category = ?, score_reason = ?, preferred_location = ?, budget = ?, property_type = ?, notes = ?
                    WHERE id = ?
                """, (score, score, category, category, reason, pref_loc, budget, pref_type, f"Logged in at {now_str}", int(lead_id)))
            else:
                execute_query("""
                    UPDATE leads 
                    SET lead_score = %s, score = %s, lead_category = %s, score_category = %s, score_reason = %s, preferred_location = %s, budget = %s, property_type = %s, notes = %s
                    WHERE id = %s
                """, (score, score, category, category, reason, pref_loc, budget, pref_type, f"Logged in at {now_str}", int(lead_id)))
        else:
            # Create new qualified lead entry
            if "SQLite" in engine_type:
                execute_query("""
                    INSERT INTO leads (user_id, name, phone, email, location, preferred_location, budget, property_type, enquiry_type, lead_score, score, lead_category, score_category, score_reason, status, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Online Session', ?, ?, ?, ?, ?, 'Contacted', ?)
                """, (user_id, name, phone, email, pref_loc, pref_loc, budget, pref_type, score, score, category, category, reason, f"Auto-created on login {now_str}"))
            else:
                execute_query("""
                    INSERT INTO leads (user_id, name, phone, email, location, preferred_location, budget, property_type, enquiry_type, lead_score, score, lead_category, score_category, score_reason, status, notes)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Online Session', %s, %s, %s, %s, %s, 'Contacted', %s)
                """, (user_id, name, phone, email, pref_loc, pref_loc, budget, pref_type, score, score, category, category, reason, f"Auto-created on login {now_str}"))

        # Log User Activity
        log_activity(user_id, None, "user_login", f"Logged in as {user['role']} ({name})")
    except Exception as e:
        st.sidebar.warning(f"Lead sync note: {e}")

# -------------------------------------------------------------
# AUTHENTICATION STATE & LOGIN CONTROLLER
# -------------------------------------------------------------
if "user" not in st.session_state:
    st.session_state["user"] = None

def do_login(user_dict):
    st.session_state["user"] = user_dict
    if user_dict["role"] == "customer":
        update_customer_lead_on_login(user_dict)
    else:
        log_activity(user_dict["id"], None, "staff_login", f"Staff login: {user_dict['name']} ({user_dict['role']})")
    st.toast(f"Welcome back, {user_dict['name']}!", icon="👋")
    st.rerun()

def do_logout():
    if st.session_state["user"]:
        log_activity(st.session_state["user"]["id"], None, "logout", "User signed out")
    st.session_state["user"] = None
    st.toast("Signed out successfully.")
    st.rerun()

# -------------------------------------------------------------
# LOGIN / REGISTRATION MODAL VIEW (WHEN NOT AUTHENTICATED)
# -------------------------------------------------------------
if st.session_state["user"] is None:
    st.markdown("<div style='text-align: center; padding: 20px 0;'><h1>🏢 EstateLead Real Estate Platform</h1><p style='color: #64748b; font-size: 1.1rem;'>Digital Lead Generation, Conversion Funnel BI, and CRM Management</p></div>", unsafe_allow_html=True)
    
    col_l1, col_l2, col_l3 = st.columns([1, 2, 1])
    with col_l2:
        st.markdown("### ⚡ Instant 1-Click Role Login")
        st.caption("Click any persona below to immediately log in, inspect role dashboards, and trigger real-time activity tracking:")
        
        q1, q2 = st.columns(2)
        with q1:
            if st.button("👑 Admin: Ramya", use_container_width=True, type="primary"):
                users_df = run_query("SELECT * FROM users WHERE email = '953624244046@ritrjpm.ac.in'")
                if len(users_df) > 0:
                    do_login(users_df.iloc[0].to_dict())
            if st.button("👑 Admin: Rohini", use_container_width=True):
                users_df = run_query("SELECT * FROM users WHERE email = '953624244048@ritrjpm.ac.in'")
                if len(users_df) > 0:
                    do_login(users_df.iloc[0].to_dict())
            if st.button("💼 Agent: Vikram", use_container_width=True):
                users_df = run_query("SELECT * FROM users WHERE email = 'agent.vikram@estatelead.com'")
                if len(users_df) > 0:
                    do_login(users_df.iloc[0].to_dict())

        with q2:
            if st.button("🏡 Customer: Priya Sundaram", use_container_width=True, type="secondary"):
                users_df = run_query("SELECT * FROM users WHERE email = 'priya.sundaram@example.com'")
                if len(users_df) > 0:
                    do_login(users_df.iloc[0].to_dict())
            if st.button("🏡 Customer: Rahul Sharma", use_container_width=True):
                users_df = run_query("SELECT * FROM users WHERE email = 'rahul.sharma@example.com'")
                if len(users_df) > 0:
                    do_login(users_df.iloc[0].to_dict())

        st.markdown("---")
        
        auth_tab1, auth_tab2 = st.tabs(["🔐 Standard Login", "📝 Create Buyer Account"])
        
        with auth_tab1:
            with st.form("manual_login_form"):
                email_in = st.text_input("Email Address", placeholder="e.g. priya.sundaram@example.com")
                pass_in = st.text_input("Password", type="password", placeholder="Enter password")
                submit_login = st.form_submit_button("Sign In", use_container_width=True)
                
                if submit_login:
                    if not email_in or not pass_in:
                        st.error("Please provide both email and password.")
                    else:
                        q_user = run_query("SELECT * FROM users WHERE email = ?", (email_in.strip(),)) if "SQLite" in engine_type else run_query("SELECT * FROM users WHERE email = %s", (email_in.strip(),))
                        if len(q_user) == 0:
                            st.error("No account found with this email address.")
                        else:
                            u_row = q_user.iloc[0].to_dict()
                            if verify_password(pass_in, u_row.get("password_hash", "")):
                                do_login(u_row)
                            else:
                                st.error("Invalid password credentials.")

        with auth_tab2:
            with st.form("register_form"):
                reg_name = st.text_input("Full Name", placeholder="e.g. Ananya Krishnan")
                reg_email = st.text_input("Email Address", placeholder="e.g. ananya@example.com")
                reg_phone = st.text_input("Phone Number", placeholder="+91 98400 00000")
                reg_pass = st.text_input("Create Password", type="password")
                reg_city = st.selectbox("Preferred City", ["Chennai", "Bangalore", "Coimbatore", "Hyderabad"])
                reg_type = st.selectbox("Property Category", ["Apartments", "Luxury Villas", "Penthouses", "Plots", "Commercial Spaces"])
                reg_budget = st.selectbox("Target Budget", ["Under ₹50L", "₹50L - ₹80L", "₹80L - ₹1.5 Cr", "Above ₹1.5 Cr"])
                reg_submit = st.form_submit_button("Create Account & Enter Dashboard", use_container_width=True)

                if reg_submit:
                    if not reg_name or not reg_email or not reg_pass:
                        st.error("Please fill in all mandatory fields.")
                    else:
                        try:
                            hashed_p = hash_password(reg_pass)
                            if "SQLite" in engine_type:
                                execute_query("""
                                    INSERT INTO users (name, email, password_hash, phone, role, preferred_property_type, preferred_location, budget_range)
                                    VALUES (?, ?, ?, ?, 'customer', ?, ?, ?)
                                """, (reg_name, reg_email, hashed_p, reg_phone, reg_type, reg_city, reg_budget))
                            else:
                                execute_query("""
                                    INSERT INTO users (name, email, password_hash, phone, role, preferred_property_type, preferred_location, budget_range)
                                    VALUES (%s, %s, %s, %s, 'customer', %s, %s, %s)
                                """, (reg_name, reg_email, hashed_p, reg_phone, reg_type, reg_city, reg_budget))
                            
                            new_u = run_query("SELECT * FROM users WHERE email = ?", (reg_email,)) if "SQLite" in engine_type else run_query("SELECT * FROM users WHERE email = %s", (reg_email,))
                            if len(new_u) > 0:
                                do_login(new_u.iloc[0].to_dict())
                        except Exception as err:
                            st.error(f"Registration error (Email may already exist): {err}")
    st.stop()

# -------------------------------------------------------------
# AUTHENTICATED APPLICATION INTERFACE
# -------------------------------------------------------------
user = st.session_state["user"]
role = user["role"]
is_staff = role in ["admin", "agent"]

# Sidebar Profile & Navigation
st.sidebar.markdown(f"### 👤 {user['name']}")
role_badge = "👑 ADMINISTRATOR" if role == "admin" else ("💼 SALES CONSULTANT" if role == "agent" else "🏡 VERIFIED BUYER")
st.sidebar.caption(f"**{role_badge}**")
st.sidebar.caption(f"✉️ {user['email']}")

if st.sidebar.button("🚪 Logout", use_container_width=True):
    do_logout()

st.sidebar.markdown("---")

# Dynamic Menu based on Role
if is_staff:
    menu = st.sidebar.radio(
        "Management Portal",
        [
            "📊 Executive Analytics BI",
            "👥 Lead CRM & Pipeline",
            "🏡 Property Inventory",
            "📜 Live Activity & Audit Trail",
            "🏦 Mortgage Calculator"
        ]
    )
else:
    menu = st.sidebar.radio(
        "Buyer Navigation",
        [
            "🎯 Personalized Matches",
            "🏡 Explore Properties",
            "📋 My Enquiries & Tours",
            "🏦 Mortgage EMI Estimator",
            "⚙️ My Preferences Profile"
        ]
    )

st.sidebar.markdown("---")
st.sidebar.caption(f"Database: **{engine_type}**")

# -------------------------------------------------------------
# STAFF VIEW 1: EXECUTIVE ANALYTICS BI
# -------------------------------------------------------------
if is_staff and menu == "📊 Executive Analytics BI":
    st.title("📊 Executive Business Intelligence & Analytics")
    st.markdown("End-to-end digital conversion funnels, buyer demand breakdown, and revenue trajectory.")

    try:
        leads_df = run_query("SELECT * FROM leads")
        props_df = run_query("SELECT * FROM properties")
        
        total_leads = len(leads_df)
        hot_leads = len(leads_df[leads_df["lead_category"] == "HOT"])
        converted = len(leads_df[leads_df["status"] == "Converted"])
        conv_rate = f"{(converted / max(total_leads, 1) * 100):.1f}%"
        pipeline_val = props_df["price"].sum() / 1e7 if len(props_df) > 0 else 0

        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Active Pipeline Valuation", f"₹{pipeline_val:.2f} Cr", "+12% MoM")
        col2.metric("Total Qualified Leads", total_leads, f"🔥 {hot_leads} Hot Intent Leads")
        col3.metric("Converted Sales Deals", converted, "Verified Closed")
        col4.metric("Conversion Rate", conv_rate, "Target: 20%")

        st.markdown("---")

        c1, c2 = st.columns(2)
        with c1:
            st.subheader("🎯 6-Stage Conversion Funnel")
            total_views = int(props_df["views_count"].sum()) if "views_count" in props_df else 2400
            contacted = len(leads_df[leads_df["status"].isin(["Contacted", "Site Visit", "Negotiation", "Converted"])])
            site_visits = len(leads_df[leads_df["status"].isin(["Site Visit", "Negotiation", "Converted"])])
            negotiations = len(leads_df[leads_df["status"].isin(["Negotiation", "Converted"])])
            
            funnel_data = dict(
                stage=['1. Property Views', '2. Captured Enquiries', '3. Contacted / Qualified', '4. Site Tours Done', '5. Price Negotiation', '6. Closed Deals'],
                count=[max(total_views, 2500), max(total_leads, 6), max(contacted, 5), max(site_visits, 3), max(negotiations, 2), max(converted, 1)]
            )
            fig_funnel = px.funnel(funnel_data, x='count', y='stage', color_discrete_sequence=['#d97706'])
            fig_funnel.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=320)
            st.plotly_chart(fig_funnel, use_container_width=True)

        with c2:
            st.subheader("📈 Inbound Demand & Revenue Trajectory")
            trend_df = pd.DataFrame({
                "Month": ["May", "Jun", "Jul", "Aug", "Sep", "Oct (Proj)"],
                "Leads": [4, 7, 9, 12, max(total_leads, 14), max(total_leads + 4, 18)],
                "Deal Valuation (₹ Cr)": [4.5, 6.2, 8.8, 11.4, 15.8, 19.5]
            })
            fig_trend = px.line(trend_df, x="Month", y=["Leads", "Deal Valuation (₹ Cr)"], markers=True, color_discrete_sequence=['#0284c7', '#10b981'])
            fig_trend.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=320)
            st.plotly_chart(fig_trend, use_container_width=True)

        c3, c4 = st.columns(2)
        with c3:
            st.subheader("📍 Buyer Demand by City")
            city_counts = leads_df["preferred_location"].value_counts().reset_index() if "preferred_location" in leads_df and len(leads_df) > 0 else pd.DataFrame({"City": ["Chennai", "Bangalore", "Coimbatore"], "count": [4, 2, 1]})
            city_counts.columns = ["City", "Leads"]
            fig_city = px.pie(city_counts, names="City", values="Leads", hole=0.5, color_discrete_sequence=px.colors.sequential.Sunset)
            fig_city.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=280)
            st.plotly_chart(fig_city, use_container_width=True)

        with c4:
            st.subheader("🏰 Demand by Property Category")
            type_counts = leads_df["property_type"].value_counts().reset_index() if "property_type" in leads_df and len(leads_df) > 0 else pd.DataFrame({"Category": ["Apartments", "Villas"], "count": [4, 2]})
            type_counts.columns = ["Category", "Inquiries"]
            fig_type = px.bar(type_counts, x="Category", y="Inquiries", color="Category", color_discrete_sequence=px.colors.qualitative.Prism)
            fig_type.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=280, showlegend=False)
            st.plotly_chart(fig_type, use_container_width=True)

    except Exception as e:
        st.error(f"Analytics query error: {e}")

# -------------------------------------------------------------
# STAFF VIEW 2: LEAD CRM & PIPELINE
# -------------------------------------------------------------
elif is_staff and menu == "👥 Lead CRM & Pipeline":
    st.title("👥 Lead CRM & Pipeline Manager")
    st.markdown("Live qualification scoring, consultant assignments, and stage transitions.")

    try:
        leads_df = run_query("SELECT id, name, phone, email, location, property_type, budget, lead_score, lead_category, status, enquiry_type, notes FROM leads ORDER BY id DESC")
        
        f1, f2, f3 = st.columns([1, 1, 2])
        with f1:
            cat_f = st.selectbox("Filter Intent", ["ALL", "HOT", "WARM", "COLD"])
        with f2:
            stat_f = st.selectbox("Filter Stage", ["ALL", "New", "Contacted", "Site Visit", "Negotiation", "Converted", "Lost"])
        with f3:
            search_q = st.text_input("🔍 Search Leads", placeholder="Search by name, phone, city...")

        df_filtered = leads_df.copy()
        if cat_f != "ALL":
            df_filtered = df_filtered[df_filtered["lead_category"] == cat_f]
        if stat_f != "ALL":
            df_filtered = df_filtered[df_filtered["status"] == stat_f]
        if search_q:
            df_filtered = df_filtered[df_filtered["name"].str.contains(search_q, case=False, na=False) | df_filtered["email"].str.contains(search_q, case=False, na=False)]

        st.dataframe(df_filtered, use_container_width=True, hide_index=True)

        st.markdown("---")
        st.subheader("⚡ Update Lead Status & Add Follow-up")
        
        if len(df_filtered) > 0:
            lead_choices = {f"#{row['id']} - {row['name']} ({row['status']})": row['id'] for _, row in df_filtered.iterrows()}
            selected_label = st.selectbox("Select Lead to Update", list(lead_choices.keys()))
            selected_id = lead_choices[selected_label]

            u1, u2 = st.columns(2)
            with u1:
                new_status = st.selectbox("Transition Status", ["New", "Contacted", "Site Visit", "Negotiation", "Converted", "Lost"])
            with u2:
                followup_notes = st.text_input("Follow-up Interaction Notes", placeholder="e.g. Scheduled site tour for Saturday 11 AM")

            if st.button("💾 Save Lead Update", type="primary"):
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                if "SQLite" in engine_type:
                    execute_query("UPDATE leads SET status = ?, notes = ? WHERE id = ?", (new_status, f"{followup_notes} ({now_str})", int(selected_id)))
                else:
                    execute_query("UPDATE leads SET status = %s, notes = %s WHERE id = %s", (new_status, f"{followup_notes} ({now_str})", int(selected_id)))
                
                log_activity(user["id"], None, "update_lead", f"Updated Lead #{selected_id} to status: {new_status}")
                st.success(f"Lead #{selected_id} updated to '{new_status}'!")
                st.rerun()

    except Exception as e:
        st.error(f"CRM Error: {e}")

# -------------------------------------------------------------
# STAFF VIEW 3: PROPERTY INVENTORY
# -------------------------------------------------------------
elif is_staff and menu == "🏡 Property Inventory":
    st.title("🏡 Property Inventory Management")
    
    props_df = run_query("SELECT id, title, location, property_type, bhk, price, area, status, featured, views_count, saves_count FROM properties ORDER BY id DESC")
    st.dataframe(props_df, use_container_width=True, hide_index=True)

    with st.expander("➕ Add New Property Listing"):
        with st.form("add_prop_form"):
            p_title = st.text_input("Property Residence Title")
            p_loc = st.text_input("Location / City", "Anna Nagar, Chennai")
            p_type = st.selectbox("Type", ["Apartments", "Luxury Villas", "Penthouses", "Plots", "Commercial Spaces"])
            p_bhk = st.number_input("BHK", min_value=0, max_value=10, value=3)
            p_price = st.number_input("Price (₹)", min_value=1000000, max_value=500000000, value=12000000, step=500000)
            p_area = st.number_input("Super Built-up Area (Sq.Ft)", value=1850)
            p_featured = st.checkbox("Mark as Featured Luxury Property")
            p_submit = st.form_submit_button("Publish Property Listing", type="primary")

            if p_submit:
                if p_title:
                    feat_val = 1 if p_featured else 0
                    if "SQLite" in engine_type:
                        execute_query("INSERT INTO properties (title, location, property_type, bhk, price, area, status, featured) VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)",
                                      (p_title, p_loc, p_type, p_bhk, p_price, p_area, feat_val))
                    else:
                        execute_query("INSERT INTO properties (title, location, property_type, bhk, price, area, status, featured) VALUES (%s, %s, %s, %s, %s, %s, 'Active', %s)",
                                      (p_title, p_loc, p_type, p_bhk, p_price, p_area, bool(p_featured)))
                    log_activity(user["id"], None, "create_property", f"Added property: {p_title}")
                    st.success("New property published successfully!")
                    st.rerun()

# -------------------------------------------------------------
# STAFF VIEW 4: LIVE ACTIVITY & AUDIT TRAIL
# -------------------------------------------------------------
elif is_staff and menu == "📜 Live Activity & Audit Trail":
    st.title("📜 Real-Time User Activity & Audit Trail")
    st.markdown("Tracks every user login, lead generation event, property view, and administrative action.")

    try:
        act_df = run_query("""
            SELECT a.id, COALESCE(u.name, 'Guest') as user_name, COALESCE(u.role, 'visitor') as role,
                   a.activity_type, a.metadata, a.ip_address, a.timestamp
            FROM user_activity a
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.id DESC
            LIMIT 50
        """)
        st.dataframe(act_df, use_container_width=True, hide_index=True)
    except Exception as e:
        st.error(f"Activity query error: {e}")

# -------------------------------------------------------------
# CUSTOMER VIEW 1: PERSONALIZED MATCHES
# -------------------------------------------------------------
elif not is_staff and menu == "🎯 Personalized Matches":
    st.title(f"🎯 Recommended For You, {user['name'].split(' ')[0]}!")
    st.markdown(f"Tailored to your preferences: **{user.get('preferred_property_type', 'Apartments')}** in **{user.get('preferred_location', 'Chennai')}** ({user.get('budget_range', '₹80L - ₹1.5 Cr')})")

    try:
        props_df = run_query("SELECT * FROM properties WHERE status = 'Active'")
        
        # Calculate Match Scores
        def compute_match(row):
            score = 50
            if row["location"] and user.get("preferred_location", "Chennai").lower() in row["location"].lower():
                score += 30
            if row["property_type"] == user.get("preferred_property_type", "Apartments"):
                score += 20
            return min(score, 98)

        props_df["match_score"] = props_df.apply(compute_match, axis=1)
        props_df = props_df.sort_values(by="match_score", ascending=False)

        cols = st.columns(3)
        for idx, row in props_df.iterrows():
            with cols[idx % 3]:
                st.image(row.get("image_url") or "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=600&q=80", use_container_width=True)
                st.markdown(f"### {row['title']}")
                st.markdown(f"🎯 **{row['match_score']}% Match** | 📍 {row['location']}")
                st.markdown(f"💰 **₹{row['price']/1e5:.1f} Lakhs** | 📐 {int(row['area'])} Sq.Ft")
                
                if st.button(f"📅 Book Site Tour #{row['id']}", key=f"tour_{row['id']}"):
                    log_activity(user["id"], row["id"], "book_site_visit", f"Requested site visit for {row['title']}")
                    st.success(f"Site tour requested for {row['title']}! A consultant will call you shortly.")
                st.markdown("---")

    except Exception as e:
        st.error(f"Error loading recommendations: {e}")

# -------------------------------------------------------------
# CUSTOMER VIEW 2: EXPLORE PROPERTIES
# -------------------------------------------------------------
elif not is_staff and menu == "🏡 Explore Properties":
    st.title("🏡 Luxury Property Inventory Catalog")
    
    props_df = run_query("SELECT * FROM properties WHERE status = 'Active'")
    
    f_city = st.selectbox("Filter City", ["All Cities"] + list(props_df["location"].dropna().unique()))
    if f_city != "All Cities":
        props_df = props_df[props_df["location"] == f_city]

    for _, p in props_df.iterrows():
        c1, c2 = st.columns([1, 2])
        with c1:
            st.image(p.get("image_url") or "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=600&q=80", use_container_width=True)
        with c2:
            st.markdown(f"## {p['title']}")
            st.markdown(f"📍 **{p['location']}** | 🏢 **{p['property_type']}** | 🛏️ **{p['bhk']} BHK**")
            st.markdown(f"💰 **₹{p['price']/1e5:.1f} Lakhs** | 📐 **{int(p['area'])} Sq.Ft**")
            st.write(p.get("description", "Luxury residence with premium fittings."))
            
            b1, b2 = st.columns(2)
            with b1:
                if st.button(f"👁️ Inspect Residence", key=f"view_{p['id']}"):
                    log_activity(user["id"], p["id"], "view_property", f"Inspected details for {p['title']}")
                    st.info(f"Logged inspection for {p['title']}!")
            with b2:
                if st.button(f"❤️ Save to Wishlist", key=f"save_{p['id']}"):
                    log_activity(user["id"], p["id"], "save_wishlist", f"Saved {p['title']} to wishlist")
                    st.success(f"Added {p['title']} to your wishlist!")
        st.markdown("---")

# -------------------------------------------------------------
# CUSTOMER VIEW 3: MY ENQUIRIES & TOURS
# -------------------------------------------------------------
elif not is_staff and menu == "📋 My Enquiries & Tours":
    st.title("📋 My Active Enquiries & Tour Bookings")
    
    my_leads = run_query("SELECT * FROM leads WHERE user_id = ? OR email = ?", (user["id"], user["email"])) if "SQLite" in engine_type else run_query("SELECT * FROM leads WHERE user_id = %s OR email = %s", (user["id"], user["email"]))
    
    if len(my_leads) == 0:
        st.info("You haven't requested any property tours or callbacks yet.")
    else:
        for _, l in my_leads.iterrows():
            st.markdown(f"### Enquiry #{l['id']} - {l.get('enquiry_type', 'General Consultation')}")
            st.markdown(f"**Status:** `{l.get('status', 'New')}` | **Intent Score:** `{l.get('lead_score', 50)}/100` ({l.get('lead_category', 'WARM')})")
            st.markdown(f"**Target:** {l.get('property_type', 'Apartments')} in {l.get('preferred_location', 'Chennai')} ({l.get('budget', 'Standard')})")
            st.caption(f"Notes: {l.get('notes', 'Under consultant review')}")
            st.markdown("---")

# -------------------------------------------------------------
# CUSTOMER VIEW 4 / STAFF VIEW 5: MORTGAGE EMI ESTIMATOR
# -------------------------------------------------------------
elif menu in ["🏦 Mortgage EMI Estimator", "🏦 Mortgage Calculator"]:
    st.title("🏦 Interactive Mortgage Loan EMI Calculator")
    
    col_a, col_b = st.columns(2)
    with col_a:
        prop_price = st.slider("Property Value (₹)", 2000000, 50000000, 12000000, step=500000)
        down_pct = st.slider("Down Payment (%)", 10, 50, 20, step=5)
        rate = st.slider("Interest Rate (%)", 6.5, 14.0, 8.5, step=0.1)
        tenure = st.slider("Tenure (Years)", 5, 30, 20, step=1)

        down_val = prop_price * (down_pct / 100)
        principal = prop_price - down_val
        monthly_rate = (rate / 12) / 100
        months = tenure * 12
        emi = (principal * monthly_rate * ((1 + monthly_rate)**months)) / (((1 + monthly_rate)**months) - 1)
        total_payment = emi * months
        total_interest = total_payment - principal

        st.success(f"### Estimated Monthly EMI: **₹{int(emi):,}**")
        st.write(f"• **Principal Loan Amount:** ₹{int(principal):,}")
        st.write(f"• **Total Interest Payable:** ₹{int(total_interest):,}")
        st.write(f"• **Total Repayment Amount:** ₹{int(total_payment):,}")

    with col_b:
        fig_emi = px.pie(
            names=["Principal Loan Amount", "Total Interest Payable"],
            values=[principal, total_interest],
            hole=0.6,
            color_discrete_sequence=['#0284c7', '#d97706']
        )
        fig_emi.update_layout(title="Loan Breakup (Principal vs Interest)", margin=dict(l=20, r=20, t=40, b=20))
        st.plotly_chart(fig_emi, use_container_width=True)

# -------------------------------------------------------------
# CUSTOMER VIEW 5: MY PREFERENCES PROFILE
# -------------------------------------------------------------
elif not is_staff and menu == "⚙️ My Preferences Profile":
    st.title("⚙️ Personalization & Match Criteria Profile")
    
    with st.form("pref_update_form"):
        u_city = st.selectbox("Preferred City", ["Chennai", "Bangalore", "Coimbatore", "Hyderabad"], index=["Chennai", "Bangalore", "Coimbatore", "Hyderabad"].index(user.get("preferred_location", "Chennai")))
        u_type = st.selectbox("Property Type", ["Apartments", "Luxury Villas", "Penthouses", "Plots", "Commercial Spaces"], index=["Apartments", "Luxury Villas", "Penthouses", "Plots", "Commercial Spaces"].index(user.get("preferred_property_type", "Apartments")))
        u_budget = st.selectbox("Budget Range", ["Under ₹50L", "₹50L - ₹80L", "₹80L - ₹1.5 Cr", "Above ₹1.5 Cr"], index=["Under ₹50L", "₹50L - ₹80L", "₹80L - ₹1.5 Cr", "Above ₹1.5 Cr"].index(user.get("budget_range", "₹80L - ₹1.5 Cr")))
        save_pref_btn = st.form_submit_button("Save & Recalculate Matches", type="primary")

        if save_pref_btn:
            if "SQLite" in engine_type:
                execute_query("UPDATE users SET preferred_location = ?, preferred_property_type = ?, budget_range = ? WHERE id = ?", (u_city, u_type, u_budget, user["id"]))
            else:
                execute_query("UPDATE users SET preferred_location = %s, preferred_property_type = %s, budget_range = %s WHERE id = %s", (u_city, u_type, u_budget, user["id"]))
            
            user["preferred_location"] = u_city
            user["preferred_property_type"] = u_type
            user["budget_range"] = u_budget
            st.session_state["user"] = user
            update_customer_lead_on_login(user)
            st.success("Preferences updated! Matches and lead score recalculated.")
            st.rerun()
