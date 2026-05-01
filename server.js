// =============================================
//  DIGITAL10 — Backend Server
//  Node.js + Express + Stripe + Nodemailer
// =============================================
require('dotenv').config();
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const stripe    = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const QRCode    = require('qrcode');
const multer    = require('multer');

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'images/Products'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2,6)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    /\.(jpe?g|png|gif|webp)$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Images only.'));
  }
});

const app  = express();
const PORT = process.env.PORT || 8080;
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ── Order Storage ───────────────────────────
function loadOrders() {
  try {
    if (!fs.existsSync(ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch { return []; }
}
function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ── Admin Auth Middleware ────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const pwd   = process.env.ADMIN_PASSWORD;
  if (pwd && token === pwd) return next();
  res.status(401).json({ error: 'Unauthorized.' });
}

// ── Middleware ──────────────────────────────
app.use(express.json());

// Block sensitive files from static serving
app.use((req, res, next) => {
  const blocked = ['/orders.json', '/server.js'];
  if (blocked.includes(req.path)) return res.status(403).end();
  next();
});

app.use(express.static(path.join(__dirname)));

// ── Health ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode:  process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : 'sandbox',
    email: !!(process.env.SMTP_USER && process.env.SMTP_PASS)
  });
});

// ── Create PaymentIntent ─────────────────────
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { cart, email, name, postal, shippingMethod } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: 'Cart is empty.' });
    if (!email || !name) return res.status(400).json({ error: 'Name and email are required.' });
    if (!['canada_post', 'pickup'].includes(shippingMethod)) {
      return res.status(400).json({ error: 'Please select a delivery method.' });
    }

    // Look up prices from authoritative server-side catalog — never trust client prices
    const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/inventory.json'), 'utf8'));
    let subtotalCents = 0;
    const verifiedItems = [];
    for (const item of cart) {
      const product = inventory.find(p => p.id === item.id);
      if (!product) return res.status(400).json({ error: `Product not found: ${item.id}` });
      const qty = Math.max(1, parseInt(item.qty) || 1);
      subtotalCents += Math.round(product.price * 100) * qty;
      verifiedItems.push({ name: product.name, qty, price: product.price });
    }

    if (subtotalCents < 50) return res.status(400).json({ error: 'Order total is too low.' });

    const FREE_SHIPPING_THRESHOLD = 6000; // $60.00 CAD in cents
    const shippingCents = (shippingMethod === 'canada_post' && subtotalCents < FREE_SHIPPING_THRESHOLD) ? 1000 : 0;
    const totalCents = subtotalCents + shippingCents;

    const itemsSummary = verifiedItems
      .map(i => `${i.name} x${i.qty} ($${(i.price * i.qty).toFixed(2)})`)
      .join(', ');

    const paymentIntent = await stripe.paymentIntents.create({
      amount:        totalCents,
      currency:      'cad',
      receipt_email: email,
      description:   `Digital10 Order — ${cart.length} item(s)`,
      metadata: {
        customer_name:   name,
        postal_code:     postal || '',
        item_count:      cart.length,
        items:           itemsSummary.substring(0, 500),
        shipping_method: shippingMethod,
        shipping_cost:   (shippingCents / 100).toFixed(2)
      }
    });

    console.log(`[Stripe] PaymentIntent created: ${paymentIntent.id} — $${(totalCents/100).toFixed(2)} CAD (${shippingMethod}, shipping $${(shippingCents/100).toFixed(2)}) for ${email}`);
    res.json({ clientSecret: paymentIntent.client_secret, subtotal: subtotalCents/100, shippingCost: shippingCents/100, total: totalCents/100 });

  } catch (err) {
    console.error('[Stripe error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Confirm & Save Order (called by frontend after payment succeeds) ──
app.post('/api/orders/confirm', async (req, res) => {
  try {
    const { paymentIntentId, cart, email, name, postal, total, shippingMethod, shippingCost } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'Missing payment ID.' });

    // Verify payment actually succeeded with Stripe
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment not confirmed. Please complete payment first.' });
    }

    const orders = loadOrders();
    if (orders.find(o => o.id === paymentIntentId)) {
      return res.json({ ok: true, orderNumber: orders.find(o => o.id === paymentIntentId).orderNumber });
    }

    const orderNumber = `D10-${Date.now().toString(36).toUpperCase()}`;
    const order = {
      id:          paymentIntentId,
      orderNumber,
      date:        new Date().toISOString(),
      customer:    { name, email, postal },
      items:       cart || [],
      total:       parseFloat(total) || 0,
      shipping: {
        method: shippingMethod || 'unknown',
        cost:   parseFloat(shippingCost) || 0,
        label:  shippingMethod === 'pickup' ? 'Pickup — Moncton, NB' : 'Canada Post'
      },
      status:      'pending',   // pending | shipped | delivered | cancelled
      tracking:    null,
      carrier:     null,
      shippedAt:   null,
      deliveredAt: null,
      notes:       ''
    };

    orders.unshift(order);
    saveOrders(orders);
    console.log(`[Order] Saved ${orderNumber} for ${email} — $${order.total.toFixed(2)} CAD`);

    // Send invoice email (non-blocking — don't fail the response if email fails)
    sendInvoiceEmail(order).catch(e => console.error('[Email error]', e.message));

    res.json({ ok: true, orderNumber });
  } catch (err) {
    console.error('[Order confirm error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Login ────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const pwd = process.env.ADMIN_PASSWORD;
  if (pwd && password === pwd) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Incorrect password.' });
  }
});

// ── Admin: Stats ────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const orders = loadOrders();
  res.json({
    totalOrders:   orders.length,
    totalRevenue:  orders.reduce((s, o) => s + (o.total || 0), 0),
    pending:       orders.filter(o => o.status === 'pending').length,
    shipped:       orders.filter(o => o.status === 'shipped').length,
    delivered:     orders.filter(o => o.status === 'delivered').length,
    cancelled:     orders.filter(o => o.status === 'cancelled').length
  });
});

