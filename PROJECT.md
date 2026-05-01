# Digital10 — Project Documentation

> Last updated: 2026-05-01
> Maintained by: Romulo Telles

---

## Overview

Digital10 is a Canadian e-commerce and services website offering:
- Electronics online store (138+ products)
- Web hosting plans
- eSIM data plans — live store, 190+ countries, Stripe payments, QR code by email
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
├── esim.html               # eSIM store — 190+ country plans, search, filters, Stripe checkout
├── coding-robotics.html    # Romulo Telles bio, programs, student letters carousel
├── admin.html              # Admin dashboard (password protected at /admin)
├── policy.html             # Policies & Terms (eSIM, electronics, hosting, general)
├── privacy.html            # Privacy Policy (PIPEDA compliant)
│
├── css/
│   └── style.css           # Global dark theme styles
│
├── js/
│   ├── main.js             # Cart, Stripe checkout modal, toast, nav, animations
│   └── shop.js             # Product inventory (138 items), filters, search — fetches live from /api/inventory
│
├── images/
│   ├── logo/               # Brand logos (PNG) — favicon-source.png (512x512) also here
│   ├── Products/           # Product photos (JPEG, converted from HEIC) — admin-uploadable
│   └── kids testimonials/  # Student letter photos for coding-robotics page
│
├── data/
│   └── inventory.json      # Authoritative price/stock source (server-side, not client-editable)
│
├── favicon.ico             # Multi-size ICO (16/32/48px) — browser tab icon
├── favicon-16x16.png       # PNG favicon 16×16
├── favicon-32x32.png       # PNG favicon 32×32
├── favicon-48x48.png       # PNG favicon 48×48
├── favicon-180x180.png     # Apple Touch Icon
├── favicon-192x192.png     # Android / PWA icon
├── favicon-512x512.png     # PWA splash icon
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
- 138 products — `shop.js` fetches live from `/api/inventory` on load (falls back to inlined INVENTORY if API fails)
- Category dropdown filter (14 categories)
- Text search
- Sort: Featured / Price Low-High / Price High-Low / Name A-Z
- Quick-view modal with product details
- Add to cart → cart drawer → Stripe checkout
- Shipping option selection: Canada Post ($10 flat) or Moncton NB Pickup (free)
- Free shipping automatically applied on orders ≥ $60 subtotal
- Results count display

### hosting.html — Web Hosting
- 3 plans: Starter ($4.99/mo), Pro ($9.99/mo), Business ($19.99/mo)
- Monthly / yearly toggle (yearly = 20% off)
- "Get Started" buttons add plan to cart and open checkout
- FAQ accordion, add-ons section

### esim.html — eSIM Store
- Live store powered by eSIM Access API (`/api/esim/packages`)
- 190+ countries — fetched and cached server-side (10-minute TTL)
- Search by country / destination
- Filters: Data size, Duration, Region (pre-filtered to North America on load)
- Sort: Price, A–Z, Data size
- Pagination: 20 plans per page
- Daily plans: custom day-selector with preset buttons (1, 3, 5, 7, 14, 30 days)
- Checkout modal: Stripe PaymentIntent (charged in USD), QR code delivered by email
- USD → CAD conversion shown live using cached exchange rate
- Pricing markup: `ESIM_MARKUP` env var (default 2.0× = 100% markup over wholesale cost)

### policy.html — Policies & Terms
- Tabbed layout: eSIM, Electronics, Web Hosting, General
- eSIM: no returns/refunds; report issues by email while plan is still active
- Electronics: 30-day returns, 30% restocking fee, customer pays return shipping; full refund/replacement for defective items; 90-day warranty
- Hosting: 30-day money-back guarantee for new customers
- General: shipping rates, payment terms, New Brunswick jurisdiction
- Deep-linkable tabs via URL hash (e.g. `policy.html#electronics`)

### privacy.html — Privacy Policy
- PIPEDA (Canada) compliant
- Covers: data collected, how it's used, third parties (Stripe, eSIM Access, Resend), 7-year retention, user rights
- Anchor-linked table of contents

### coding-robotics.html — Education
- Romulo Telles bio and photo
- 6 teaching program cards
- Full carousel of 16 student letter images
- Lightbox on click (keyboard navigation: arrows + Escape)

### admin.html — Admin Dashboard
- Accessible at: `http://localhost:8080/admin` or `http://[network-ip]:8080/admin`
- Password protected (set `ADMIN_PASSWORD` in `.env`)
- Two tabs: **Orders** and **Inventory**

