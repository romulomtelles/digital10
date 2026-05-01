/* ============================
   DIGITAL10 — Main JavaScript
   ============================ */

// ── STRIPE CONFIG ────────────────────────────────────────
const STRIPE_KEY = 
'pk_live_51SUXJDKIxVZUJGTSahIYUgaZUTbIXocb3UMChxShQmDMWNdwZCXHZMECc08ewgJ85k45W1N22ZQvWNW0PXthtnZ900xPY2RaIt';
let stripeInstance = null;
let stripeCard = null;
let selectedShipping = '';

function getStripe() {
  if (!stripeInstance) stripeInstance = Stripe(STRIPE_KEY);
  return stripeInstance;
}

// ── CART STATE ──────────────────────────────────────────
let cart = JSON.parse(localStorage.getItem('d10_cart') || '[]');

function saveCart() {
  localStorage.setItem('d10_cart', JSON.stringify(cart));
  updateCartUI();
}

function addToCart(product) {
  const existing = cart.find(i => i.id === product.id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  saveCart();
  showToast(`✓ ${product.name.substring(0, 32)}… added to cart`);
}

function removeFromCart(id) {
  cart = cart.filter(i => i.id !== id);
  saveCart();
}

function updateQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeFromCart(id);
  else saveCart();
}

function cartTotal() {
  return cart.reduce((s, i) => s + i.price * i.qty, 0);
}

function cartCount() {
  return cart.reduce((s, i) => s + i.qty, 0);
}

// ── CART UI ─────────────────────────────────────────────
function updateCartUI() {
  const countEl = document.getElementById('cart-count');
  if (countEl) {
    const n = cartCount();
    countEl.textContent = n;
    countEl.classList.toggle('hidden', n === 0);
  }
  renderCartDrawer();
}

function renderCartDrawer() {
  const itemsEl = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  if (!itemsEl) return;

  if (cart.length === 0) {
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <p>Your cart is empty</p>
        <a href="shop.html" class="btn btn-primary btn-sm" style="margin-top:16px">Browse Electronics</a>
      </div>`;
    if (totalEl) totalEl.textContent = '$0.00';
    return;
  }

  itemsEl.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img class="cart-item-img" src="${item.image}" alt="${item.name}"
           onerror="this.style.display='none'">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="updateQty(${item.id}, +1)">+</button>
        </div>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart(${item.id})" title="Remove">✕</button>
    </div>
  `).join('');

  if (totalEl) totalEl.textContent = `$${cartTotal().toFixed(2)}`;
}