// ── Admin: Orders List ──────────────────────
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  let orders = loadOrders();
  const { status, search } = req.query;
  if (status && status !== 'all') orders = orders.filter(o => o.status === status);
  if (search) {
    const q = search.toLowerCase();
    orders = orders.filter(o =>
      o.customer?.name?.toLowerCase().includes(q) ||
      o.customer?.email?.toLowerCase().includes(q) ||
      o.orderNumber?.toLowerCase().includes(q)
    );
  }
  res.json(orders);
});

// ── Admin: Update Order ─────────────────────
app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found.' });

  const updates = req.body;
  if (updates.status === 'shipped' && !orders[idx].shippedAt) {
    updates.shippedAt = new Date().toISOString();
  }
  if (updates.status === 'delivered' && !orders[idx].deliveredAt) {
    updates.deliveredAt = new Date().toISOString();
  }
  orders[idx] = { ...orders[idx], ...updates };
  saveOrders(orders);
  console.log(`[Admin] Order ${orders[idx].orderNumber} updated → status: ${orders[idx].status}`);

  // Send shipping update email only for physical orders
  if (orders[idx].type !== 'esim') {
    sendShippingEmail(orders[idx]).catch(e => console.error('[Shipping email]', e.message));
  }

  res.json(orders[idx]);
});

// ── Admin: Delete Order ─────────────────────
app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  let orders = loadOrders();
  if (!orders.find(o => o.id === req.params.id)) return res.status(404).json({ error: 'Not found.' });
  orders = orders.filter(o => o.id !== req.params.id);
  saveOrders(orders);
  res.json({ ok: true });
});

