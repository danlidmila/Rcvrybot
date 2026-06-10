const { getTokenPrice } = require('./dexscreener');
const { sendTelegramMessage, formatDipAlert, formatReversalAlert } = require('./telegram');
const TOKENS = require('./tokens');

// Poll interval in ms
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '60000'); // default 60s

// ─── Per-token state ──────────────────────────────────────────────────
// state[address] = {
//   baseline: number,          // original price baseline (first seen)
//   dipBaseline: number|null,  // price at which the dip was confirmed
//   inDip: boolean,            // currently tracking a dip
//   dipAlertSent: boolean,     // already sent a dip alert for this dip
//   reversalCount: number,     // total reversals detected
//   lastPrice: number,
// }
const state = {};

function initState(token) {
  if (!state[token.contractAddress]) {
    state[token.contractAddress] = {
      baseline: null,
      dipBaseline: null,
      inDip: false,
      dipAlertSent: false,
      reversalCount: 0,
      lastPrice: null,
    };
  }
}

// ─── Core logic per token ─────────────────────────────────────────────
async function checkToken(token) {
  const { symbol, contractAddress, chain, dipThreshold, reversalThreshold } = token;
  const s = state[contractAddress];

  let priceData;
  try {
    priceData = await getTokenPrice(contractAddress, chain);
  } catch (err) {
    console.error(`[${symbol}] Fetch error:`, err.message);
    return;
  }

  if (!priceData || !priceData.priceNative) {
    console.warn(`[${symbol}] No price data returned`);
    return;
  }

  // Use priceNative (SOL/ETH price) as the tracking value — more stable for low cap tokens
  // You can switch to priceUsd if preferred
  const price = priceData.priceNative;

  // Set baseline on first run
  if (s.baseline === null) {
    s.baseline = price;
    s.lastPrice = price;
    console.log(`[${symbol}] Baseline set: ${price}`);
    return;
  }

  s.lastPrice = price;

  const dipThresholdMultiplier = 1 - dipThreshold / 100;
  const reversalThresholdMultiplier = 1 + reversalThreshold / 100;

  if (!s.inDip) {
    // ── Check for a new dip ──────────────────────────────────────────
    const dropFromBaseline = ((s.baseline - price) / s.baseline) * 100;

    if (dropFromBaseline >= dipThreshold) {
      console.log(`[${symbol}] 🚨 MASSIVE DIP: ${dropFromBaseline.toFixed(1)}% below baseline`);
      s.inDip = true;
      s.dipBaseline = price; // lock in dip baseline
      s.dipAlertSent = true;

      const msg = formatDipAlert(
        symbol,
        contractAddress,
        s.baseline,
        price,
        dropFromBaseline
      );
      await sendTelegramMessage(msg);
    } else {
      // Update rolling baseline upward only (track new highs)
      if (price > s.baseline) {
        s.baseline = price;
        console.log(`[${symbol}] New baseline: ${price}`);
      }
    }
  } else {
    // ── We're in a dip — watch for recovery ─────────────────────────
    // Update dip baseline downward (track the lowest point)
    if (price < s.dipBaseline) {
      s.dipBaseline = price;
      console.log(`[${symbol}] New dip low: ${price}`);
    }

    const gainFromDip = ((price - s.dipBaseline) / s.dipBaseline) * 100;

    if (gainFromDip >= reversalThreshold) {
      s.reversalCount++;
      console.log(`[${symbol}] 🔄 REVERSAL #${s.reversalCount}: +${gainFromDip.toFixed(1)}% from dip`);

      const msg = formatReversalAlert(
        symbol,
        contractAddress,
        s.dipBaseline,
        price,
        gainFromDip,
        s.reversalCount
      );
      await sendTelegramMessage(msg);

      // Reset: exit dip, new baseline is current price
      s.inDip = false;
      s.dipAlertSent = false;
      s.baseline = price;
      s.dipBaseline = null;
    }
  }

  console.log(`[${symbol}] Price: ${price} | Baseline: ${s.baseline} | InDip: ${s.inDip}`);
}

// ─── Poll loop ────────────────────────────────────────────────────────
async function pollAll() {
  for (const token of TOKENS) {
    await checkToken(token);
    // Small delay between tokens to avoid rate limiting
    await sleep(1500);
  }
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function startMonitor() {
  // Init state for all tokens
  for (const token of TOKENS) {
    initState(token);
  }

  console.log(`📡 Monitoring ${TOKENS.length} tokens. Poll interval: ${POLL_INTERVAL / 1000}s`);
  console.log('Tokens:', TOKENS.map(t => t.symbol).join(', '));

  // First poll immediately
  pollAll();

  // Then on interval
  setInterval(pollAll, POLL_INTERVAL);
}

module.exports = { startMonitor };
