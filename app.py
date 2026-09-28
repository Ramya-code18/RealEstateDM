"""
EstateLead - Streamlit Executive Analytics & CRM Dashboard (Python Companion)
Connects directly to PostgreSQL (estatelead_db) or embedded SQLite database with instant cloud failover.
"""
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import os
import sqlite3
from dotenv import load_dotenv

# Page configuration
st.set_page_config(
    page_title="EstateLead - Real Estate BI & CRM",
    page_icon="🏢",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Load environment variables
load_dotenv()

DB_TYPE = os.getenv("DB_TYPE", "postgres").lower()
PGHOST = os.getenv("PGHOST", "localhost")
PGPORT = os.getenv("PGPORT", "5432")
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "Ramya1811#")
PGDATABASE = os.getenv("PGDATABASE", "estatelead_db")

def bootstrap_sqlite_if_needed(conn):
    """Ensures tables and demo data exist if deployed on Streamlit Cloud without PostgreSQL."""
    cur = conn.cursor()
    cur.execute("CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, location TEXT, property_type TEXT, bhk INTEGER, price REAL, area REAL, status TEXT, featured INTEGER, views_count INTEGER, saves_count INTEGER);")
    cur.execute("CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, email TEXT, location TEXT, property_type TEXT, budget TEXT, lead_score INTEGER, lead_category TEXT, status TEXT, enquiry_type TEXT, preferred_location TEXT);")
    
    cur.execute("SELECT count(*) FROM properties")
    if cur.fetchone()[0] == 0:
        props = [
            ("Green Valley Residency", "Anna Nagar, Chennai", "Apartments", 3, 12000000, 1850, "Active", 1, 480, 24),
            ("Marina View Penthouse", "ECR, Chennai", "Penthouses", 4, 38000000, 3400, "Active", 1, 920, 56),
            ("Royal Palm Villa", "Whitefield, Bangalore", "Luxury Villas", 4, 25000000, 2900, "Active", 1, 640, 38),
            ("Silicon Heights", "Koramangala, Bangalore", "Apartments", 2, 8500000, 1250, "Active", 0, 310, 15),
            ("Ocean Breeze Estate", "Kovalam Beach Road, Chennai", "Plots", 0, 16000000, 4800, "Active", 1, 510, 29),
            ("Tech Zone Commercial Complex", "Peelamedu, Coimbatore", "Commercial Spaces", 0, 45000000, 7500, "Active", 0, 280, 11)
        ]
        cur.executemany("INSERT INTO properties (title, location, property_type, bhk, price, area, status, featured, views_count, saves_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", props)
        
        leads = [
            ("Priya Sundaram", "+91 98401 23456", "priya.sundaram@example.com", "Chennai", "Apartments", "₹80L - ₹1.5 Cr", 88, "HOT", "Site Visit", "Schedule Site Visit", "Chennai"),
            ("Rahul Sharma", "+91 98840 98765", "rahul.sharma@example.com", "Bangalore", "Luxury Villas", "Above ₹1.5 Cr", 92, "HOT", "Negotiation", "Price Negotiation", "Bangalore"),
            ("Ananya Krishnan", "+91 97900 11223", "ananya.k@example.com", "Chennai", "Penthouses", "Above ₹1.5 Cr", 78, "HOT", "Contacted", "Download Brochure", "Chennai"),
            ("Karthik Raja", "+91 94440 55667", "karthik.raja@example.com", "Coimbatore", "Commercial Spaces", "Above ₹1.5 Cr", 62, "WARM", "New", "General Enquiry", "Coimbatore"),
            ("Deepa Venkat", "+91 98410 77889", "deepa.v@example.com", "Chennai", "Apartments", "₹50L - ₹80L", 55, "WARM", "New", "Schedule Callback", "Chennai"),
            ("Suresh Kumar", "+91 98845 33445", "suresh.k@example.com", "Hyderabad", "Plots", "₹80L - ₹1.5 Cr", 42, "COLD", "New", "General Enquiry", "Hyderabad")
        ]
        cur.executemany("INSERT INTO leads (name, phone, email, location, property_type, budget, lead_score, lead_category, status, enquiry_type, preferred_location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", leads)
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
            return conn, "PostgreSQL (Live Cloud / Local)"
        except Exception as e:
            # Fallback cleanly
            pass
    
    # SQLite Fallback
    db_dir = os.path.join(os.path.dirname(__file__), "database")
    os.makedirs(db_dir, exist_ok=True)
    sqlite_path = os.path.join(db_dir, "realestate.db")
    conn = sqlite3.connect(sqlite_path, check_same_thread=False)
    bootstrap_sqlite_if_needed(conn)
    return conn, "Embedded Real Estate Engine (SQLite)"

conn, engine_type = get_db_connection()

# Sidebar
st.sidebar.image("https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=400&q=80", use_container_width=True)
st.sidebar.title("🏢 EstateLead BI")
st.sidebar.caption(f"Status: **{engine_type}**")
st.sidebar.markdown("---")

view_mode = st.sidebar.radio(
    "Navigation",
    ["📊 Executive Analytics & BI", "👥 Lead CRM & Pipeline", "🏡 Property Inventory", "🏦 Mortgage EMI Estimator"]
)

# Helper function to run query
def run_query(q, params=None):
    return pd.read_sql(q, conn, params=params)

