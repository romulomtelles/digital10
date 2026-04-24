# Digital10 — Project Documentation

> Last updated: 2026-04-24
> Maintained by: Romulo Telles

---

## Overview

Digital10 is a Canadian e-commerce and services website offering:
- Electronics online store (138+ products)
- Web hosting plans
- eSIM service (coming soon)
- Coding & Robotics education (Romulo Telles)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Backend | Node.js + Express |
| Payments | Stripe (Stripe.js v3 + PaymentIntents API) |
| Email | Resend (SMTP) via Nodemailer |
| DNS / Email routing | Cloudflare |
| Domain | digital10.ca |

---

## Project Structure

```
Digital10/
├── index.html              # Home page — hero, featured products, testimonials
├── shop.html               # Electronics store — 138 products, filters, cart
├── hosting.html            # Web hosting plans (Starter, Pro, Business)
├── esim.html               # eSIM coming-soon page with notify form
├── coding-robotics.html    # Romulo Telles bio, programs, student letters carousel
├── admin.html              # Admin dashboard (password protected at /admin)
│
├── css/
│   └── style.css           # Global dark theme styles
│
├── js/
│   ├── main.js             # Cart, Stripe checkout modal, toast, nav, animations
│   └── shop.js             # Product inventory (138 items inlined), filters, search
│
├── images/
│   ├── logo/               # Brand logos (PNG)
│   ├── Products/           # Product photos (JPEG, converted from HEIC)
│   └── kids testimonials/  # Student letter photos for coding-robotics page
│
├── data/
│   └── inventory.json      # Product data reference (source of truth for shop.js)
│
├── server.js               # Express backend — all API routes
├── orders.json             # Local order database (auto-created on first sale)
├── package.json            # Node.js dependencies
├── .env                    # Secret keys — DO NOT commit to git
└── PROJECT.md              # This file
```

---

## Pages

### index.html — Home
- Hero section with logo, tagline, stats
- Featured products grid (10 specific product IDs)
- Trust strip (SSL, uptime, eSIM, payments, shipping)
- Services overview cards
- Testimonials carousel (student letters preview)
- Footer with nav links

### shop.html — Electronics Store
- 138 products loaded from `js/shop.js` (inlined, no fetch needed)
- Category dropdown filter (14 categories)
- Text search
- Sort: Featured / Price Low-High / Price High-Low / Name A-Z
- Quick-view modal with product details
- Add to cart → cart drawer → Stripe checkout
- Results count display

### hosting.html — Web Hosting
- 3 plans: Starter ($4.99/mo), Pro ($9.99/mo), Business ($19.99/mo)
- Monthly / yearly toggle (yearly = 20% off)
- "Get Started" buttons add plan to cart and open checkout
- FAQ accordion, add-ons section

### esim.html — eSIM (Coming Soon)
- Animated globe, floating countries ticker
- 6 feature preview cards
- Email notify form (shows toast, no backend needed yet)

### coding-robotics.html — Education
- Romulo Telles bio and photo
- 6 teaching program cards
- Full carousel of 16 student letter images
- Lightbox on click (keyboard navigation: arrows + Escape)

### admin.html — Admin Dashboard
- Accessible at: `http://localhost:8080/admin` or `http://[network-ip]:8080/admin`
- Password protected (set `ADMIN_PASSWORD` in `.env`)
- Features:
  - Revenue stats (total, orders, pending, shipped, delivered)
  - Orders table with search and status filter tabs
  - Click any order to open detail modal
  - Update shipping status, carrier, tracking number, internal notes
  - Save → automatically emails customer a shipping update
  - Resend Invoice button (re-sends branded HTML invoice)
  - Export all orders to CSV
  - Sandbox / Live mode indicator

---

## Backend — server.js

Runs on port `8080` (configurable via `PORT` in `.env`).
Binds to `0.0.0.0` — accessible on local network.