// ── CART DRAWER TOGGLE ───────────────────────────────────
function openCart() {
  document.getElementById('cart-overlay')?.classList.add('open');
  document.getElementById('cart-drawer')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  document.getElementById('cart-overlay')?.classList.remove('open');
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── STRIPE CHECKOUT MODAL ────────────────────────────────
function injectCheckoutModal() {
  if (document.getElementById('stripe-checkout-modal')) return;
  const el = document.createElement('div');
  el.id = 'stripe-checkout-modal';
  el.innerHTML = `
    <div id="stripe-overlay" style="
      position:fixed;inset:0;background:rgba(0,0,0,0.78);
      backdrop-filter:blur(8px);z-index:5000;
      display:flex;align-items:center;justify-content:center;
      padding:20px;opacity:0;pointer-events:none;transition:opacity 0.3s;">
      <div id="stripe-box" style="
        background:#0f1f35;border:1px solid #1e3a5f;
        border-radius:22px;width:100%;max-width:520px;
        max-height:92vh;overflow-y:auto;
        transform:scale(0.96);transition:transform 0.3s;
        position:relative;">

        <!-- Header -->
        <div style="padding:24px 28px 16px;border-bottom:1px solid #1e3a5f;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2f80ed;margin-bottom:4px;">Secure Checkout</div>
            <div style="font-size:1.1rem;font-weight:700;">Complete your order</div>
          </div>
          <button onclick="closeCheckout()" style="
            width:34px;height:34px;border-radius:8px;
            background:#162840;border:1px solid #1e3a5f;
            color:#7a9bbf;font-size:1rem;cursor:pointer;
            display:flex;align-items:center;justify-content:center;">✕</button>
        </div>

        <!-- Order Summary -->
        <div id="stripe-summary" style="padding:20px 28px;border-bottom:1px solid #1e3a5f;"></div>

        <!-- Delivery Method -->
        <div id="stripe-shipping" style="padding:16px 28px;border-bottom:1px solid #1e3a5f;"></div>

        <!-- Payment Form -->
        <div id="stripe-payment-form" style="padding:24px 28px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
            <div style="grid-column:1/-1;">
              <label style="font-size:0.8rem;font-weight:600;color:#7a9bbf;display:block;margin-bottom:8px;">Full Name</label>
              <input id="stripe-name" type="text" placeholder="Jane Smith" style="
                width:100%;background:#162840;border:1.5px solid #1e3a5f;
                border-radius:10px;padding:11px 14px;color:#e2eaf4;
                font-size:0.9rem;font-family:inherit;transition:border-color 0.2s;box-sizing:border-box;">
            </div>
            <div style="grid-column:1/-1;">
              <label style="font-size:0.8rem;font-weight:600;color:#7a9bbf;display:block;margin-bottom:8px;">Email</label>
              <input id="stripe-email" type="email" placeholder="your@email.com" style="
                width:100%;background:#162840;border:1.5px solid #1e3a5f;
                border-radius:10px;padding:11px 14px;color:#e2eaf4;
                font-size:0.9rem;font-family:inherit;transition:border-color 0.2s;box-sizing:border-box;">
            </div>
          </div>
          <div style="margin-bottom:20px;">
            <label style="font-size:0.8rem;font-weight:600;color:#7a9bbf;display:block;margin-bottom:8px;">Card Number</label>
            <div id="stripe-card-element" style="
              background:#162840;border:1.5px solid #1e3a5f;
              border-radius:10px;padding:13px 14px;
              transition:border-color 0.2s;"></div>
            <div id="stripe-card-errors" style="color:#ef4444;font-size:0.8rem;margin-top:8px;min-height:18px;"></div>
          </div>
          <div style="margin-bottom:20px;">
            <label style="font-size:0.8rem;font-weight:600;color:#7a9bbf;display:block;margin-bottom:8px;">
              Postal / ZIP Code
              <span style="font-weight:400;color:#7a9bbf;font-size:0.72rem;"> — CA: K1A 0B1 &nbsp;·&nbsp; US: 90210</span>
            </label>
            <input id="stripe-postal" type="text" placeholder="e.g. K1A 0B1 or 90210" maxlength="10"
              autocomplete="postal-code" style="
              width:100%;background:#162840;border:1.5px solid #1e3a5f;
              border-radius:10px;padding:11px 14px;color:#e2eaf4;
              font-size:0.9rem;font-family:inherit;transition:border-color 0.2s;
              box-sizing:border-box;text-transform:uppercase;">
          </div>

          <!-- Security trust badges -->
          <div style="
            border-top:1px solid #1e3a5f;border-bottom:1px solid #1e3a5f;
            padding:12px 0;margin-bottom:16px;
            display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:5px;font-size:0.72rem;color:#7a9bbf;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              <span style="color:#22c55e;font-weight:600;">256-bit SSL</span>
            </div>
            <div style="font-size:0.72rem;color:#7a9bbf;">PCI DSS Compliant</div>
            <div style="display:flex;align-items:center;gap:5px;font-size:0.72rem;color:#7a9bbf;">
              <span style="color:#635bff;font-weight:700;font-size:0.8rem;">stripe</span>
              <span>Secured</span>
            </div>
            <!-- Card logos (text-based) -->
            <div style="display:flex;gap:6px;">
              <span style="background:#162840;border:1px solid #1e3a5f;border-radius:4px;padding:2px 6px;font-size:0.65rem;color:#7a9bbf;font-weight:700;">VISA</span>
              <span style="background:#162840;border:1px solid #1e3a5f;border-radius:4px;padding:2px 6px;font-size:0.65rem;color:#7a9bbf;font-weight:700;">MC</span>
              <span style="background:#162840;border:1px solid #1e3a5f;border-radius:4px;padding:2px 6px;font-size:0.65rem;color:#7a9bbf;font-weight:700;">AMEX</span>
            </div>
          </div>

          <button id="stripe-pay-btn" onclick="submitStripePayment()" style="
            width:100%;padding:14px;border-radius:12px;
            background:#2f80ed;color:#fff;font-size:1rem;font-weight:700;
            border:none;cursor:pointer;transition:all 0.2s;
            display:flex;align-items:center;justify-content:center;gap:10px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            <span id="stripe-pay-label">Pay $0.00</span>
          </button>

          <p style="text-align:center;font-size:0.72rem;color:#7a9bbf;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Secured by <strong style="color:#635bff;">Stripe</strong>
          </p>
        </div>

        <!-- Success State (hidden) -->
        <div id="stripe-success" style="display:none;padding:48px 28px;text-align:center;">
          <div style="font-size:4rem;margin-bottom:20px;">🎉</div>
          <h3 style="margin-bottom:10px;">Order Confirmed!</h3>
          <p style="color:#7a9bbf;margin-bottom:8px;">Thank you for your purchase.</p>
          <p style="color:#7a9bbf;font-size:0.85rem;margin-bottom:28px;">
            A confirmation will be sent to <strong id="stripe-confirm-email" style="color:#e2eaf4;"></strong>
          </p>
          <div id="stripe-pm-id" style="
            background:#162840;border:1px solid #1e3a5f;border-radius:10px;
            padding:12px 16px;font-size:0.78rem;color:#7a9bbf;margin-bottom:24px;text-align:left;
            font-family:monospace;word-break:break-all;"></div>
          <button onclick="closeCheckout(true)" style="
            padding:12px 28px;border-radius:10px;background:#2f80ed;
            color:#fff;font-weight:700;border:none;cursor:pointer;">
            Continue Shopping
          </button>
        </div>

      </div>
    </div>`;
  document.body.appendChild(el);
}

function openCheckout() {
  if (cart.length === 0) {
    showToast('Your cart is empty!');
    return;
  }
  injectCheckoutModal();
  closeCart();

  // Render order summary
  const summary = document.getElementById('stripe-summary');
  if (summary) {
    summary.innerHTML = `
      <div style="font-size:0.78rem;font-weight:700;color:#7a9bbf;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">Order Summary</div>
      ${cart.map(item => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:0.88rem;color:#e2eaf4;">
          <span style="flex:1;margin-right:12px;">${item.name} <span style="color:#7a9bbf;">×${item.qty}</span></span>
          <span style="font-weight:600;">$${(item.price * item.qty).toFixed(2)}</span>
        </div>`).join('')}
      <div id="checkout-total-line" style="margin-top:8px;"></div>`;
  }

  // Render shipping options and totals
  selectedShipping = '';
  renderShippingOptions();
  updateCheckoutTotals();

  // Show overlay
  const overlay = document.getElementById('stripe-overlay');
  const box = document.getElementById('stripe-box');
  overlay.style.opacity = '1';
  overlay.style.pointerEvents = 'all';
  box.style.transform = 'scale(1)';
  document.body.style.overflow = 'hidden';

  // Mount Stripe Card Element
  setTimeout(() => {
    const stripe = getStripe();
    const elements = stripe.elements({
      fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap' }]
    });
    stripeCard = elements.create('card', {
      style: {
        base: {
          color: '#e2eaf4',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '15px',
          fontWeight: '400',
          '::placeholder': { color: '#7a9bbf' },
          iconColor: '#7a9bbf'
        },
        invalid: { color: '#ef4444', iconColor: '#ef4444' }
      },
      hidePostalCode: true   // We handle postal code ourselves to support CA/US/international
    });
    stripeCard.mount('#stripe-card-element');
    stripeCard.on('change', e => {
      const el = document.getElementById('stripe-card-errors');
      if (el) el.textContent = e.error ? e.error.message : '';
      const cardEl = document.getElementById('stripe-card-element');
      if (cardEl) cardEl.style.borderColor = e.error ? '#ef4444' : e.complete ? '#22c55e' : '#1e3a5f';
    });
    stripeCard.on('focus', () => {
      const cardEl = document.getElementById('stripe-card-element');
      if (cardEl) cardEl.style.borderColor = '#2f80ed';
    });
    stripeCard.on('blur', () => {
      const cardEl = document.getElementById('stripe-card-element');
      if (cardEl) cardEl.style.borderColor = '#1e3a5f';
    });

    // Postal code — accepts CA (A1A 1A1), US (12345), and international formats
    const postalEl = document.getElementById('stripe-postal');
    if (postalEl) {
      postalEl.addEventListener('input', e => {
        // Auto-uppercase and allow letters + digits + space + dash
        let v = e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '');
        e.target.value = v;
      });
      postalEl.addEventListener('focus', () => postalEl.style.borderColor = '#2f80ed');
      postalEl.addEventListener('blur',  () => postalEl.style.borderColor = '#1e3a5f');
    }

    // Email focus style
    const emailEl = document.getElementById('stripe-email');
    if (emailEl) {
      emailEl.addEventListener('focus', () => emailEl.style.borderColor = '#2f80ed');
      emailEl.addEventListener('blur',  () => emailEl.style.borderColor = '#1e3a5f');
    }
  }, 80);

  // Close on overlay click
  const overlay2 = document.getElementById('stripe-overlay');
  overlay2.onclick = e => { if (e.target === overlay2) closeCheckout(); };
}

function closeCheckout(clearCart = false) {
  const overlay = document.getElementById('stripe-overlay');
  const box = document.getElementById('stripe-box');
  if (!overlay) return;
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  box.style.transform = 'scale(0.96)';
  document.body.style.overflow = '';
  if (stripeCard) { stripeCard.unmount(); stripeCard = null; }
  if (clearCart) {
    cart = [];
    saveCart();
    // Reset form visibility for next time
    setTimeout(() => {
      const form = document.getElementById('stripe-payment-form');
      const success = document.getElementById('stripe-success');
      const summary = document.getElementById('stripe-summary');
      const shippingDiv = document.getElementById('stripe-shipping');
      if (form) form.style.display = 'block';
      if (success) success.style.display = 'none';
      if (summary) summary.style.display = 'block';
      if (shippingDiv) shippingDiv.style.display = 'block';
    }, 400);
  }
}

// ── SHIPPING ─────────────────────────────────────────────
function getShippingCost(method, subtotal) {
  if (method === 'pickup') return 0;
  if (method === 'canada_post') return subtotal >= 60.00 ? 0 : 10.00;
  return 0;
}

function renderShippingOptions() {
  const el = document.getElementById('stripe-shipping');
  if (!el) return;
  const subtotal = cartTotal();
  const freeShipping = subtotal >= 60.00;
  const cpCost = freeShipping ? 0 : 10.00;
  const dot = (sel) => `<div style="width:18px;height:18px;border-radius:50%;border:2px solid ${sel?'#2f80ed':'#4a6a8a'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${sel?'<div style="width:8px;height:8px;border-radius:50%;background:#2f80ed;"></div>':''}</div>`;

  el.innerHTML = `
    <div style="font-size:0.78rem;font-weight:700;color:#7a9bbf;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">Delivery Method</div>
    ${freeShipping ? '<div style="font-size:0.75rem;color:#22c55e;margin-bottom:10px;font-weight:600;">🎉 Your order qualifies for free Canada Post shipping!</div>' : ''}
    <div style="display:flex;flex-direction:column;gap:8px;">

      <div style="display:flex;align-items:center;gap:12px;background:#162840;border:1.5px solid ${selectedShipping==='canada_post'?'#2f80ed':'#1e3a5f'};border-radius:10px;padding:12px 14px;cursor:pointer;transition:border-color 0.2s;" onclick="selectShipping('canada_post')">
        ${dot(selectedShipping==='canada_post')}
        <div style="flex:1;">
          <div style="font-weight:600;font-size:0.9rem;">🇨🇦 Canada Post</div>
          <div style="font-size:0.75rem;color:#7a9bbf;margin-top:2px;">Standard delivery to your address</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          ${freeShipping
            ? '<div style="font-weight:800;font-size:0.88rem;color:#22c55e;">FREE</div><div style="font-size:0.7rem;color:#22c55e;">Orders $60+</div>'
            : `<div style="font-weight:700;font-size:0.9rem;">$${cpCost.toFixed(2)}</div><div style="font-size:0.7rem;color:#7a9bbf;">+free over $60</div>`}
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;background:#162840;border:1.5px solid ${selectedShipping==='pickup'?'#2f80ed':'#1e3a5f'};border-radius:10px;padding:12px 14px;cursor:pointer;transition:border-color 0.2s;" onclick="selectShipping('pickup')">
        ${dot(selectedShipping==='pickup')}
        <div style="flex:1;">
          <div style="font-weight:600;font-size:0.9rem;">📍 Pickup — Moncton, NB</div>
          <div style="font-size:0.75rem;color:#7a9bbf;margin-top:2px;">Pick up at our Moncton location</div>
        </div>
        <div style="font-weight:800;font-size:0.88rem;color:#22c55e;flex-shrink:0;">FREE</div>
      </div>

    </div>`;
}