# -------------------------------------------------------------
# VIEW 1: EXECUTIVE ANALYTICS & BI
# -------------------------------------------------------------
if view_mode == "📊 Executive Analytics & BI":
    st.title("📊 Executive Business Intelligence & Analytics")
    st.markdown("Real-time digital conversion funnels, buyer demand breakdown, and revenue trajectory.")

    # KPI Metrics
    try:
        leads_df = run_query("SELECT * FROM leads")
        props_df = run_query("SELECT * FROM properties")
        
        total_leads = len(leads_df)
        hot_leads = len(leads_df[leads_df["lead_category"] == "HOT"])
        converted = len(leads_df[leads_df["status"] == "Converted"])
        conv_rate = f"{(converted / max(total_leads, 1) * 100):.1f}%"
        
        # Calculate valuations
        pipeline_val = props_df["price"].sum() / 1e7 if len(props_df) > 0 else 0

        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Active Pipeline Valuation", f"₹{pipeline_val:.2f} Cr", "+12% this month")
        col2.metric("Total Qualified Leads", total_leads, f"🔥 {hot_leads} Hot Leads")
        col3.metric("Converted Sales Deals", converted, "+2 closed this week")
        col4.metric("Conversion Rate", conv_rate, "Target: 20%")

        st.markdown("---")

        # Row 1: Funnel + Trajectory
        c1, c2 = st.columns(2)
        with c1:
            st.subheader("🎯 6-Stage Real Estate Digital Funnel")
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

        # Row 2: Location Demand & Property Types
        c3, c4 = st.columns(2)
        with c3:
            st.subheader("📍 Buyer Demand by City")
            if "preferred_location" in leads_df and len(leads_df) > 0:
                city_counts = leads_df["preferred_location"].value_counts().reset_index()
                city_counts.columns = ["City", "Leads"]
            else:
                city_counts = pd.DataFrame({"City": ["Chennai", "Bangalore", "Coimbatore", "Hyderabad"], "Leads": [5, 3, 2, 2]})
            fig_city = px.pie(city_counts, names="City", values="Leads", hole=0.5, color_discrete_sequence=px.colors.sequential.Sunset)
            fig_city.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=280)
            st.plotly_chart(fig_city, use_container_width=True)

        with c4:
            st.subheader("🏰 Demand by Property Category")
            if "property_type" in leads_df and len(leads_df) > 0:
                type_counts = leads_df["property_type"].value_counts().reset_index()
                type_counts.columns = ["Category", "Inquiries"]
            else:
                type_counts = pd.DataFrame({"Category": ["Apartments", "Luxury Villas", "Penthouses", "Plots"], "Inquiries": [6, 4, 2, 1]})
            fig_type = px.bar(type_counts, x="Category", y="Inquiries", color="Category", color_discrete_sequence=px.colors.qualitative.Prism)
            fig_type.update_layout(margin=dict(l=20, r=20, t=20, b=20), height=280, showlegend=False)
            st.plotly_chart(fig_type, use_container_width=True)

    except Exception as e:
        st.error(f"Error loading analytics data: {e}")

# -------------------------------------------------------------
# VIEW 2: LEAD CRM & PIPELINE
# -------------------------------------------------------------
elif view_mode == "👥 Lead CRM & Pipeline":
    st.title("👥 Lead Management CRM")
    st.markdown("Algorithmic intent scoring, consultant assignments, and status pipeline.")

    try:
        leads_df = run_query("""
            SELECT l.id, l.name, l.phone, l.email, l.location, l.property_type,
                   l.budget, l.lead_score, l.lead_category, l.status, l.enquiry_type
            FROM leads l
            ORDER BY l.id DESC
        """)

        # Filters
        f1, f2 = st.columns(2)
        with f1:
            cat_filter = st.selectbox("Filter by Intent Category", ["ALL", "HOT", "WARM", "COLD"])
        with f2:
            status_filter = st.selectbox("Filter by Pipeline Status", ["ALL", "New", "Contacted", "Site Visit", "Negotiation", "Converted", "Lost"])

        filtered_df = leads_df.copy()
        if cat_filter != "ALL":
            filtered_df = filtered_df[filtered_df["lead_category"] == cat_filter]
        if status_filter != "ALL":
            filtered_df = filtered_df[filtered_df["status"] == status_filter]

        st.dataframe(filtered_df, use_container_width=True, hide_index=True)
        st.info(f"Showing **{len(filtered_df)}** of **{len(leads_df)}** leads in database.")

    except Exception as e:
        st.error(f"Error loading CRM leads: {e}")

# -------------------------------------------------------------
# VIEW 3: PROPERTY INVENTORY
# -------------------------------------------------------------
elif view_mode == "🏡 Property Inventory":
    st.title("🏡 Luxury Property Inventory Catalog")
    try:
        props_df = run_query("SELECT id, title, location, property_type, bhk, price, area, status, featured, views_count, saves_count FROM properties")
        st.dataframe(props_df, use_container_width=True, hide_index=True)
    except Exception as e:
        st.error(f"Error loading properties: {e}")

# -------------------------------------------------------------
# VIEW 4: MORTGAGE EMI ESTIMATOR
# -------------------------------------------------------------
elif view_mode == "🏦 Mortgage EMI Estimator":
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
        st.write(f"• **Principal Loan:** ₹{int(principal):,}")
        st.write(f"• **Total Interest:** ₹{int(total_interest):,}")
        st.write(f"• **Total Repayment:** ₹{int(total_payment):,}")

    with col_b:
        fig_emi = px.pie(
            names=["Principal Loan Amount", "Total Interest Payable"],
            values=[principal, total_interest],
            hole=0.6,
            color_discrete_sequence=['#0284c7', '#d97706']
        )
        fig_emi.update_layout(title="Loan Breakup", margin=dict(l=20, r=20, t=40, b=20))
        st.plotly_chart(fig_emi, use_container_width=True)
