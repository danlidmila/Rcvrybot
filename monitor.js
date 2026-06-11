const { getTokenPrice } = require('./dexscreener');
const { sendTelegramMessage, startCommandListener, clearWebhook, logBotInfo, formatDipAlert, formatReversalAlert } = require('./telegram');
const { loadTokens } = require('./store');

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '30000');

const state = {};

function initTokenState(token) {
  if (!state[token.contractAddress]) {
    state[token.contractAddress] = {
      baseline: null,   // rolling peak (moves up only)
      dipBaseline: null, // lowest point during a dip
      inDip: false,
      dipAlertSent: false,
      reversalCount: 0,
      lastPrice: null,
    };
    console.log(`📌 Init state for ${token.symbol}`);
  }
}

function removeTokenState(contractAddress) {
  delete state[contractAddress];
  console.log(`🗑️ Removed state for ${contractAddress}`);
}

async function checkToken(token) {
  const { symbol, contractAddress, dipThreshold, reversalThreshold } = token;

  if (!state[contractAddress]) initTokenState(token);
  const s = state[contractAddress];

  let priceData;
  try {
    priceData = await getTokenPrice(contractAddress);
  } catch (err) {
    console.error(`[${symbol}] Fetch error:`, err.message);
    return;
  }

  if (!priceData || !priceData.priceNative) {
    console.warn(`[${symbol}] No price data`);
    return;
  }

  const price = priceData.priceNative;

  // First reading — set baseline
  if (s.baseline === null) {
    s.baseline = price;
    s.lastPrice = price;
    console.log(`[${symbol}] Baseline set: ${price}`);
    return;
  }

  s.lastPrice = price;

  if (!s.inDip) {
    // Track peak upward
    if (price > s.baseline) {
      s.baseline = price;
      console.log(`[${symbol}] New peak: ${price}`);
    }

    const dropFromPeak = ((s.baseline - price) / s.baseline) * 100;
    console.log(`[${symbol}] Price: ${price} | Peak: ${s.baseline} | Drop: ${dropFromPeak.toFixed(1)}% | Threshold: ${dipThreshold}%`);

    if (dropFromPeak >= dipThreshold) {
      console.log(`[${symbol}] 🚨 DIP TRIGGERED: ${dropFromPeak.toFixed(1)}%`);
      s.inDip = true;
      s.dipBaseline = price;
      s.dipAlertSent = true;
      await sendTelegramMessage(formatDipAlert(symbol, contractAddress, s.baseline, price, dropFromPeak));
    }

  } else {
    // Track dip floor downward
    if (price < s.dipBaseline) {
      s.dipBaseline = price;
      console.log(`[${symbol}] New dip low: ${price}`);
    }

    const gainFromDip = ((price - s.dipBaseline) / s.dipBaseline) * 100;
    console.log(`[${symbol}] Price: ${price} | DipBaseline: ${s.dipBaseline} | Gain: ${gainFromDip.toFixed(1)}% | Threshold: ${reversalThreshold}%`);

    if (gainFromDip >= reversalThreshold) {
      s.reversalCount++;
      console.log(`[${symbol}] 🔄 REVERSAL #${s.reversalCount}: +${gainFromDip.toFixed(1)}%`);
      await sendTelegramMessage(formatReversalAlert(symbol, contractAddress, s.dipBaseline, price, gainFromDip, s.reversalCount));

      // Exit dip, new peak is current price
      s.inDip = false;
      s.dipAlertSent = false;
      s.baseline = price;
      s.dipBaseline = null;
    }
  }
}

async function pollAll() {
  const tokens = loadTokens();
  if (!tokens.length) {
    console.log('⏳ No tokens to monitor yet. Add one with /add CA');
    return;
  }
  console.log(`🔄 Polling ${tokens.length} token(s)...`);
  for (const token of tokens) {
    await checkToken(token);
    await new Promise(res => setTimeout(res, 1500));
  }
}

async function startMonitor() {
  const tokens = loadTokens();
  for (const token of tokens) initTokenState(token);

  await clearWebhook();
  await logBotInfo();

  console.log(`📡 Loaded ${tokens.length} saved token(s). Polling every ${POLL_INTERVAL / 1000}s`);

  startCommandListener(
    () => state,
    initTokenState,
    removeTokenState
  );

  // Poll immediately then on interval
  await pollAll();
  setInterval(pollAll, POLL_INTERVAL);
}

module.exports = { startMonitor };