function selectShipping(method) {
  selectedShipping = method;
  renderShippingOptions();
  updateCheckoutTotals();
}

function updateCheckoutTotals() {
  const subtotal = cartTotal();
  const shipping = getShippingCost(selectedShipping, subtotal);
  const total = subtotal + shipping;

  const totalLine = document.getElementById('checkout-total-line');
  if (totalLine) {
    const shipLabel = selectedShipping === 'canada_post'
      ? (shipping === 0 ? '🇨🇦 Canada Post <span style="color:#22c55e;font-size:0.75rem;">(Free over $60)</span>' : '🇨🇦 Canada Post')
      : selectedShipping === 'pickup' ? '📍 Pickup — Moncton' : null;
    totalLine.innerHTML = `
      <div style="border-top:1px solid #1e3a5f;padding-top:8px;">
        <div style="display:flex;justify-content:space-between;font-size:0.82rem;color:#7a9bbf;padding:3px 0;">
          <span>Subtotal</span><span>$${subtotal.toFixed(2)}</span>
        </div>
        ${shipLabel
          ? `<div style="display:flex;justify-content:space-between;font-size:0.82rem;padding:3px 0;color:${shipping===0?'#22c55e':'#e2eaf4'};">
               <span>${shipLabel}</span>
               <span>${shipping === 0 ? 'FREE' : '$'+shipping.toFixed(2)}</span>
             </div>`
          : `<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:#7a9bbf;padding:3px 0;">
               <span>Shipping</span><span style="color:#f59e0b;">← Select method above</span>
             </div>`}
        <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:800;padding-top:8px;border-top:1px solid #1e3a5f;margin-top:4px;">
          <span>Total</span>
          <span style="color:#2f80ed;">$${total.toFixed(2)} CAD</span>
        </div>
      </div>`;
  }

  const payLabel = document.getElementById('stripe-pay-label');
  if (payLabel) payLabel.textContent = `Pay $${total.toFixed(2)} CAD`;
}

