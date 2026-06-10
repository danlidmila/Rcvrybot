const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastUpdateId = 0;

// ─── Send message ─────────────────────────────────────────────────────
function sendTelegramMessage(message, chatId = CHAT_ID) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN || !chatId) {
      console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return resolve();
    }

    const body = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
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
        try {
          const json = JSON.parse(data);
          if (!json.ok) console.error('Telegram error:', json.description);
          resolve(json);
        } catch (e) { resolve(); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Get updates (long polling) ───────────────────────────────────────
function getUpdates() {
  return new Promise((resolve) => {
    if (!BOT_TOKEN) return resolve([]);

    const path = `/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`;

    https.get(`https://api.telegram.org${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok && json.result.length > 0) {
            lastUpdateId = json.result[json.result.length - 1].update_id;
            resolve(json.result);
          } else {
            resolve([]);
          }
        } catch (e) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

// ─── Command handler ──────────────────────────────────────────────────
function startCommandListener(getState, getTokens) {
  console.log('👂 Command listener started');

  async function poll() {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        const msg = update.message || update.channel_post;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id;
        const text = msg.text.trim().toLowerCase();

        if (text.startsWith('/start')) {
          await sendTelegramMessage(
            `🤖 <b>Dip Monitor Bot is live!</b>\n\n` +
            `Tracking <b>${getTokens().length}</b> tokens for dips & reversals.\n\n` +
            `Commands:\n` +
            `/status — current price & state for all tokens\n` +
            `/tokens — list monitored tokens\n` +
            `/help — show this message`,
            chatId
          );

        } else if (text.startsWith('/status')) {
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
            const baseline = s.baseline ? formatNum(s.baseline) : 'N/A';
            const current = s.lastPrice ? formatNum(s.lastPrice) : 'N/A';
            lines.push(
              `• <b>${token.symbol}</b> ${dipStatus}\n` +
              `  Baseline: ${baseline} | Now: ${current}\n` +
              `  Reversals: ${s.reversalCount}`
            );
          }

          await sendTelegramMessage(lines.join('\n'), chatId);

        } else if (text.startsWith('/tokens')) {
          const tokens = getTokens();
          let lines = [`📋 <b>Monitored Tokens (${tokens.length})</b>\n`];
          for (const t of tokens) {
            lines.push(`• <b>${t.symbol}</b> — Dip: ${t.dipThreshold}% | Recovery: ${t.reversalThreshold}%\n<code>${t.contractAddress}</code>`);
          }
          await sendTelegramMessage(lines.join('\n'), chatId);

        } else if (text.startsWith('/help')) {
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
      console.error('Command poll error:', err.message);
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
  formatDipAlert,
  formatReversalAlert,
};
