const Stripe = require('stripe');

const STICKER_NAMES = {
  1: 'Bonnie Dunes',
  2: 'Are we there yet?',
  3: 'Serenity',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  const bonnieEmail = process.env.BONNIE_EMAIL;

  if (!stripeSecret || !webhookSecret || !resendKey || !bonnieEmail) {
    console.error('Webhook misconfigured: missing env var(s)');
    return { statusCode: 500, body: 'Webhook not configured' };
  }

  const stripe = Stripe(stripeSecret);
  const sig = event.headers['stripe-signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  try {
    const sessionId = stripeEvent.data.object.id;
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'shipping_cost.shipping_rate'],
    });

    const meta = session.metadata || {};
    const customerName = meta.customer_name || session.customer_details?.name || '(no name)';
    const customerEmail = session.customer_details?.email || '(no email)';
    const customerMessage = meta.customer_message || '';
    const totalAud = ((session.amount_total || 0) / 100).toFixed(2);
    const shippingChoice = session.shipping_cost?.shipping_rate?.display_name || '(unknown)';
    const shippingAud = ((session.shipping_cost?.amount_total || 0) / 100).toFixed(2);

    const shipDetails = session.shipping_details || session.collected_information?.shipping_details;
    const ship = shipDetails?.address;
    const shipName = shipDetails?.name || customerName;
    const shippingAddress = ship ? [
      shipName,
      ship.line1,
      ship.line2,
      [ship.city, ship.state, ship.postal_code].filter(Boolean).join(' '),
      ship.country,
    ].filter(Boolean).join('\n') : '(no shipping address)';

    let items = [];
    try { items = JSON.parse(meta.items || '[]'); } catch {}

    const itemListText = items.length
      ? items.map(i => `  • ${STICKER_NAMES[i.id] || `Sticker ${i.id}`} × ${i.qty}`).join('\n')
      : '  (none — see Stripe dashboard)';

    const subject = `New Bonnie Dune order — ${customerName} ($${totalAud})`;

    const text = [
      'New order!',
      '',
      `From: ${customerName} <${customerEmail}>`,
      `Total: $${totalAud} AUD (incl. $${shippingAud} shipping)`,
      `Shipping: ${shippingChoice}`,
      '',
      'Stickers to pack:',
      itemListText,
      '',
      'Ship to:',
      shippingAddress,
      '',
      customerMessage ? `Customer message:\n${customerMessage}\n` : '',
      session.payment_intent
        ? `Stripe payment: https://dashboard.stripe.com/payments/${session.payment_intent}`
        : '',
    ].filter(Boolean).join('\n');

    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#222">
        <h2 style="color:#B8352B;margin-bottom:4px">New Bonnie Dune order</h2>
        <p style="margin:0 0 16px;color:#666">${escapeHtml(customerName)} &lt;${escapeHtml(customerEmail)}&gt;</p>
        <table style="border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:4px 12px 4px 0;color:#666">Total</td><td style="padding:4px 0"><strong>$${totalAud} AUD</strong> <span style="color:#666">(incl. $${shippingAud} shipping)</span></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">Shipping</td><td style="padding:4px 0">${escapeHtml(shippingChoice)}</td></tr>
        </table>
        <h3 style="margin-bottom:6px">Stickers to pack</h3>
        ${items.length
          ? `<ul style="margin-top:0">${items.map(i => `<li>${escapeHtml(STICKER_NAMES[i.id] || `Sticker ${i.id}`)} × ${i.qty}</li>`).join('')}</ul>`
          : '<p style="color:#666">(none — see Stripe dashboard)</p>'}
        <h3 style="margin-bottom:6px">Ship to</h3>
        <pre style="font-family:ui-monospace,Menlo,monospace;background:#f5f5f5;padding:12px;border-radius:6px;margin:0">${escapeHtml(shippingAddress)}</pre>
        ${customerMessage
          ? `<h3 style="margin-bottom:6px;margin-top:20px">Customer message</h3>
             <blockquote style="margin:0;padding:12px;border-left:3px solid #D4A843;background:#fff8e6">${escapeHtml(customerMessage)}</blockquote>`
          : ''}
        ${session.payment_intent
          ? `<p style="margin-top:24px"><a href="https://dashboard.stripe.com/payments/${session.payment_intent}" style="color:#B8352B">View in Stripe →</a></p>`
          : ''}
      </div>
    `;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Bonnie Dune Orders <onboarding@resend.dev>',
        to: bonnieEmail,
        subject,
        text,
        html,
        reply_to: customerEmail !== '(no email)' ? customerEmail : undefined,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error('Resend send failed:', resp.status, errBody);
      return { statusCode: 500, body: 'Email send failed' };
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Webhook handler error:', err);
    return { statusCode: 500, body: err.message || 'Handler error' };
  }
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