### API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Server status, mode (sandbox/live), email configured |
| POST | `/api/create-payment-intent` | Creates Stripe PaymentIntent, returns clientSecret |
| POST | `/api/orders/confirm` | Saves order to orders.json + sends invoice email |
| POST | `/api/admin/login` | Verifies admin password |
| GET | `/api/admin/stats` | Revenue, order counts by status |
| GET | `/api/admin/orders` | List orders (supports ?status= and ?search=) |
| PATCH | `/api/admin/orders/:id` | Update order (status, tracking, carrier, notes) → sends shipping email |
| DELETE | `/api/admin/orders/:id` | Delete order |
| POST | `/api/admin/orders/:id/resend-invoice` | Resend invoice email to customer |
| GET | `/api/admin/export` | Download all orders as CSV |
| POST | `/api/webhook` | Stripe webhook endpoint |
| GET | `/admin` | Serves admin.html |

### Order Storage
Orders are saved in `orders.json` (flat file, no database).
Each order contains: id, orderNumber, date, customer (name/email/postal), items, total, status, tracking, carrier, shippedAt, deliveredAt, notes.

---

## Payments — Stripe

- **Mode:** Sandbox (test) by default. Switch to live by replacing keys in `.env`.
- **Flow:** Frontend collects card → POST to `/api/create-payment-intent` → server calculates total server-side → Stripe returns `clientSecret` → frontend calls `stripe.confirmCardPayment()` → on success, calls `/api/orders/confirm`
- **Currency:** CAD (Canadian dollars)
- **Cards accepted:** Visa, Mastercard, American Express, Discover, JCB, UnionPay
- **Postal code:** Custom input supporting Canadian (K1A 0B1) and US (90210) formats
- **Security:** Total calculated server-side (prevents price tampering). Card details never touch Digital10 servers — handled entirely by Stripe.
- **Test card:** `4242 4242 4242 4242` · any future date · any 3-digit CVC

### Keys in .env
| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side secret key (sk_test_... or sk_live_...) |
| `STRIPE_PUBLIC_KEY` | Client-side publishable key (pk_test_... or pk_live_...) — also hardcoded in js/main.js |
| `STRIPE_WEBHOOK_SECRET` | Optional — for verifying Stripe webhook events |

### Going Live (Stripe)
1. Stripe Dashboard → Activate account (fill business profile)
2. Upload government ID for identity verification
3. Add bank account for payouts
4. Replace `sk_test_` / `pk_test_` keys with `sk_live_` / `pk_live_` in `.env` and `js/main.js`
5. Site must be served over HTTPS — required for live payments

---

## Email — Resend + Cloudflare

### Services Used
| Service | Role |
|---|---|
| **Resend** (resend.com) | Sends outgoing emails (invoices, shipping updates) via SMTP |
| **Cloudflare Email Routing** | Receives incoming emails at @digital10.ca and forwards to personal inbox |

### How They Work Together
- Cloudflare handles **incoming** mail via MX records → forwards orders@digital10.ca and info@digital10.ca to Romulo's personal inbox
- Resend handles **outgoing** mail via DKIM/SPF records → sends from orders@digital10.ca
- Both coexist in Cloudflare DNS without conflict

### Emails Sent Automatically
| Trigger | Email Type | Subject |
|---|---|---|
| Customer completes payment | Order confirmation + itemized invoice | `✅ Order Confirmed — D10-XXXXX` |
| Admin saves shipping changes | Shipping update | `🚚 Your Order is on the Way! — D10-XXXXX` |
| Admin marks delivered | Delivery confirmation | `✅ Order Delivered — D10-XXXXX` |
| Admin marks cancelled | Cancellation notice | `❌ Order Cancelled — D10-XXXXX` |
| Admin clicks Resend Invoice | Invoice re-sent | `✅ Order Confirmed — D10-XXXXX` |

### Keys in .env
| Variable | Description |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` (SSL) |
| `SMTP_USER` | `resend` (literal string, not an email) |
| `SMTP_PASS` | Resend API key (starts with `re_...`) |
| `EMAIL_FROM` | `orders@digital10.ca` |

### Logo in Emails
Currently a styled HTML/CSS text logo. Once digital10.ca is deployed publicly, replace `EMAIL_LOGO_HTML` in `server.js` with an `<img>` tag pointing to the hosted logo PNG.

---

## Admin Access

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Password to log in at `/admin` |

- Session stored in browser `sessionStorage` (clears on tab close)
- All admin API routes require `x-admin-token` header matching `ADMIN_PASSWORD`

---

## Environment Variables — .env

```
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLIC_KEY=pk_test_...

# Server
PORT=8080

