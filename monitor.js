const { getTokenPrice } = require('./dexscreener');
const { sendTelegramMessage, startCommandListener, clearWebhook, logBotInfo, formatDipAlert, formatReversalAlert } = require('./telegram');
const TOKENS = require('./tokens');

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '60000');

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
      if (price > s.baseline) {
        s.baseline = price;
      }
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
  for (const token of TOKENS) {
    await checkToken(token);
    await new Promise(res => setTimeout(res, 1500));
  }
}

async function startMonitor() {
  for (const token of TOKENS) initState(token);

  // Clear webhook first, then confirm bot identity
  await clearWebhook();
  await logBotInfo();

  console.log(`📡 Monitoring ${TOKENS.length} tokens every ${POLL_INTERVAL / 1000}s`);
  console.log('Tokens:', TOKENS.map(t => t.symbol).join(', '));

  startCommandListener(() => state, () => TOKENS);

  pollAll();
  setInterval(pollAll, POLL_INTERVAL);
}

module.exports = { startMonitor };