**Orders tab:**
  - Revenue stats (total, orders, pending, shipped, delivered)
  - Orders table with search and status filter tabs
  - Click any order to open detail modal
  - Update shipping status, carrier, tracking number, internal notes
  - Save → automatically emails customer a shipping update
  - Resend Invoice button (re-sends branded HTML invoice)
  - Export all orders to CSV
  - Sandbox / Live mode indicator

**Inventory tab:**
  - Summary bar: product count, low stock, out of stock, featured count
  - Editable table: product photo (clickable), name, category, price, stock, featured toggle
  - Per-row Save button — saves to `data/inventory.json` via `PATCH /api/admin/inventory/:id`
  - Dirty state tracking (yellow border on unsaved rows)
  - Image picker modal: upload zone (up to 20 images at once, 8MB each), search, grid of all images in `images/Products/`

---

## Backend — server.js

Runs on port `8080` (configurable via `PORT` in `.env`).
Binds to `0.0.0.0` — accessible on local network.

### API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Server status, mode (sandbox/live), email configured |
| GET | `/api/inventory` | Public — full product list from `data/inventory.json` |
| POST | `/api/create-payment-intent` | Creates Stripe PaymentIntent, calculates total **server-side** including shipping |
| POST | `/api/orders/confirm` | Saves order to orders.json (includes shipping method/cost) + sends invoice email |
| POST | `/api/admin/login` | Verifies admin password |
| GET | `/api/admin/stats` | Revenue, order counts by status |
| GET | `/api/admin/orders` | List orders (supports ?status= and ?search=) |
| PATCH | `/api/admin/orders/:id` | Update order (status, tracking, carrier, notes) → sends shipping email |
| DELETE | `/api/admin/orders/:id` | Delete order |
| POST | `/api/admin/orders/:id/resend-invoice` | Resend invoice email to customer |
| GET | `/api/admin/export` | Download all orders as CSV |
| GET | `/api/admin/inventory` | Admin — full inventory with stock |
| PATCH | `/api/admin/inventory/:id` | Admin — update price, stock, featured, image for a product |
| GET | `/api/admin/inventory/images` | Admin — list all files in `images/Products/` recursively |
| POST | `/api/admin/inventory/upload-image` | Admin — upload up to 20 product images (multer, 8MB each) |
| GET | `/api/esim/packages` | Public — cached package list with USD→CAD rate |
| GET | `/api/esim/rate` | Public — current USD→CAD exchange rate |
| POST | `/api/esim/create-payment-intent` | Creates Stripe PaymentIntent for eSIM purchase |
| POST | `/api/esim/confirm` | Confirms eSIM order, provisions plan, emails QR code |
| POST | `/api/admin/esim/debug-order` | Admin — query eSIM provider for order status |
| POST | `/api/admin/orders/:id/resend-esim` | Admin — resend eSIM QR code to customer |
| POST | `/api/webhook` | Stripe webhook endpoint |
| GET | `/admin` | Serves admin.html |

### Order Storage
Orders are saved in `orders.json` (flat file, no database).
Each order contains: id, orderNumber, date, customer (name/email/postal), items, subtotal, total, status, tracking, carrier, shippedAt, deliveredAt, notes, shipping (method, cost, label).

### Security
- `orders.json` and `server.js` are blocked from direct HTTP access by middleware before `express.static`
- All prices are calculated **server-side** from `data/inventory.json` — client-supplied prices are ignored
- Admin routes require `x-admin-token` header matching `ADMIN_PASSWORD` (fixed null-bypass bug)
- `.env` is in `.gitignore` — never committed

---

## Payments — Stripe

- **Mode:** **LIVE** — real payments are active (keys switched 2026-04-28).
- **Flow:** Frontend collects card → user picks shipping method → POST to `/api/create-payment-intent` → server calculates subtotal + shipping server-side → Stripe returns `clientSecret` → frontend calls `stripe.confirmCardPayment()` → on success, calls `/api/orders/confirm`
- **Currency:** CAD (Canadian dollars)
- **Cards accepted:** Visa, Mastercard, American Express, Discover, JCB, UnionPay
- **Postal code:** Custom input supporting Canadian (K1A 0B1) and US (90210) formats
- **Security:** Total calculated server-side from `data/inventory.json` (prevents price tampering). Card details never touch Digital10 servers — handled entirely by Stripe.

