const https = require('https');
const { loadTokens, addToken, removeToken } = require('./store');
const { getTokenData } = require('./dexscreener');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastUpdateId = 0;

function apiPost(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function apiGet(method, params = {}) {
  return new Promise((resolve) => {
    const query = new URLSearchParams(params).toString();
    const path = `/bot${BOT_TOKEN}/${method}${query ? '?' + query : ''}`;
    https.get({ hostname: 'api.telegram.org', path }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

async function clearWebhook() {
  console.log('🔧 Clearing webhook...');
  const res = await apiPost('deleteWebhook', { drop_pending_updates: false });
  console.log('Webhook cleared:', JSON.stringify(res));
}

async function logBotInfo() {
  const res = await apiGet('getMe');
  if (res.ok) {
    console.log(`🤖 Bot: @${res.result.username} (id: ${res.result.id})`);
  } else {
    console.error('❌ getMe failed:', JSON.stringify(res));
  }
}

function sendTelegramMessage(message, chatId = CHAT_ID) {
  if (!BOT_TOKEN || !chatId) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return Promise.resolve();
  }
  console.log(`📤 Sending message to ${chatId}...`);
  return apiPost('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }).then(res => {
    if (!res.ok) console.error('❌ Send failed:', JSON.stringify(res));
    else console.log('✅ Message sent');
    return res;
  });
}

async function getUpdates() {
  if (!BOT_TOKEN) return [];
  try {
    const res = await apiGet('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 5,
      allowed_updates: JSON.stringify(['message', 'channel_post']),
    });
    if (!res.ok) {
      console.error('getUpdates error:', JSON.stringify(res));
      return [];
    }
    if (res.result && res.result.length > 0) {
      lastUpdateId = res.result[res.result.length - 1].update_id;
      console.log(`📨 ${res.result.length} update(s)`);
      return res.result;
    }
    return [];
  } catch (err) {
    console.error('getUpdates exception:', err.message);
    return [];
  }
}

// ─── Default thresholds ───────────────────────────────────────────────
const DEFAULT_DIP = parseFloat(process.env.DEFAULT_DIP_THRESHOLD || '30');
const DEFAULT_RECOVERY = parseFloat(process.env.DEFAULT_RECOVERY_THRESHOLD || '20');

// ─── Command listener ─────────────────────────────────────────────────
function startCommandListener(getState, initTokenState, removeTokenState) {
  console.log('👂 Command listener started');

  async function poll() {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        const msg = update.message || update.channel_post;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id;
        const raw = msg.text.trim();
        const text = raw.toLowerCase().split('@')[0].trim();

        console.log(`💬 "${raw}" from chat ${chatId}`);

        // ── /start ───────────────────────────────────────────────────
        if (text === '/start') {
          const tokens = loadTokens();
          await sendTelegramMessage(
            `🤖 <b>Dip Monitor Bot is live!</b>\n\n` +
            `Tracking <b>${tokens.length}</b> token(s).\n\n` +
            `<b>Commands:</b>\n` +
            `/add CA — add a token by contract address\n` +
            `/remove SYMBOL — stop tracking a token\n` +
            `/tokens — list all tracked tokens\n` +
            `/status — live prices &amp; state\n` +
            `/help — show this message`,
            chatId
          );

        // ── /add CA (just paste the contract address) ─────────────────
        } else if (text.startsWith('/add')) {
          const parts = raw.trim().split(/\s+/);
          if (parts.length < 2) {
            await sendTelegramMessage(
              `❌ Usage: <code>/add CONTRACT_ADDRESS</code>\n\nExample:\n<code>/add 6JfonM6a24xngXh5yJ1imZzbMhpfvEsiafkb4syHBAGS</code>`,
              chatId
            );
            continue;
          }

          const contractAddress = parts[1].trim();
          await sendTelegramMessage(`🔍 Looking up <code>${contractAddress}</code>...`, chatId);

          let tokenData;
          try {
            tokenData = await getTokenData(contractAddress);
          } catch (err) {
            await sendTelegramMessage(`❌ Failed to fetch token data: ${err.message}`, chatId);
            continue;
          }

          if (!tokenData || !tokenData.symbol) {
            await sendTelegramMessage(`❌ Could not find token on DexScreener. Check the contract address and try again.`, chatId);
            continue;
          }

          const token = {
            symbol: tokenData.symbol,
            contractAddress,
            chain: tokenData.chain,
            dipThreshold: DEFAULT_DIP,
            reversalThreshold: DEFAULT_RECOVERY,
          };

          const added = addToken(token);
          if (!added) {
            await sendTelegramMessage(`⚠️ <b>${tokenData.symbol}</b> is already being tracked.`, chatId);
          } else {
            initTokenState(token);
            await sendTelegramMessage(
              `✅ Now tracking <b>${tokenData.symbol}</b>\n` +
              `Chain: ${tokenData.chain}\n` +
              `Price: $${tokenData.priceUsd}\n` +
              `Liquidity: $${formatNum(tokenData.liquidity)}\n` +
              `Dip alert at: ${DEFAULT_DIP}% drop\n` +
              `Recovery alert at: ${DEFAULT_RECOVERY}% gain\n\n` +
              `<code>${contractAddress}</code>`,
              chatId
            );
          }

        // ── /remove ──────────────────────────────────────────────────
        } else if (text.startsWith('/remove')) {
          const parts = raw.trim().split(/\s+/);
          if (parts.length < 2) {
            await sendTelegramMessage(`❌ Usage: <code>/remove SYMBOL</code>\nExample: <code>/remove HIVE</code>`, chatId);
            continue;
          }
          const target = parts[1];
          const removed = removeToken(target);
          if (!removed) {
            await sendTelegramMessage(`⚠️ <b>${target.toUpperCase()}</b> not found.`, chatId);
          } else {
            removeTokenState(removed.contractAddress);
            await sendTelegramMessage(`🗑️ Removed <b>${removed.symbol}</b> from tracking.`, chatId);
          }

        // ── /tokens ──────────────────────────────────────────────────
        } else if (text === '/tokens') {
          const tokens = loadTokens();
          if (!tokens.length) {
            await sendTelegramMessage(`📋 No tokens tracked yet.\n\nAdd one:\n<code>/add CONTRACT_ADDRESS</code>`, chatId);
            continue;
          }
          let lines = [`📋 <b>Tracked Tokens (${tokens.length})</b>\n`];
          for (const t of tokens) {
            lines.push(`• <b>${t.symbol}</b> | ${t.chain} | Dip: ${t.dipThreshold}% | Recovery: ${t.reversalThreshold}%\n<code>${t.contractAddress}</code>`);
          }
          await sendTelegramMessage(lines.join('\n'), chatId);

        // ── /status ──────────────────────────────────────────────────
        } else if (text === '/status') {
          const state = getState();
          const tokens = loadTokens();
          if (!tokens.length) {
            await sendTelegramMessage(`📊 No tokens tracked yet.`, chatId);
            continue;
          }
          let lines = ['📊 <b>Token Status</b>\n'];
          for (const token of tokens) {
            const s = state[token.contractAddress];
            if (!s || s.lastPrice === null) {
              lines.push(`• <b>${token.symbol}</b> — awaiting first price...`);
              continue;
            }
            const dipStatus = s.inDip ? '🔴 IN DIP' : '🟢 Normal';
            lines.push(
              `• <b>${token.symbol}</b> ${dipStatus}\n` +
              `  Peak: ${formatNum(s.baseline)} | Now: ${formatNum(s.lastPrice)}\n` +
              `  Drop from peak: ${(((s.baseline - s.lastPrice) / s.baseline) * 100).toFixed(1)}%\n` +
              `  Reversals: ${s.reversalCount}`
            );
          }
          await sendTelegramMessage(lines.join('\n'), chatId);

        // ── /help ────────────────────────────────────────────────────
        } else if (text === '/help') {
          await sendTelegramMessage(
            `ℹ️ <b>Dip Monitor Bot</b>\n\n` +
            `/add CA — add token by contract address (auto-detects symbol)\n` +
            `/remove SYMBOL — stop tracking\n` +
            `/tokens — list tracked tokens\n` +
            `/status — live prices &amp; state\n` +
            `/start or /help — this message\n\n` +
            `Default thresholds: Dip ${DEFAULT_DIP}% | Recovery ${DEFAULT_RECOVERY}%`,
            chatId
          );
        }
      }
    } catch (err) {
      console.error('Poll error:', err.message);
    }
    setTimeout(poll, 2000);
  }

  poll();
}

