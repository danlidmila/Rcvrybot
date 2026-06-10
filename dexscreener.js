const https = require('https');

/**
 * Fetch token price data from DexScreener
 * Returns { priceUsd, priceNative, liquidity, volume, pairAddress }
 */
async function getTokenPrice(contractAddress, chain) {
  return new Promise((resolve, reject) => {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;

    https.get(url, { headers: { 'User-Agent': 'DipMonitorBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const pairs = json.pairs || [];

          // Filter by chain if specified, prefer highest liquidity pair
          const filtered = chain
            ? pairs.filter(p => p.chainId && p.chainId.toLowerCase() === chain.toLowerCase())
            : pairs;

          if (!filtered.length) {
            return resolve(null);
          }

          // Sort by liquidity descending, pick best pair
          filtered.sort((a, b) => {
            const liqA = a.liquidity?.usd || 0;
            const liqB = b.liquidity?.usd || 0;
            return liqB - liqA;
          });

          const pair = filtered[0];
          resolve({
            priceUsd: parseFloat(pair.priceUsd) || 0,
            priceNative: parseFloat(pair.priceNative) || 0,
            liquidity: pair.liquidity?.usd || 0,
            volume24h: pair.volume?.h24 || 0,
            pairAddress: pair.pairAddress,
            dexId: pair.dexId,
          });
        } catch (err) {
          reject(new Error(`DexScreener parse error: ${err.message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`DexScreener fetch error: ${err.message}`));
    });
  });
}

module.exports = { getTokenPrice };