// ── Admin: Resend Invoice ───────────────────
app.post('/api/admin/orders/:id/resend-invoice', requireAdmin, async (req, res) => {
  const orders = loadOrders();
  const order  = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  try {
    await sendInvoiceEmail(order);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: eSIM API Debug ───────────────────
app.post('/api/admin/esim/debug-order', requireAdmin, async (req, res) => {
  const { esimOrderNo, transactionId } = req.body;
  if (!esimOrderNo) return res.status(400).json({ error: 'esimOrderNo required' });

  async function hit(endpoint, body) {
    try {
      const r = await fetch(`${ESIM_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'RT-AccessCode': process.env.ESIM_ACCESS_CODE, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: r.status, body: await r.json() };
    } catch (e) {
      return { error: e.message };
    }
  }

  const pager = { pageNum: 1, pageSize: 50 };
  const results = await Promise.all([
    hit('/esim/query', { orderNo: esimOrderNo, pager }).then(r => ({ label: '/esim/query {orderNo+pager}', ...r })),
    hit('/esim/query', { iccid: esimOrderNo,   pager }).then(r => ({ label: '/esim/query {iccid+pager}', ...r })),
    ...(transactionId ? [
      hit('/esim/query', { esimTranNo: transactionId, pager }).then(r => ({ label: '/esim/query {esimTranNo+pager}', ...r })),
    ] : []),
  ]);

  res.json({ results });
});

// ── Admin: Resend eSIM Instructions ────────
app.post('/api/admin/orders/:id/resend-esim', requireAdmin, async (req, res) => {
  const orders = loadOrders();
  const idx    = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found.' });
  if (orders[idx].type !== 'esim') return res.status(400).json({ error: 'Not an eSIM order.' });

  // Admin may supply a manual order number to override the missing one
  const manualOrderNo = (req.body.esimOrderNo || '').trim();
  if (manualOrderNo && !orders[idx].esimOrderNo) {
    orders[idx].esimOrderNo = manualOrderNo;
    saveOrders(orders);
    console.log(`[eSIM] Admin manually set esimOrderNo: ${manualOrderNo}`);
  }

  const order = orders[idx];

  try {
    // If LPA already saved, regenerate QR and resend immediately
    if (order.esimLPA) {
      const qrDataUrl = await QRCode.toDataURL(order.esimLPA, {
        width: 320, margin: 2, color: { dark: '#000000', light: '#ffffff' }
      });
      await sendEsimEmail(order, qrDataUrl, order.esimLPA, order.esimMeta || {});
      return res.json({ ok: true, source: 'cached' });
    }

    if (!order.esimOrderNo) {
      return res.status(400).json({
        error: 'No provider order number on record. Please enter it manually in the field above and try again.'
      });
    }

    const result   = await esimCall('/esim/query', {
      orderNo: order.esimOrderNo,
      pager: { pageNum: 1, pageSize: 50 }
    });
    console.log('[eSIM resend] Query result:', JSON.stringify(result).slice(0, 600));
    const esimList = result.esimList || [];

    for (const esim of esimList) {
      // ac is the full LPA string from the API; fall back to constructing it
      const ac    = esim.ac || '';
      const qrUrl = esim.qrCodeUrl || '';
      let lpa = null, qrDataUrl = null;

      if (ac.startsWith('LPA:')) {
        lpa = ac;
        qrDataUrl = await QRCode.toDataURL(lpa, { width: 320, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
      } else if (qrUrl) {
        lpa = qrUrl;
        qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 320, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
      }

      if (!qrDataUrl) {
        console.log('[eSIM resend] Entry has no usable profile data:', JSON.stringify(esim).slice(0, 200));
        continue;
      }

      const esimMeta = {
        esimTranNo: esim.esimTranNo || '',
        iccid:      esim.iccid      || '',
        imsi:       esim.imsi       || '',
        qrCodeUrl:  esim.qrCodeUrl  || '',
        esimStatus: esim.esimStatus || '',
        smdpStatus: esim.smdpStatus || ''
      };

      await sendEsimEmail(order, qrDataUrl, lpa, esimMeta);

      orders[idx].esimLPA       = lpa;
      orders[idx].esimMeta      = esimMeta;
      orders[idx].esimDelivered = true;
      orders[idx].status        = 'delivered';
      orders[idx].deliveredAt   = orders[idx].deliveredAt || new Date().toISOString();
      saveOrders(orders);
      return res.json({ ok: true, source: 'provider' });
    }

    // Log full result so admin can debug
    console.log('[eSIM resend] Full result (no profile found):', JSON.stringify(result));
    res.status(400).json({ error: 'eSIM profile not yet available from provider. Check the server console for the API response.' });
  } catch (err) {
    console.error('[resend-esim]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Export CSV ───────────────────────
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const orders = loadOrders();
  const header = 'Order #,Date,Customer,Email,Postal,Items,Total (CAD),Status,Tracking,Carrier\n';
  const rows = orders.map(o => [
    o.orderNumber,
    new Date(o.date).toLocaleDateString('en-CA'),
    `"${o.customer?.name || ''}"`,
    o.customer?.email || '',
    o.customer?.postal || '',
    `"${(o.items || []).map(i => `${i.name} x${i.qty}`).join('; ')}"`,
    (o.total || 0).toFixed(2),
    o.status,
    o.tracking || '',
    o.carrier  || ''
  ].join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="digital10-orders-${Date.now()}.csv"`);
  res.send(header + rows);
});

// ── Admin Page ──────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── Stripe Webhook ──────────────────────────
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.sendStatus(200);

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    console.log(`[Webhook] ✅ Payment confirmed: ${pi.id} — $${(pi.amount/100).toFixed(2)} CAD`);
  }

  res.sendStatus(200);
});

// ═══════════════════════════════════════════════
//  INVENTORY MANAGEMENT
// ═══════════════════════════════════════════════

const INVENTORY_FILE = path.join(__dirname, 'data/inventory.json');
function readInventory() { return JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8')); }
function writeInventory(data) { fs.writeFileSync(INVENTORY_FILE, JSON.stringify(data, null, 2)); }

// Public — shop frontend fetches prices/images from here
app.get('/api/inventory', (req, res) => {
  try { res.json(readInventory()); }
  catch { res.status(500).json({ error: 'Could not load inventory.' }); }
});

app.get('/api/admin/inventory', requireAdmin, (req, res) => {
  try { res.json(readInventory()); }
  catch { res.status(500).json({ error: 'Could not load inventory.' }); }
});

app.patch('/api/admin/inventory/:id', requireAdmin, (req, res) => {
  try {
    const inv = readInventory();
    const idx = inv.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Product not found.' });
    const { price, qty, image, featured } = req.body;
    if (price    !== undefined) inv[idx].price    = Math.round(parseFloat(price) * 100) / 100;
    if (qty      !== undefined) inv[idx].qty      = Math.max(0, parseInt(qty) || 0);
    if (image    !== undefined) inv[idx].image    = image;
    if (featured !== undefined) inv[idx].featured = !!featured;
    writeInventory(inv);
    console.log(`[Inventory] Product #${req.params.id} (${inv[idx].name}) updated`);
    res.json(inv[idx]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/inventory/images', requireAdmin, (req, res) => {
  const imgDir = path.join(__dirname, 'images/Products');
  function walk(dir, base) {
    const out = [];
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
        else if (/\.(jpe?g|png|gif|webp)$/i.test(e.name)) out.push(`/images/Products/${rel}`);
      }
    } catch {}
    return out;
  }
  res.json(walk(imgDir, ''));
});

app.post('/api/admin/inventory/upload-image', requireAdmin, (req, res) => {
  upload.array('images', 20)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded.' });
    const urls = req.files.map(f => `/images/Products/${f.filename}`);
    console.log(`[Inventory] Uploaded ${urls.length} image(s)`);
    res.json({ urls });
  });
});

// ═══════════════════════════════════════════════
//  eSIM ACCESS INTEGRATION
// ═══════════════════════════════════════════════

const ESIM_BASE = 'https://api.esimaccess.com/api/v1/open';

// In-memory package cache (1 hour TTL)
let _pkgCache = null;
let _pkgCacheAt = 0;
const PKG_CACHE_TTL = 60 * 60 * 1000;

// Live USD → CAD exchange rate cache (1 hour TTL)
let _cadRate    = null;
let _cadRateAt  = 0;

async function getCadRate() {
  if (_cadRate && Date.now() - _cadRateAt < PKG_CACHE_TTL) return _cadRate;
  try {
    const r    = await fetch('https://api.frankfurter.app/latest?from=USD&to=CAD');
    const data = await r.json();
    _cadRate   = data.rates?.CAD || 1.38;
    _cadRateAt = Date.now();
    console.log(`[Rate] USD→CAD: ${_cadRate}`);
  } catch (e) {
    console.error('[Rate] Fetch failed, using fallback:', e.message);
    _cadRate = _cadRate || 1.38;
  }
  return _cadRate;
}

async function esimCall(endpoint, body = {}) {
  const res = await fetch(`${ESIM_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'RT-AccessCode': process.env.ESIM_ACCESS_CODE,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`eSIM API HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`eSIM API error: ${data.errorCode}${data.errorMsg ? ' — ' + data.errorMsg : ''}`);
  return data.obj;
}

async function getPackages() {
  if (_pkgCache && Date.now() - _pkgCacheAt < PKG_CACHE_TTL) return _pkgCache;
  const obj = await esimCall('/package/list', {});
  _pkgCache = obj.packageList || [];
  _pkgCacheAt = Date.now();
  console.log(`[eSIM] Package cache refreshed — ${_pkgCache.length} packages`);
  return _pkgCache;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes >= 1073741824) return `${(bytes / 1073741824 % 1 === 0 ? bytes / 1073741824 : (bytes / 1073741824).toFixed(1))}GB`;
  if (bytes >= 1048576) return `${Math.round(bytes / 1048576)}MB`;
  return `${bytes}B`;
}

