const { getTokenPrice } = require('./dexscreener');
const { sendTelegramMessage, startCommandListener, clearWebhook, logBotInfo, formatDipAlert, formatReversalAlert } = require('./telegram');
const { loadTokens } = require('./store');

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '30000');

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
    console.log(`Init state for ${token.symbol}`);
  }
}

function removeTokenState(contractAddress) {
  delete state[contractAddress];
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

  if (s.baseline === null) {
    s.baseline = price;
    s.lastPrice = price;
    console.log(`[${symbol}] Baseline set: ${price}`);
    return;
  }

  s.lastPrice = price;

  if (!s.inDip) {
    if (price > s.baseline) {
      s.baseline = price;
      console.log(`[${symbol}] New peak: ${price}`);
    }
    const dropFromPeak = ((s.baseline - price) / s.baseline) * 100;
    console.log(`[${symbol}] Drop: ${dropFromPeak.toFixed(1)}% Threshold: ${dipThreshold}%`);

    if (dropFromPeak >= dipThreshold) {
      console.log(`[${symbol}] DIP TRIGGERED`);
      s.inDip = true;
      s.dipBaseline = price;
      s.dipAlertSent = true;
      await sendTelegramMessage(formatDipAlert(symbol, contractAddress, s.baseline, price, dropFromPeak));
    }
  } else {
    if (price < s.dipBaseline) s.dipBaseline = price;
    const gainFromDip = ((price - s.dipBaseline) / s.dipBaseline) * 100;
    console.log(`[${symbol}] Gain from dip: ${gainFromDip.toFixed(1)}% Threshold: ${reversalThreshold}%`);

    if (gainFromDip >= reversalThreshold) {
      s.reversalCount++;
      console.log(`[${symbol}] REVERSAL #${s.reversalCount}`);
      await sendTelegramMessage(formatReversalAlert(symbol, contractAddress, s.dipBaseline, price, gainFromDip, s.reversalCount));
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
    console.log('No tokens yet. Add one with /add CA');
    return;
  }
  console.log(`Polling ${tokens.length} token(s)...`);
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
  console.log(`Loaded ${tokens.length} token(s). Polling every ${POLL_INTERVAL / 1000}s`);
  startCommandListener(() => state, initTokenState, removeTokenState);
  await pollAll();
  setInterval(pollAll, POLL_INTERVAL);
}

module.exports = { startMonitor };
