# Dip Monitor Bot 🚨📉🔄

Monitors Solana/EVM tokens via DexScreener. Sends Telegram alerts when a token dips hard and when it recovers.

## Alert Types

### 🚨 Massive Dip Detected
Fires when a token drops X% below its baseline (default 30%).

### 🔄 Reversed from Dip
Fires when a token recovers Y% from its dip low (default 20%).

---

## Setup

### 1. Clone & configure tokens
Edit `tokens.js` — add/remove tokens with their contract address, chain, and thresholds.

### 2. Create a Telegram bot
1. Message `@BotFather` on Telegram
2. `/newbot` → get your `BOT_TOKEN`
3. Add the bot to your channel/group as admin
4. Get your `CHAT_ID`:
   - For a channel: `@YourChannelUsername` or use `@userinfobot`
   - For a group: use `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending a message

### 3. Environment variables

Copy `.env.example` to `.env`:
```
TELEGRAM_BOT_TOKEN=123456:ABC-yourtoken
TELEGRAM_CHAT_ID=-100yourchannelid
POLL_INTERVAL_MS=60000
```

---

## Run locally
```bash
node index.js
```

---

## Deploy to Railway

1. Push to GitHub
2. New project → Deploy from GitHub repo
3. Add environment variables in Railway dashboard:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `POLL_INTERVAL_MS` (optional, default 60000)
4. Deploy — Railway will auto-run `npm start`

No Dockerfile needed. No dependencies to install (`npm install` not required — zero deps, pure Node).

---

## How the logic works

```
First poll:       Set baseline price
Subsequent polls: 
  - Not in dip:   If price drops X% from baseline → MASSIVE DIP alert, enter dip mode
                  If price rises → update baseline upward
  - In dip mode:  Track lowest price (dip floor)
                  If price recovers Y% from dip floor → REVERSAL alert
                  Reset baseline to current price, exit dip mode
```

### Key behaviours:
- **Rolling baseline** — baseline only moves up, so it captures the most recent high
- **Dip floor tracking** — during a dip, the baseline moves down to track the worst point
- **Reversal count** — increments each time a token recovers from a dip
- **No external deps** — pure Node.js, zero npm packages needed

---

## Customisation

| Variable | Default | Description |
|---|---|---|
| `dipThreshold` | `30` | % drop to trigger dip alert |
| `reversalThreshold` | `20` | % gain from dip to trigger recovery alert |
| `POLL_INTERVAL_MS` | `60000` | Polling frequency (ms) |

Set per-token in `tokens.js` or globally via env vars.

---

## Adding tokens

In `tokens.js`:
```js
{
  symbol: 'MYTOKEN',
  contractAddress: 'your_contract_address_here',
  chain: 'solana', // or 'base', 'ethereum', 'bsc'
  dipThreshold: 25,      // alert at 25% dip
  reversalThreshold: 15, // alert at 15% recovery
}
```