function extractDataFromName(name) {
  const m = name.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i);
  return m ? `${m[1]}${m[2].toUpperCase()}` : null;
}

function getDataDisplay(pkg) {
  if (pkg.dataType === 1 && pkg.data > 0) return 'Unlimited';
  const fromBytes = formatBytes(pkg.data);
  if (fromBytes) return fromBytes;
  return extractDataFromName(pkg.name) || 'See plan';
}

// Returns numeric GB value for filtering (null = unknown, -1 = unlimited)
function parseDataGB(dataStr) {
  if (!dataStr || dataStr === 'See plan') return null;
  if (dataStr === 'Unlimited') return -1;
  const m = dataStr.match(/^(\d+(?:\.\d+)?)(GB|MB|TB)$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  if (u === 'MB') return v / 1024;
  if (u === 'TB') return v * 1024;
  return v;
}

function isoToFlag(code) {
  if (!code || code.length !== 2) return '🌍';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => c.charCodeAt(0) + 0x1F1A5));
}

function markupPrice(costUnits) {
  const costUSD = (costUnits || 0) / 10000;
  const markup  = parseFloat(process.env.ESIM_MARKUP || '1.60');
  const price   = Math.ceil(costUSD * markup * 100) / 100;
  return Math.max(price, 1.00); // minimum $1.00 USD
}