async function submitStripePayment() {
  const btn = document.getElementById('stripe-pay-btn');
  const errEl = document.getElementById('stripe-card-errors');
  const name   = document.getElementById('stripe-name')?.value?.trim();
  const email  = document.getElementById('stripe-email')?.value?.trim();
  const postal = document.getElementById('stripe-postal')?.value?.trim().toUpperCase();

  if (!name) {
    if (errEl) errEl.textContent = 'Please enter your full name.';
    document.getElementById('stripe-name')?.focus();
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errEl) errEl.textContent = 'Please enter a valid email address.';
    document.getElementById('stripe-email')?.focus();
    return;
  }
  if (!postal) {
    if (errEl) errEl.textContent = 'Please enter your postal or ZIP code.';
    document.getElementById('stripe-postal')?.focus();
    return;
  }
  if (!selectedShipping) {
    if (errEl) errEl.textContent = 'Please select a delivery method above.';
    document.getElementById('stripe-shipping')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (!stripeCard) return;

  const resetBtn = () => {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> <span>Pay $${cartTotal().toFixed(2)} CAD</span>`;
  };

  // Loading state
  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0"/></svg> Processing…`;
  if (errEl) errEl.textContent = '';

  const stripe = getStripe();

  try {
    // Step 1 — Ask backend to create a PaymentIntent (server calculates total + shipping)
    const intentRes = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart, email, name, postal, shippingMethod: selectedShipping })
    });

    const intentData = await intentRes.json();

    if (!intentRes.ok || intentData.error) {
      if (errEl) errEl.textContent = intentData.error || 'Server error. Please try again.';
      resetBtn();
      return;
    }

    const { clientSecret } = intentData;

    // Step 2 — Confirm payment with Stripe (actually charges the card)
    const { paymentIntent, error } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: stripeCard,
        billing_details: { name, email, address: { postal_code: postal } }
      }
    });

    if (error) {
      if (errEl) errEl.textContent = error.message;
      resetBtn();
      return;
    }

    if (paymentIntent.status === 'succeeded') {
      // Save order to backend + trigger invoice email
      let orderNumber = '';
      try {
        const confirmRes = await fetch('/api/orders/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentIntentId: paymentIntent.id,
            cart,
            email,
            name,
            postal,
            total:          paymentIntent.amount / 100,
            shippingMethod: selectedShipping,
            shippingCost:   intentData.shippingCost || 0
          })
        });
        const confirmData = await confirmRes.json();
        orderNumber = confirmData.orderNumber || '';
      } catch (e) {
        console.error('Order save error:', e);
      }

      // Show success state
      const form = document.getElementById('stripe-payment-form');
      const summaryEl = document.getElementById('stripe-summary');
      const success = document.getElementById('stripe-success');
      const confirmEmail = document.getElementById('stripe-confirm-email');
      const pmId = document.getElementById('stripe-pm-id');

      if (form) form.style.display = 'none';
      if (summaryEl) summaryEl.style.display = 'none';
      const shippingEl = document.getElementById('stripe-shipping');
      if (shippingEl) shippingEl.style.display = 'none';
      if (success) success.style.display = 'block';
      if (confirmEmail) confirmEmail.textContent = email;
      if (pmId) pmId.innerHTML = `
        <strong style="color:#22c55e;">✓ Payment successful!</strong><br><br>
        ${orderNumber ? `<span style="color:#7a9bbf;">Order Number:</span> <strong style="color:#e2eaf4;">${orderNumber}</strong><br>` : ''}
        <span style="color:#7a9bbf;">Amount:</span> $${(paymentIntent.amount / 100).toFixed(2)} CAD<br>
        <span style="color:#7a9bbf;font-size:0.85em;margin-top:6px;display:block;">A confirmation email has been sent to ${email}</span>
        <span style="color:#f59e0b;font-size:0.82em;margin-top:8px;display:block;">📬 Don't see it? Check your <strong>junk or spam folder</strong> — it sometimes lands there.</span>
      `;
    }

  } catch (err) {
    if (errEl) errEl.textContent = 'Could not connect to server. Make sure the backend is running.';
    resetBtn();
  }
}

