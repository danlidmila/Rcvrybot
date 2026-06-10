const { getTokenPrice } = require('./dexscreener');
const { sendTelegramMessage, startCommandListener, clearWebhook, logBotInfo, formatDipAlert, formatReversalAlert } = require('./telegram');
const { loadTokens } = require('./store');

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '60000');

const state = {};

function initTokenState(token) {
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

function removeTokenState(contractAddress) {
  delete state[contractAddress];
}

async function checkToken(token) {
  const { symbol, contractAddress, chain, dipThreshold, reversalThreshold } = token;

  if (!state[contractAddress]) initTokenState(token);
  const s = state[contractAddress];

  let priceData;
  try {
    priceData = await getTokenPrice(contractAddress, chain);
  } catch (err) {
    console.error(`[${symbol}] Fetch error:`, err.message);
    return;
  }

  if (!priceData || !priceData.priceNative) {
    console.warn(`[${symbol}] No price data`);
    return;
  }

  const price = priceData.priceNative;

  if (s.baseline === null) {
    s.baseline = price;
    s.lastPrice = price;
    console.log(`[${symbol}] Baseline set: ${price}`);
    return;
  }

  s.lastPrice = price;

  if (!s.inDip) {
    const dropFromBaseline = ((s.baseline - price) / s.baseline) * 100;
    if (dropFromBaseline >= dipThreshold) {
      console.log(`[${symbol}] 🚨 DIP: ${dropFromBaseline.toFixed(1)}%`);
      s.inDip = true;
      s.dipBaseline = price;
      s.dipAlertSent = true;
      await sendTelegramMessage(formatDipAlert(symbol, contractAddress, s.baseline, price, dropFromBaseline));
    } else {
      if (price > s.baseline) s.baseline = price;
    }
  } else {
    if (price < s.dipBaseline) s.dipBaseline = price;
    const gainFromDip = ((price - s.dipBaseline) / s.dipBaseline) * 100;
    if (gainFromDip >= reversalThreshold) {
      s.reversalCount++;
      console.log(`[${symbol}] 🔄 REVERSAL #${s.reversalCount}`);
      await sendTelegramMessage(formatReversalAlert(symbol, contractAddress, s.dipBaseline, price, gainFromDip, s.reversalCount));
      s.inDip = false;
      s.dipAlertSent = false;
      s.baseline = price;
      s.dipBaseline = null;
    }
  }

  console.log(`[${symbol}] Price: ${price} | Baseline: ${s.baseline} | InDip: ${s.inDip}`);
}

async function pollAll() {
  // Always load fresh token list from store on each poll
  const tokens = loadTokens();
  for (const token of tokens) {
    await checkToken(token);
    await new Promise(res => setTimeout(res, 1500));
  }
}

async function startMonitor() {
  // Load saved tokens and init state
  const tokens = loadTokens();
  for (const token of tokens) initTokenState(token);

  await clearWebhook();
  await logBotInfo();

  console.log(`📡 Loaded ${tokens.length} saved token(s). Polling every ${POLL_INTERVAL / 1000}s`);

  startCommandListener(
    () => state,
    () => loadTokens(),
    initTokenState,
    removeTokenState
  );

  pollAll();
  setInterval(pollAll, POLL_INTERVAL);
}

module.exports = { startMonitor };
