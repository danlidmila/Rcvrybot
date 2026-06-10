const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, 'data', 'tokens.json');

// Ensure data directory exists
function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadTokens() {
  ensureDir();
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load tokens store:', e.message);
  }
  return [];
}

function saveTokens(tokens) {
  ensureDir();
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error('Failed to save tokens store:', e.message);
  }
}

function addToken(token) {
  const tokens = loadTokens();
  const exists = tokens.find(t => t.contractAddress.toLowerCase() === token.contractAddress.toLowerCase());
  if (exists) return false;
  tokens.push(token);
  saveTokens(tokens);
  return true;
}

function removeToken(symbolOrAddress) {
  const tokens = loadTokens();
  const lower = symbolOrAddress.toLowerCase();
  const idx = tokens.findIndex(t =>
    t.symbol.toLowerCase() === lower ||
    t.contractAddress.toLowerCase() === lower
  );
  if (idx === -1) return false;
  const removed = tokens[idx];
  tokens.splice(idx, 1);
  saveTokens(tokens);
  return removed;
}

module.exports = { loadTokens, saveTokens, addToken, removeToken };