// ─── Alert formatters ─────────────────────────────────────────────────
function formatDipAlert(symbol, contractAddress, peak, currentPrice, dropPercent) {
  return [
    `🚨 <b>MASSIVE DIP DETECTED — ${symbol}</b>`,
    `<code>${contractAddress}</code>`,
    ``,
    `• 🚨 <b>${symbol}</b> dropped ${dropPercent.toFixed(1)}% FROM PEAK.`,
    `📉 Peak: ${formatNum(peak)} → Current: ${formatNum(currentPrice)}`,
  ].join('\n');
}

function formatReversalAlert(symbol, contractAddress, dipBaseline, currentPrice, gainPercent, totalReversals) {
  return [
    `🔄 <b>${symbol}</b> reversed from dip!`,
    `<code>${contractAddress}</code>`,
    ``,
    `📉 Dip baseline: ${formatNum(dipBaseline)} → 📈 Current: ${formatNum(currentPrice)}`,
    `📈 Reversal gain: ${gainPercent.toFixed(1)}%`,
    `⚡ Total reversals: ${totalReversals}`,
  ].join('\n');
}

function formatNum(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(8);
}

module.exports = {
  sendTelegramMessage,
  startCommandListener,
  clearWebhook,
  logBotInfo,
  formatDipAlert,
  formatReversalAlert,
};