### Keys in .env
| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side secret key (sk_test_... or sk_live_...) |
| `STRIPE_PUBLIC_KEY` | Client-side publishable key (pk_test_... or pk_live_...) — also hardcoded in js/main.js |
| `STRIPE_WEBHOOK_SECRET` | Optional — for verifying Stripe webhook events |

### Going Live (Stripe) — DONE (2026-04-28)
1. ~~Stripe Dashboard → Activate account~~ ✓
2. ~~Upload government ID~~ ✓
3. ~~Add bank account for payouts~~ ✓
4. ~~Replace test keys with live keys in `.env` and `js/main.js`~~ ✓
5. ~~HTTPS~~ ✓ — handled by Cloudflare Tunnel

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
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLIC_KEY=pk_live_...

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

# eSIM Access API
ESIM_ACCESS_TOKEN=your_token
ESIM_MARKUP=2.00         # sale price multiplier over wholesale cost (2.0 = 100% markup)
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
"multer":     "^1.x"      — Multipart image upload handling
"sharp":      "^0.33.x"   — Image processing / favicon PNG generation (devDependency)
"to-ico":     "^1.x"      — Convert PNGs to ICO favicon (devDependency)
```

---

## Product Inventory

- 138 products across 14 categories
- **Authoritative source:** `data/inventory.json` (price, stock, featured flag — editable via admin panel)
- `js/shop.js` fetches live from `/api/inventory` on page load; falls back to inlined `INVENTORY` constant if API unreachable
- Server-side: all prices are looked up from `data/inventory.json` — client cannot manipulate prices
- Product images: mix of Wikipedia URLs (default) and local files in `images/Products/`
- Local product photos are JPEG (converted from iPhone HEIC using `sips`)
- Admin can assign images and upload new photos via the Inventory tab

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
  pm2 list                                   # check status
  pm2 logs digital10                         # view logs
  pm2 restart digital10 --update-env        # restart app (always use --update-env to reload .env)
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

## Shipping (Electronics Checkout)

| Option | Cost | Condition |
|---|---|---|
| Canada Post | $10.00 flat | Default for all orders |
| Canada Post | Free | Subtotal ≥ $60.00 (applied automatically) |
| Pickup — Moncton, NB | Free | Always |

- Shipping method is selected by the customer in the checkout modal before payment
- Validation: payment cannot proceed without selecting a delivery method
- Shipping cost is calculated and added server-side in `/api/create-payment-intent`
- Shipping details stored in each order: `shipping.method`, `shipping.cost`, `shipping.label`
- Spam folder warning shown on order success screen (confirmation email can land in junk)

---

## Favicon

Generated from the Digital10 logo (`images/logo/logo_principal_semfundo_versao1-1536x922.png`).

| File | Size | Use |
|---|---|---|
| `favicon.ico` | 16/32/48px multi-size | All browsers (default) |
| `favicon-16x16.png` | 16×16 | PNG fallback |
| `favicon-32x32.png` | 32×32 | PNG fallback |
| `favicon-48x48.png` | 48×48 | Taskbar |
| `favicon-180x180.png` | 180×180 | Apple Touch Icon (iPhone home screen) |
| `favicon-192x192.png` | 192×192 | Android / PWA |
| `favicon-512x512.png` | 512×512 | PWA splash screen |

All HTML pages include `<link rel="icon">` and `<link rel="apple-touch-icon">` tags.

---

## Future / Pending

- [x] eSIM API integration — live with eSIM Access API (2026-05-01)
- [x] HTTPS / SSL — handled by Cloudflare Tunnel automatically
- [x] Deploy to public hosting — live at https://digital10.ca
- [x] Switch Stripe to live keys — done 2026-04-28
- [x] Favicon — generated and deployed 2026-04-29
- [x] Server-side price validation (security)
- [x] Inventory management in admin panel
- [x] Shipping options at checkout
- [x] Policy & Terms page — policy.html (2026-05-01)
- [x] Privacy Policy page — privacy.html, PIPEDA compliant (2026-05-01)
- [ ] Replace email text logo with hosted image (`https://digital10.ca/images/logo/...`)
- [ ] Update `www.digital10.ca` DNS in Cloudflare — change tunnel from `mapleedge-panel` to `medpreco`
- [ ] Shipping label generation (Shippo API — requires customer full address at checkout)
- [ ] Stripe webhook fully configured for production
- [ ] Convert remaining product photos from HEIC to JPEG
