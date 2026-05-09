const Stripe = require('stripe');

const STICKER_IDS = [1, 2, 3];
const STICKER_NAMES = {
  1: 'Bonnie Dunes',
  2: 'Are we there yet?',
  3: 'Serenity',
};
const UNIT_PRICE_CENTS = 600;
const BUNDLE_PRICE_CENTS = 1500;

const SHIPPING_COUNTRIES = [
  'AC','AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CV','CW','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IO','IQ','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MK','ML','MM','MN','MO','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PY',
  'QA',
  'RE','RO','RS','RU','RW',
  'SA','SB','SC','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SZ',
  'TA','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','US','UY','UZ',
  'VA','VC','VE','VG','VN','VU',
  'WF','WS',
  'XK',
  'YE','YT',
  'ZA','ZM','ZW',
];

const SHIPPING_RATE_IDS = [
  'shr_1TV8PBGUOXHfOg0cktMUlNNB', // Local pickup — Adelaide (free)
  'shr_1TV8O5GUOXHfOg0cwUl98med', // Standard post — Australia ($3)
  'shr_1TV8PlGUOXHfOg0c588yy0Y7', // International economy ($8)
];

const SHIPPING_OPTIONS = SHIPPING_RATE_IDS.map(id => ({ shipping_rate: id }));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  try {
    const { cart, name, email, message } = JSON.parse(event.body || '{}');

    if (!name || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name and email required' }) };
    }

    const items = Object.entries(cart || {})
      .map(([id, qty]) => ({ id: parseInt(id, 10), qty: parseInt(qty, 10) }))
      .filter(i => STICKER_IDS.includes(i.id) && Number.isFinite(i.qty) && i.qty > 0 && i.qty < 100);

    if (items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty' }) };
    }

    const totalQty = items.reduce((s, i) => s + i.qty, 0);
    const bundles = Math.floor(totalQty / 3);
    const remaining = totalQty % 3;
    const totalCents = bundles * BUNDLE_PRICE_CENTS + remaining * UNIT_PRICE_CENTS;

    const itemsDesc = items.map(i => `${STICKER_NAMES[i.id]} × ${i.qty}`).join(', ');

    const origin = event.headers.origin || `https://${event.headers.host}` || 'https://bonniedune.netlify.app';

    const stripe = Stripe(secret);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: `Bonnie Dune Stickers (${totalQty} × ${totalQty === 1 ? 'sticker' : 'stickers'})`,
            description: itemsDesc,
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      }],
      customer_email: email,
      shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
      shipping_options: SHIPPING_OPTIONS,
      metadata: {
        customer_name: name,
        customer_message: (message || '').slice(0, 500),
        items: JSON.stringify(items),
        total_qty: String(totalQty),
      },
      success_url: `${origin}/?paid=1`,
      cancel_url: `${origin}/?cancelled=1`,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Checkout error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Checkout failed' }),
    };
  }
};