# Admin
ADMIN_PASSWORD=your_password

# Email (Resend)
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_...
EMAIL_FROM=orders@digital10.ca
```

> The `.env` file must never be committed to git or shared publicly.

---

## Running the Server

```bash
# Install dependencies (first time only)
npm install

# Start server
node server.js

# Start with auto-reload (requires nodemon)
npm run dev

# Kill any process on port 8080 and restart
kill $(lsof -ti:8080) 2>/dev/null; node server.js
```

Server prints startup banner with:
- Local URL: `http://localhost:8080`
- Network URL: `http://[your-ip]:8080` (for testing on other devices on same Wi-Fi)
- Admin URL: `http://localhost:8080/admin`

---

## Dependencies

```json
"express":    "^4.19.2"   — HTTP server and routing
"stripe":     "^16.0.0"   — Stripe Payments SDK
"dotenv":     "^16.4.5"   — Load .env variables
"nodemailer": "^6.9.0"    — Send emails via SMTP (Resend)
```

---

## Product Inventory

- 138 products across 14 categories
- Stored inline in `js/shop.js` as `const INVENTORY = [...]` (no fetch required — works without a server)
- Also exported to `data/inventory.json` as reference
- Product images: mix of Wikipedia URLs (default) and local files in `images/Products/`
- Local product photos are JPEG (converted from iPhone HEIC using `sips`)

### Categories
Cables & Connectors · Development Boards · Display & Output · ICs & Chips · Input Devices · Kits & Bundles · Motors & Actuators · Power & Batteries · Robotics Components · Sensors · Starter Kits · Storage & Memory · Tools & Storage · Wireless & Communication

---

## Deployment

Site is live at **https://digital10.ca**

### Server
- Machine: `rom@192.168.2.253` (local network)
- App path: `/var/www/digital10/`
- Process manager: PM2 (app name: `digital10`, port 8080)
  ```bash
  pm2 list                    # check status
  pm2 logs digital10          # view logs
  pm2 restart digital10       # restart app
  ```

### Git / Deploy Flow
- GitHub repo: `https://github.com/romulomtelles/digital10`
- `.env` and `orders.json` are excluded from git — manage manually on server
- To deploy changes:
  ```bash
  # Local machine
  git add . && git commit -m "your message" && git push

  # Then on server
  ssh rom@192.168.2.253
  cd /var/www/digital10 && git pull && pm2 restart digital10
  ```

### Cloudflare Tunnel
- Tunnel name: `medpreco` — UUID: `ab27aefc-c20a-40dd-972f-28965d578236`
- Config on server: `/etc/cloudflared/config.yml`
- Routes: `digital10.ca → localhost:8080`, `remedios.digital10.ca → localhost:5000`
- SSL is handled automatically by Cloudflare — no certbot needed
- DNS record type is "Tunnel" (not A/CNAME) in Cloudflare dashboard

### Cloudflare DNS Records

| Type | Purpose |
|---|---|
| Tunnel | `digital10.ca` → medpreco tunnel (this site) |
| Tunnel | `remedios` → medpreco tunnel (separate app on port 5000) |
| MX | Incoming email routing (Cloudflare Email Routing) |
| TXT (SPF) | Authorizes Resend to send from digital10.ca |
| TXT/CNAME (DKIM) | Cryptographic signature for outgoing emails |

---

## Shipping Carriers Supported (Tracking Links)

Admin can select carrier when marking order as shipped. Tracking button in email links to:
- Canada Post
- Purolator
- UPS
- FedEx
- DHL

---

## Future / Pending

- [ ] eSIM API integration (eSIM Access API — credentials in .env)
- [x] HTTPS / SSL — handled by Cloudflare Tunnel automatically
- [x] Deploy to public hosting — live at https://digital10.ca
- [ ] Replace email text logo with hosted image (site is live, can now use `https://digital10.ca/images/logo/...`)
- [ ] Update `www.digital10.ca` DNS in Cloudflare — change tunnel from `mapleedge-panel` to `medpreco`
- [ ] Shipping label generation (Shippo API — requires customer full address at checkout)
- [ ] Switch Stripe from test keys to live keys when ready to accept real payments
- [ ] Stripe webhook fully configured for production
- [ ] Convert remaining product photos from HEIC to JPEG
