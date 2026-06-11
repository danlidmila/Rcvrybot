const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'DipMonitorBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
  });
}

async function getTokenData(contractAddress) {
  const json = await fetchUrl(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`);
  const pairs = json.pairs || [];
  if (!pairs.length) return null;

  // Sort by liquidity, pick best pair
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const pair = pairs[0];

  return {
    symbol: pair.baseToken?.symbol || 'UNKNOWN',
    name: pair.baseToken?.name || '',
    chain: pair.chainId || 'unknown',
    priceUsd: parseFloat(pair.priceUsd) || 0,
    priceNative: parseFloat(pair.priceNative) || 0,
    liquidity: pair.liquidity?.usd || 0,
    volume24h: pair.volume?.h24 || 0,
    pairAddress: pair.pairAddress,
    priceChange24h: pair.priceChange?.h24 || 0,
  };
}

async function getTokenPrice(contractAddress) {
  const data = await getTokenData(contractAddress);
  return data;
}

module.exports = { getTokenPrice, getTokenData };