// ── STRIPE CHECKOUT ─────────────────────────────────────
// This is the function called by all "Checkout" buttons
function proceedToCheckout() {
  openCheckout();
}

// ── TOAST ─────────────────────────────────────────────────
function showToast(msg) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// ── SCROLL ANIMATIONS ────────────────────────────────────
function initScrollAnimations() {
  const els = document.querySelectorAll('.fade-up');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  els.forEach(el => observer.observe(el));
}

// ── MOBILE NAV ──────────────────────────────────────────
function initMobileNav() {
  const btn = document.getElementById('mobile-menu-btn');
  const nav = document.getElementById('mobile-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => nav.classList.toggle('open'));
}

// ── ACTIVE NAV LINK ──────────────────────────────────────
function highlightActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === page || (page === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
}

// ── SPIN ANIMATION ───────────────────────────────────────
const spinStyle = document.createElement('style');
spinStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(spinStyle);

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateCartUI();
  initScrollAnimations();
  initMobileNav();
  highlightActiveNav();

  document.getElementById('cart-toggle')?.addEventListener('click', openCart);
  document.getElementById('cart-overlay')?.addEventListener('click', closeCart);
  document.getElementById('cart-close')?.addEventListener('click', closeCart);
  document.getElementById('checkout-btn')?.addEventListener('click', proceedToCheckout);

  document.getElementById('notify-form')?.addEventListener('submit', e => {
    e.preventDefault();
    showToast('✓ You\'ll be the first to know when eSIM launches!');
    e.target.reset();
  });
});

// Global scope
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.updateQty = updateQty;
window.openCart = openCart;
window.closeCart = closeCart;
window.proceedToCheckout = proceedToCheckout;
window.selectShipping = selectShipping;
window.closeCheckout = closeCheckout;
window.submitStripePayment = submitStripePayment;
