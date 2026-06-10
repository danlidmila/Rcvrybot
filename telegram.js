const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendTelegramMessage(message) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return resolve();
    }

    const body = JSON.stringify({
      chat_id: CHAT_ID,
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
        const json = JSON.parse(data);
        if (!json.ok) {
          console.error('Telegram error:', json.description);
        }
        resolve(json);
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Message formatters ───────────────────────────────────────────────

function formatDipAlert(symbol, contractAddress, originalBaseline, currentPrice, dropPercent) {
  const lines = [
    `🚨 <b>MASSIVE DIP DETECTED — ${symbol}</b>`,
    `<code>${contractAddress}</code>`,
    ``,
    `• ⚠️ <b>${symbol}</b> dropped ${dropPercent.toFixed(1)}% below ORIGINAL baseline.`,
    `📉 Original: ${formatNum(originalBaseline)} → Current: ${formatNum(currentPrice)}`,
  ];
  return lines.join('\n');
}

function formatReversalAlert(symbol, contractAddress, dipBaseline, currentPrice, gainPercent, totalReversals) {
  const lines = [
    `🔄 <b>${symbol}</b> reversed from dip!`,
    `<code>${contractAddress}</code>`,
    ``,
    `📉 Dip baseline: ${formatNum(dipBaseline)} → 📈 Current: ${formatNum(currentPrice)}`,
    `📈 Reversal gain: ${gainPercent.toFixed(1)}%`,
    `⚡ Total reversals: ${totalReversals}`,
  ];
  return lines.join('\n');
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(8);
}

module.exports = {
  sendTelegramMessage,
  formatDipAlert,
  formatReversalAlert,
};
