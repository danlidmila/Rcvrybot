const https = require('https');
const { loadTokens, addToken, removeToken } = require('./store');

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
  if (!BOT_TOKEN || !chatId) return Promise.resolve();
  return apiPost('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
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
    if (!res.ok) return [];
    if (res.result && res.result.length > 0) {
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
function startCommandListener(getState, getTokensLive, initTokenState, removeTokenState) {
  console.log('👂 Command listener started');

  async function poll() {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        const msg = update.message || update.channel_post;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id;
        const raw = msg.text.trim();
        const text = raw.toLowerCase().split('@')[0];

        console.log(`💬 "${raw}" from chat ${chatId}`);

        // ── /start ───────────────────────────────────────────────────
        if (text === '/start') {
          await sendTelegramMessage(
            `🤖 <b>Dip Monitor Bot is live!</b>\n\n` +
            `Tracking <b>${getTokensLive().length}</b> tokens.\n\n` +
            `<b>Commands:</b>\n` +
            `/add SYMBOL CONTRACT CHAIN [dip%] [recovery%]\n` +
            `  <i>e.g. /add HIVE 6Jfon...BAGS solana 30 20</i>\n\n` +
            `/remove SYMBOL\n` +
            `  <i>e.g. /remove HIVE</i>\n\n` +
            `/tokens — list tracked tokens\n` +
            `/status — live price &amp; state\n` +
            `/help — show this message`,
            chatId
          );

        // ── /add ─────────────────────────────────────────────────────
        } else if (text.startsWith('/add')) {
          const parts = raw.trim().split(/\s+/);
          // /add SYMBOL CONTRACT CHAIN [dipThreshold] [reversalThreshold]
          if (parts.length < 4) {
            await sendTelegramMessage(
              `❌ Usage:\n<code>/add SYMBOL CONTRACT CHAIN [dip%] [recovery%]</code>\n\n` +
              `Example:\n<code>/add HIVE 6JfonM6a24xngXh5yJ1imZzbMhpfvEsiafkb4syHBAGS solana 30 20</code>`,
              chatId
            );
            continue;
          }

          const symbol = parts[1].toUpperCase();
          const contractAddress = parts[2];
          const chain = parts[3].toLowerCase();
          const dipThreshold = parseFloat(parts[4]) || 30;
          const reversalThreshold = parseFloat(parts[5]) || 20;

          const token = { symbol, contractAddress, chain, dipThreshold, reversalThreshold };
          const added = addToken(token);

          if (!added) {
            await sendTelegramMessage(`⚠️ <b>${symbol}</b> is already being tracked.`, chatId);
          } else {
            initTokenState(token);
            await sendTelegramMessage(
              `✅ Now tracking <b>${symbol}</b>\n` +
              `Chain: ${chain}\n` +
              `Dip alert: ${dipThreshold}% | Recovery: ${reversalThreshold}%\n` +
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
            await sendTelegramMessage(`⚠️ Token <b>${target.toUpperCase()}</b> not found in tracking list.`, chatId);
          } else {
            removeTokenState(removed.contractAddress);
            await sendTelegramMessage(`🗑️ Removed <b>${removed.symbol}</b> from tracking.`, chatId);
          }

        // ── /tokens ──────────────────────────────────────────────────
        } else if (text === '/tokens') {
          const tokens = getTokensLive();
          if (!tokens.length) {
            await sendTelegramMessage(`📋 No tokens being tracked.\n\nAdd one with:\n<code>/add SYMBOL CONTRACT CHAIN</code>`, chatId);
            continue;
          }
          let lines = [`📋 <b>Tracked Tokens (${tokens.length})</b>\n`];
          for (const t of tokens) {
            lines.push(`• <b>${t.symbol}</b> — Dip: ${t.dipThreshold}% | Recovery: ${t.reversalThreshold}% | ${t.chain}\n<code>${t.contractAddress}</code>`);
          }
          await sendTelegramMessage(lines.join('\n'), chatId);

        // ── /status ──────────────────────────────────────────────────
        } else if (text === '/status') {
          const state = getState();
          const tokens = getTokensLive();
          if (!tokens.length) {
            await sendTelegramMessage(`📊 No tokens being tracked yet.`, chatId);
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
              `  Baseline: ${formatNum(s.baseline)} | Now: ${formatNum(s.lastPrice)}\n` +
              `  Reversals: ${s.reversalCount}`
            );
          }
          await sendTelegramMessage(lines.join('\n'), chatId);

        // ── /help ────────────────────────────────────────────────────
        } else if (text === '/help') {
          await sendTelegramMessage(
            `ℹ️ <b>Dip Monitor Bot</b>\n\n` +
            `/add SYMBOL CONTRACT CHAIN [dip%] [recovery%]\n` +
            `/remove SYMBOL\n` +
            `/tokens — list tracked tokens\n` +
            `/status — live price &amp; state\n` +
            `/start — welcome message\n` +
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
