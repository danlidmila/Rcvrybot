const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastUpdateId = 0;

// ─── POST helper ──────────────────────────────────────────────────────
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

// ─── GET helper ───────────────────────────────────────────────────────
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

// ─── Clear webhook ────────────────────────────────────────────────────
async function clearWebhook() {
  console.log('🔧 Clearing webhook...');
  const res = await apiPost('deleteWebhook', { drop_pending_updates: false });
  console.log('Webhook cleared:', JSON.stringify(res));
}

// ─── Bot identity ─────────────────────────────────────────────────────
async function logBotInfo() {
  const res = await apiGet('getMe');
  if (res.ok) {
    console.log(`🤖 Bot: @${res.result.username} (id: ${res.result.id})`);
  } else {
    console.error('❌ getMe failed:', JSON.stringify(res));
  }
}

// ─── Send message ─────────────────────────────────────────────────────
function sendTelegramMessage(message, chatId = CHAT_ID) {
  if (!BOT_TOKEN || !chatId) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return Promise.resolve();
  }
  return apiPost('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

// ─── Get updates via GET ──────────────────────────────────────────────
async function getUpdates() {
  if (!BOT_TOKEN) return [];
  try {
    const params = {
      offset: lastUpdateId + 1,
      timeout: 5,
      allowed_updates: JSON.stringify(['message', 'channel_post']),
    };
    const res = await apiGet('getUpdates', params);

    if (!res.ok) {
      console.error('getUpdates error:', JSON.stringify(res));
      return [];
    }

    if (res.result && res.result.length > 0) {
      console.log(`📨 ${res.result.length} update(s) received`);
      lastUpdateId = res.result[res.result.length - 1].update_id;
      return res.result;
    }
    return [];
  } catch (err) {
    console.error('getUpdates exception:', err.message);
    return [];
  }
}

// ─── Command listener ─────────────────────────────────────────────────
function startCommandListener(getState, getTokens) {
  console.log('👂 Command listener started');

  async function poll() {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        console.log('📩 Update:', JSON.stringify(update).slice(0, 200));

        const msg = update.message || update.channel_post;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id;
        const text = msg.text.trim().toLowerCase().split('@')[0];
        console.log(`💬 "${text}" from chat ${chatId}`);

        if (text === '/start') {
          await sendTelegramMessage(
            `🤖 <b>Dip Monitor Bot is live!</b>\n\n` +
            `Tracking <b>${getTokens().length}</b> tokens for dips &amp; reversals.\n\n` +
            `Commands:\n` +
            `/status — current price &amp; state for all tokens\n` +
            `/tokens — list monitored tokens\n` +
            `/help — show this message`,
            chatId
          );

        } else if (text === '/status') {
          const state = getState();
          const tokens = getTokens();
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
              `  Baseline: ${formatNum(s.baseline)} | Now: ${formatNum(s.lastPrice)}\n` +
              `  Reversals: ${s.reversalCount}`
            );
          }
          await sendTelegramMessage(lines.join('\n'), chatId);

        } else if (text === '/tokens') {
          const tokens = getTokens();
          let lines = [`📋 <b>Monitored Tokens (${tokens.length})</b>\n`];
          for (const t of tokens) {
            lines.push(`• <b>${t.symbol}</b> — Dip: ${t.dipThreshold}% | Recovery: ${t.reversalThreshold}%\n<code>${t.contractAddress}</code>`);
          }
          await sendTelegramMessage(lines.join('\n'), chatId);

        } else if (text === '/help') {
          await sendTelegramMessage(
            `ℹ️ <b>Dip Monitor Bot</b>\n\n` +
            `/start — welcome message\n` +
            `/status — live state of all tokens\n` +
            `/tokens — list of tracked tokens\n` +
            `/help — this message`,
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

// ─── Formatters ───────────────────────────────────────────────────────
function formatDipAlert(symbol, contractAddress, originalBaseline, currentPrice, dropPercent) {
  return [
    `🚨 <b>MASSIVE DIP DETECTED — ${symbol}</b>`,
    `<code>${contractAddress}</code>`,
    ``,
    `• ⚠️ <b>${symbol}</b> dropped ${dropPercent.toFixed(1)}% below ORIGINAL baseline.`,
    `📉 Original: ${formatNum(originalBaseline)} → Current: ${formatNum(currentPrice)}`,
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