// ── GET /api/esim/rate ──────────────────────
app.get('/api/esim/rate', async (req, res) => {
  try {
    const rate = await getCadRate();
    res.json({ ok: true, cadRate: rate, updatedAt: new Date(_cadRateAt).toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/esim/packages ──────────────────
app.get('/api/esim/packages', async (req, res) => {
  try {
    if (!process.env.ESIM_ACCESS_CODE) {
      return res.status(503).json({ error: 'eSIM service not configured.' });
    }
    const [packages, cadRate] = await Promise.all([getPackages(), getCadRate()]);
    const formatted = packages.map(pkg => {
      const locations = pkg.locationNetworkList || [];
      const primary   = locations[0] || {};
      const locCode   = primary.locationCode || '';
      const isMulti   = locations.length > 1;
      const dataStr   = getDataDisplay(pkg);

      return {
        packageCode:   pkg.packageCode,
        name:          pkg.name,
        locationCode:  locCode,
        locationName:  isMulti ? (pkg.name || 'Multi-Country') : (primary.locationName || pkg.name),
        locations:     locations.map(l => ({ code: l.locationCode, name: l.locationName })),
        flag:          isMulti ? '🌍' : isoToFlag(locCode),
        isMulti,
        data:          dataStr,
        dataGB:        parseDataGB(dataStr),  // numeric GB for filtering
        dataType:      pkg.dataType,
        duration:      pkg.duration,
        isDaily:       pkg.duration === 1 || pkg.dataType === 4,
        speed:         pkg.speed || '4G/LTE',
        salePriceUSD:  markupPrice(pkg.price),
        slug:          pkg.slug || ''
      };
    });
    res.json({ ok: true, packages: formatted, cadRate, rateUpdatedAt: new Date(_cadRateAt).toISOString() });
  } catch (err) {
    console.error('[eSIM] Package list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/esim/create-payment-intent ────
app.post('/api/esim/create-payment-intent', async (req, res) => {
  try {
    const { packageCode, email, name, periodNum } = req.body;
    if (!packageCode || !email || !name) {
      return res.status(400).json({ error: 'packageCode, email and name are required.' });
    }

    const packages = await getPackages();
    const pkg = packages.find(p => p.packageCode === packageCode);
    if (!pkg) return res.status(404).json({ error: 'Package not found.' });

    const isDaily    = pkg.duration === 1 || pkg.dataType === 4;
    const days       = isDaily ? Math.min(Math.max(1, parseInt(periodNum) || 1), 365) : 1;
    const pricePerDay = markupPrice(pkg.price);
    const salePrice  = Math.ceil(pricePerDay * days * 100) / 100;
    const amountCents = Math.round(salePrice * 100);
    if (amountCents < 50) return res.status(400).json({ error: 'Amount too low.' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount:        amountCents,
      currency:      'usd',
      receipt_email: email,
      description:   `Digital10 eSIM — ${pkg.name}${days > 1 ? ` × ${days} days` : ''}`,
      metadata: {
        type:          'esim',
        customer_name: name,
        package_code:  packageCode,
        package_name:  pkg.name,
        period_num:    String(days)
      }
    });

    console.log(`[eSIM Stripe] PaymentIntent ${paymentIntent.id} — $${salePrice} USD (${days}d) for ${email}`);
    res.json({ clientSecret: paymentIntent.client_secret, amount: salePrice, packageName: pkg.name, days });

  } catch (err) {
    console.error('[eSIM payment error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/esim/confirm ──────────────────
app.post('/api/esim/confirm', async (req, res) => {
  try {
    const { paymentIntentId, packageCode, email, name, packageName, amount, periodNum, postal } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'Missing paymentIntentId.' });

    // Verify payment actually succeeded with Stripe
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment not confirmed. Please complete payment first.' });
    }

    // Idempotency check
    const orders = loadOrders();
    const existing = orders.find(o => o.id === paymentIntentId);
    if (existing) return res.json({ ok: true, orderNumber: existing.orderNumber });

    const orderNumber   = `D10-E-${Date.now().toString(36).toUpperCase()}`;
    // Alphanumeric-only transactionId (some APIs reject hyphens)
    const transactionId = `D10${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    let esimOrderNo     = null;
    let esimPlaceError  = null;

    // Place order with eSIM provider — try packageInfoList format first, then flat format
    const packages      = await getPackages();
    const rawPkg        = packages.find(p => p.packageCode === packageCode);
    const rawPrice      = rawPkg?.price || 0;

    // eSIM Access API requires packageInfoList format
    const isDaily = rawPkg?.duration === 1 || rawPkg?.dataType === 4;
    const days    = isDaily ? Math.min(Math.max(1, parseInt(periodNum) || 1), 365) : 1;
    const pkgEntry = { packageCode, count: 1, price: rawPrice };
    if (days > 1) pkgEntry.periodNum = days;

    try {
      const esimResult = await esimCall('/esim/order', {
        transactionId,
        packageInfoList: [pkgEntry]
      });
      console.log('[eSIM] Order API response:', JSON.stringify(esimResult));
      esimOrderNo    = esimResult.orderNo || esimResult.orderId || null;
      esimPlaceError = null;
      console.log(`[eSIM] Provider order placed: ${esimOrderNo}`);
    } catch (e) {
      esimPlaceError = e.message;
      console.error('[eSIM] Provider order failed:', e.message);
    }

    const order = {
      id:              paymentIntentId,
      orderNumber,
      type:            'esim',
      date:            new Date().toISOString(),
      customer:        { name, email, ...(postal ? { postal } : {}) },
      items:           [{ name: packageName || packageCode, qty: 1, price: parseFloat(amount) || 0 }],
      total:           parseFloat(amount) || 0,
      status:          'pending',
      esimOrderNo,
      esimPackageCode: packageCode,
      esimTransactionId: transactionId,
      esimPlaceError:  esimPlaceError || null,
      esimDelivered:   false,
      tracking:        null,
      carrier:         null,
      notes:           ''
    };

    orders.unshift(order);
    saveOrders(orders);
    console.log(`[eSIM Order] Saved ${orderNumber} for ${email}`);

    // Send order confirmation invoice immediately (non-blocking)
    sendInvoiceEmail(order).catch(e => console.error('[eSIM invoice email]', e.message));

    // Respond immediately — send QR in background
    res.json({ ok: true, orderNumber });

    if (esimOrderNo) {
      pollForEsim(esimOrderNo, order).catch(e =>
        console.error('[eSIM poll error]', e.message)
      );
    }

  } catch (err) {
    console.error('[eSIM confirm error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Background poll for eSIM profile ────────
async function pollForEsim(esimOrderNo, orderData) {
  const MAX  = 24;
  const WAIT = 5000;

  for (let i = 1; i <= MAX; i++) {
    await new Promise(r => setTimeout(r, WAIT));
    try {
      const result = await esimCall('/esim/query', {
        orderNo: esimOrderNo,
        pager: { pageNum: 1, pageSize: 50 }
      });
      console.log(`[eSIM poll ${i}/${MAX}] raw:`, JSON.stringify(result).slice(0, 400));

      const esimList = result.esimList || [];

      for (const esim of esimList) {
        // ac is the full LPA string from the API; fall back to qrCodeUrl
        const ac    = esim.ac || '';
        const qrUrl = esim.qrCodeUrl || '';

        let lpa = null, qrDataUrl = null;

        if (ac.startsWith('LPA:')) {
          lpa = ac;
          qrDataUrl = await QRCode.toDataURL(lpa, {
            width: 320, margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
          });
        } else if (qrUrl) {
          lpa = qrUrl;
          qrDataUrl = await QRCode.toDataURL(qrUrl, {
            width: 320, margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
          });
        }

        if (!qrDataUrl) {
          console.log(`[eSIM poll ${i}] esim entry has no usable profile yet:`, JSON.stringify(esim).slice(0, 200));
          continue;
        }

        const esimMeta = {
          esimTranNo: esim.esimTranNo || '',
          iccid:      esim.iccid      || '',
          imsi:       esim.imsi       || '',
          qrCodeUrl:  esim.qrCodeUrl  || '',
          esimStatus: esim.esimStatus || '',
          smdpStatus: esim.smdpStatus || ''
        };

        console.log(`[eSIM] ✅ Profile ready (attempt ${i}): ${lpa}`);
        await sendEsimEmail(orderData, qrDataUrl, lpa, esimMeta);

        const orders = loadOrders();
        const idx = orders.findIndex(o => o.id === orderData.id);
        if (idx !== -1) {
          orders[idx].status        = 'delivered';
          orders[idx].esimDelivered = true;
          orders[idx].esimLPA       = lpa;
          orders[idx].esimMeta      = esimMeta;
          orders[idx].deliveredAt   = new Date().toISOString();
          saveOrders(orders);
        }
        return;
      }

      if (esimList.length === 0) {
        console.log(`[eSIM poll ${i}] esimList empty`);
      }
    } catch (e) {
      console.error(`[eSIM poll ${i}]`, e.message);
    }
  }
  console.error(`[eSIM] Gave up after ${MAX} attempts — order ${esimOrderNo}`);
}

// ── eSIM QR Code Email ───────────────────────
// esimData: the eSIM object from the API (esimTranNo, iccid, imsi, qrCodeUrl, esimStatus, etc.)
async function sendEsimEmail(order, qrDataUrl, lpa, esimData = {}) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const firstName   = (order.customer?.name || 'Customer').split(' ')[0];
  const packageItem = (order.items || [])[0] || {};
  const dateStr     = new Date(order.date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const qrBase64    = qrDataUrl.replace(/^data:image\/png;base64,/, '');

  // Parse LPA parts: LPA:1$smdpAddress$matchingId
  const lpaParts   = (lpa || '').replace(/^LPA:1\$/, '').split('$');
  const smdpAddr   = lpaParts[0] || '';
  const matchingId = lpaParts[1] || '';
  const iosLink    = lpa ? `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpa)}` : '';
  const androidLink= lpa ? `https://esimsetup.android.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpa)}` : '';

  // Merge esimData with anything saved on the order
  const ed = Object.assign({}, order.esimMeta || {}, esimData);

  function infoRow(label, value, mono = false) {
    if (!value) return '';
    return `<tr>
      <td style="padding:7px 0;font-weight:600;color:#555;font-size:13px;white-space:nowrap;width:44%;">${label}</td>
      <td style="padding:7px 0;text-align:right;font-size:13px;color:#222;${mono ? 'font-family:monospace;word-break:break-all;' : ''}">${value}</td>
    </tr>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your eSIM — ${order.orderNumber}</title></head>
<body style="margin:0;padding:20px;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;">

  <!-- Header -->
  <div style="background:#07111f;border-radius:12px 12px 0 0;">${EMAIL_LOGO_HTML}</div>

  <!-- Hero -->
  <div style="background:#0f1f35;padding:32px;text-align:center;border-bottom:1px solid #1e3a5f;">
    <div style="font-size:52px;">📶</div>
    <h2 style="color:#e2eaf4;margin:14px 0 8px;font-size:22px;">Your eSIM is Ready!</h2>
    <p style="color:#7a9bbf;margin:0;font-size:15px;">Hi ${firstName}, your eSIM has been activated. Scan the QR code below to get connected.</p>
  </div>

  <!-- Order Info -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #eee;">
    <table style="width:100%;font-size:13px;color:#555;">
      ${infoRow('Order Number', `<span style="font-family:monospace;font-weight:700;color:#2f80ed;">${order.orderNumber}</span>`)}
      ${infoRow('Date', dateStr)}
      ${infoRow('Plan', `<strong>${packageItem.name || ''}</strong>`)}
      ${infoRow('Amount Paid', `<strong style="color:#2f80ed;">$${(order.total || 0).toFixed(2)} USD</strong>`)}
    </table>
  </div>

  <!-- QR Code -->
  <div style="background:#fff;padding:32px;text-align:center;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:20px;">Scan to Install eSIM</div>
    <img src="cid:esim-qr" alt="eSIM QR Code" width="220" style="display:block;margin:0 auto;border-radius:12px;border:3px solid #e8f0fe;">
    <p style="color:#888;font-size:12px;margin:16px 0 0;">Go to <strong>Settings → Cellular → Add eSIM → Use QR Code</strong> on your iPhone,<br>or <strong>Settings → Connections → SIM Manager → Add eSIM</strong> on Android.</p>
  </div>

  <!-- Activation Details -->
  <div style="background:#f8f9fb;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:14px;">eSIM Activation Details</div>
    <table style="width:100%;">
      ${infoRow('Activation Code (LPA)', lpa, true)}
      ${smdpAddr   ? infoRow('SM-DP+ Address', smdpAddr, true) : ''}
      ${matchingId ? infoRow('Matching ID', matchingId, true) : ''}
      ${ed.qrCodeUrl ? infoRow('QR Code URL', `<a href="${ed.qrCodeUrl}" style="color:#2f80ed;">${ed.qrCodeUrl}</a>`) : ''}
    </table>
  </div>

  <!-- Universal Links -->
  ${(iosLink || androidLink) ? `
  <div style="background:#fff;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:14px;">One-Tap Install Links</div>
    ${iosLink ? `<a href="${iosLink}" style="display:block;margin-bottom:10px;padding:12px 18px;background:#000;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;text-align:center;">🍎 Install on iPhone (iOS)</a>` : ''}
    ${androidLink ? `<a href="${androidLink}" style="display:block;padding:12px 18px;background:#34a853;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;text-align:center;">🤖 Install on Android</a>` : ''}
  </div>` : ''}

  <!-- Technical Info -->
  ${(ed.esimTranNo || ed.iccid || ed.imsi || order.esimOrderNo) ? `
  <div style="background:#f8f9fb;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:14px;">Technical Information</div>
    <table style="width:100%;">
      ${infoRow('Create Time', order.date ? new Date(order.date).toISOString().slice(0,16).replace('T',' ') : '')}
      ${infoRow('Provider Order No', order.esimOrderNo, true)}
      ${infoRow('eSIM Tran No', ed.esimTranNo, true)}
      ${infoRow('ICCID', ed.iccid, true)}
      ${infoRow('IMSI', ed.imsi, true)}
      ${infoRow('eSIM Status', ed.esimStatus || '')}
    </table>
  </div>` : ''}

  <!-- Tips -->
  <div style="background:#fff;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:12px;">Quick Tips</div>
    <div style="font-size:13px;color:#555;line-height:1.7;">
      ✅ <strong>Scan only once</strong> — eSIM QR codes are single-use.<br>
      ✅ <strong>Keep your home SIM active</strong> — this eSIM is for data only.<br>
      ✅ <strong>Enable data roaming</strong> once in your destination country.<br>
      ✅ <strong>Check compatibility</strong> — your device must support eSIM.
    </div>
  </div>

  <!-- Security note -->
  <div style="background:#fff;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="background:#f0f7ff;border:1px solid #cce0ff;border-radius:8px;padding:14px 16px;font-size:13px;color:#444;line-height:1.5;">
      🔒 <strong>Your payment was processed securely by Stripe.</strong> Your card details are never stored on Digital10 servers.
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#07111f;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;">
    <p style="color:#7a9bbf;font-size:13px;margin:0 0 6px;">Questions? Reply to this email — we're happy to help.</p>
    <p style="color:#4a6a8a;font-size:12px;margin:0;">Digital10 · Canada &nbsp;·&nbsp; Payment ID: <span style="font-family:monospace;">${order.id?.slice(-12) || ''}</span></p>
  </div>

</div>
</body></html>`;

  await transporter.sendMail({
    from:    `"Digital10" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to:      order.customer?.email,
    subject: `📶 Your eSIM is Ready — ${order.orderNumber}`,
    html,
    attachments: [{
      filename: 'esim-qr-code.png',
      content:  qrBase64,
      encoding: 'base64',
      cid:      'esim-qr'
    }]
  });

  console.log(`[eSIM Email] QR code sent to ${order.customer?.email} — ${order.orderNumber}`);
}

// ── Catch-all ───────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Invoice Email ────────────────────────────
async function sendInvoiceEmail(order) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[Email] SMTP not configured — skipping. Add SMTP_USER & SMTP_PASS to .env');
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const isEsim    = order.type === 'esim';
  const currency  = isEsim ? 'USD' : 'CAD';

  const itemRows = (order.items || []).map(item => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${item.name}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#555;text-align:center;">${item.qty}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#555;text-align:right;">$${parseFloat(item.price).toFixed(2)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:700;color:#07111f;text-align:right;">$${(item.price * item.qty).toFixed(2)}</td>
    </tr>`).join('');

  const firstName = (order.customer?.name || 'Customer').split(' ')[0];
  const dateStr   = new Date(order.date).toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order ${order.orderNumber}</title></head>
<body style="margin:0;padding:20px;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;">

  <!-- Header / Logo -->
  <div style="background:#07111f;border-radius:12px 12px 0 0;">
    ${EMAIL_LOGO_HTML}
  </div>

  <!-- Hero -->
  <div style="background:#0f1f35;padding:28px 32px;text-align:center;border-bottom:1px solid #1e3a5f;">
    <div style="font-size:44px;">✅</div>
    <h2 style="color:#e2eaf4;margin:12px 0 6px;font-size:22px;">Order Confirmed!</h2>
    <p style="color:#7a9bbf;margin:0;font-size:15px;">Thanks ${firstName}, your order is on its way to being processed.</p>
  </div>

  <!-- Order Info -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #eee;">
    <table style="width:100%;font-size:13px;color:#555;">
      <tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Order Number</td>
        <td style="text-align:right;font-family:monospace;font-weight:700;color:#2f80ed;font-size:15px;">${order.orderNumber}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Date</td>
        <td style="text-align:right;">${dateStr}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Customer</td>
        <td style="text-align:right;">${order.customer?.name || ''}</td>
      </tr>
      ${!isEsim ? `<tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Postal Code</td>
        <td style="text-align:right;">${order.customer?.postal || '—'}</td>
      </tr>` : `<tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Delivery</td>
        <td style="text-align:right;color:#22c55e;font-weight:700;">📶 Digital — QR code by email</td>
      </tr>`}
    </table>
  </div>

  <!-- Items -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:12px;">Items Ordered</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f8f8f8;">
        <th style="padding:10px 16px;text-align:left;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
        <th style="padding:10px 16px;text-align:center;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
        <th style="padding:10px 16px;text-align:right;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;">Price</th>
        <th style="padding:10px 16px;text-align:right;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;">Subtotal</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="padding:16px;text-align:right;font-weight:700;color:#333;font-size:15px;">Total</td>
        <td style="padding:16px;text-align:right;font-weight:800;color:#2f80ed;font-size:20px;">$${(order.total || 0).toFixed(2)} ${currency}</td>
      </tr></tfoot>
    </table>
  </div>

  <!-- Shipping Info (shown only if tracking exists) -->
  ${order.tracking ? `
  <div style="background:#fff;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:12px;">Shipping</div>
    <table style="width:100%;font-size:13px;color:#555;">
      <tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Status</td>
        <td style="text-align:right;font-weight:700;color:${order.status==='delivered'?'#22c55e':order.status==='shipped'?'#00b4d8':'#f59e0b'};text-transform:capitalize;">${order.status}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Carrier</td>
        <td style="text-align:right;">${order.carrier || '—'}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-weight:600;color:#333;">Tracking #</td>
        <td style="text-align:right;font-family:monospace;font-weight:700;color:#2f80ed;">${order.tracking}</td>
      </tr>
    </table>
    ${trackingLink(order) ? `<div style="text-align:center;margin-top:14px;"><a href="${trackingLink(order)}" style="display:inline-block;padding:10px 24px;background:#2f80ed;color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;">Track My Package →</a></div>` : ''}
  </div>` : ''}

  <!-- Security Note -->
  <div style="background:#fff;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="background:#f0f7ff;border:1px solid #cce0ff;border-radius:8px;padding:14px 16px;font-size:13px;color:#444;line-height:1.5;">
      🔒 <strong>Your payment was processed securely by Stripe</strong> — a PCI DSS Level 1 certified payment processor.
      Your card details are encrypted end-to-end and are never stored on our servers.
      The Stripe name will appear on your bank statement.
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#07111f;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;">
    <p style="color:#7a9bbf;font-size:13px;margin:0 0 6px;">Questions? Reply to this email — we're happy to help.</p>
    <p style="color:#4a6a8a;font-size:12px;margin:0;">Digital10 · Canada &nbsp;·&nbsp; Payment ID: <span style="font-family:monospace;">${order.id?.slice(-12) || ''}</span></p>
  </div>

</div>
</body></html>`;

  await transporter.sendMail({
    from:    `"Digital10" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to:      order.customer?.email,
    subject: `✅ Order Confirmed — ${order.orderNumber}`,
    html
  });

  console.log(`[Email] Invoice sent to ${order.customer?.email} — ${order.orderNumber}`);
}

// ── Email logo HTML ──────────────────────────
// Once digital10.ca is live, replace the text logo below with:
// <img src="https://digital10.ca/images/logo/logo_principal_semfundo_versao1-1536x922.png"
//      alt="Digital10" width="200" style="display:block;margin:0 auto;">
const EMAIL_LOGO_HTML = `
  <div style="text-align:center;padding:28px 32px 20px;">
    <div style="display:inline-block;background:linear-gradient(135deg,#0d1f38,#0a1929);border:1px solid rgba(47,128,237,0.35);border-radius:16px;padding:18px 36px;">
      <div style="font-size:36px;font-weight:900;color:#2f80ed;letter-spacing:-1.5px;line-height:1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        Digital<span style="color:#00b4d8;">10</span>
      </div>
      <div style="font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#4a7aa8;margin-top:5px;">
        Electronics · Hosting · eSIM
      </div>
    </div>
  </div>`;

// ── Tracking URL helper ──────────────────────
function trackingLink(order) {
  if (!order.tracking) return null;
  const t = encodeURIComponent(order.tracking);
  const links = {
    'Canada Post': `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${t}`,
    'Purolator':   `https://www.purolator.com/en/shipping/tracker?pin=${t}`,
    'UPS':         `https://www.ups.com/track?tracknum=${t}`,
    'FedEx':       `https://www.fedex.com/fedextrack/?trknbr=${t}`,
    'DHL':         `https://www.dhl.com/en/express/tracking.html?AWB=${t}`,
  };
  return links[order.carrier] || null;
}

// ── Shipping Update Email ────────────────────
async function sendShippingEmail(order) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  if (!order.customer?.email) return;

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const firstName = (order.customer?.name || 'Customer').split(' ')[0];
  const statusLabels = {
    pending:   { icon: '📦', title: 'Order Update',       color: '#f59e0b', msg: 'Your order is being prepared.' },
    shipped:   { icon: '🚚', title: 'Your Order Shipped!', color: '#00b4d8', msg: 'Your order is on its way!' },
    delivered: { icon: '✅', title: 'Order Delivered!',    color: '#22c55e', msg: 'Your order has been delivered. Enjoy!' },
    cancelled: { icon: '❌', title: 'Order Cancelled',     color: '#ef4444', msg: 'Your order has been cancelled. Please contact us if you have questions.' },
  };
  const s = statusLabels[order.status] || statusLabels.pending;
  const link = trackingLink(order);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${s.title}</title></head>
<body style="margin:0;padding:20px;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;">

  <!-- Header / Logo -->
  <div style="background:#07111f;border-radius:12px 12px 0 0;">
    ${EMAIL_LOGO_HTML}
  </div>

  <!-- Hero -->
  <div style="background:#0f1f35;padding:32px;text-align:center;border-bottom:1px solid #1e3a5f;">
    <div style="font-size:52px;">${s.icon}</div>
    <h2 style="color:#e2eaf4;margin:14px 0 8px;font-size:22px;">${s.title}</h2>
    <p style="color:#7a9bbf;margin:0;font-size:15px;">Hi ${firstName}, ${s.msg}</p>
  </div>

  <!-- Order + Shipping Info -->
  <div style="background:#fff;padding:24px 32px;border-bottom:1px solid #eee;">
    <table style="width:100%;font-size:13px;color:#555;">
      <tr>
        <td style="padding:6px 0;font-weight:600;color:#333;">Order Number</td>
        <td style="text-align:right;font-family:monospace;font-weight:700;color:#2f80ed;">${order.orderNumber}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-weight:600;color:#333;">Status</td>
        <td style="text-align:right;font-weight:700;color:${s.color};text-transform:capitalize;">${order.status}</td>
      </tr>
      ${order.carrier ? `<tr>
        <td style="padding:6px 0;font-weight:600;color:#333;">Carrier</td>
        <td style="text-align:right;">${order.carrier}</td>
      </tr>` : ''}
      ${order.tracking ? `<tr>
        <td style="padding:6px 0;font-weight:600;color:#333;">Tracking #</td>
        <td style="text-align:right;font-family:monospace;font-weight:700;color:#2f80ed;">${order.tracking}</td>
      </tr>` : ''}
      ${order.shippedAt ? `<tr>
        <td style="padding:6px 0;font-weight:600;color:#333;">Shipped</td>
        <td style="text-align:right;">${new Date(order.shippedAt).toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' })}</td>
      </tr>` : ''}
    </table>

    ${link ? `
    <div style="text-align:center;margin-top:20px;">
      <a href="${link}" style="display:inline-block;padding:12px 32px;background:#2f80ed;color:#fff;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;">
        Track My Package →
      </a>
    </div>` : ''}
  </div>

  <!-- Items Summary -->
  <div style="background:#fff;padding:20px 32px;border-bottom:1px solid #eee;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#999;margin-bottom:10px;">Items in this order</div>
    ${(order.items || []).map(i => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:13px;">
        <span style="color:#333;">${i.name} <span style="color:#999;">×${i.qty}</span></span>
        <span style="font-weight:600;color:#333;">$${(i.price * i.qty).toFixed(2)}</span>
      </div>`).join('')}
    <div style="display:flex;justify-content:space-between;padding:12px 0 0;font-size:15px;font-weight:800;">
      <span style="color:#333;">Total</span>
      <span style="color:#2f80ed;">$${(order.total || 0).toFixed(2)} CAD</span>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#07111f;border-radius:0 0 12px 12px;padding:24px 32px;text-align:center;">
    <p style="color:#7a9bbf;font-size:13px;margin:0 0 6px;">Questions about your order? Reply to this email.</p>
    <p style="color:#4a6a8a;font-size:12px;margin:0;">Digital10 · Canada</p>
  </div>

</div>
</body></html>`;

  const subjectMap = {
    pending:   `📦 Order Update — ${order.orderNumber}`,
    shipped:   `🚚 Your Order is on the Way! — ${order.orderNumber}`,
    delivered: `✅ Order Delivered — ${order.orderNumber}`,
    cancelled: `❌ Order Cancelled — ${order.orderNumber}`,
  };

  await transporter.sendMail({
    from:    `"Digital10" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to:      order.customer.email,
    subject: subjectMap[order.status] || `Order Update — ${order.orderNumber}`,
    html
  });

  console.log(`[Email] Shipping update sent to ${order.customer.email} — ${order.orderNumber} (${order.status})`);
}

// ── Start ───────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║        DIGITAL10 SERVER RUNNING          ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Local:    http://localhost:${PORT}          ║`);
  console.log(`║  Network:  http://${ip}:${PORT}      ║`);
  console.log(`║  Admin:    http://localhost:${PORT}/admin    ║`);
  console.log(`║  Mode:     ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? '🟢 LIVE' : '🟡 Sandbox (test)'}                      ║`);
  console.log('╚══════════════════════════════════════════╝\n');
});

function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
