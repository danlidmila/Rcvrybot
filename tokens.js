// Add tokens you want to monitor here
// contractAddress: the token's contract address
// symbol: display name
// chain: 'solana' | 'base' | 'ethereum' | 'bsc' etc
// dipThreshold: % drop from baseline to trigger MASSIVE DIP alert (default 30)
// reversalThreshold: % gain from dip baseline to trigger reversal alert (default 20)

module.exports = [
  {
    symbol: 'HIVE',
    contractAddress: '6JfonM6a24xngXh5yJ1imZzbMhpfvEsiafkb4syHBAGS',
    chain: 'solana',
    dipThreshold: 30,
    reversalThreshold: 20,
  },
  {
    symbol: 'HARAMBE',
    contractAddress: '9Q7GqoFWRhho1JScLGeDhH9SL8djgHZevnunPN7Vpump',
    chain: 'solana',
    dipThreshold: 30,
    reversalThreshold: 20,
  },
  {
    symbol: 'REALM',
    contractAddress: 'E8RR8MAJDqiux39JM69QbUqvo2uhpUHXAJsnZP4jpump',
    chain: 'solana',
    dipThreshold: 30,
    reversalThreshold: 20,
  },
  // Add more tokens here:
  // {
  //   symbol: 'TOKEN',
  //   contractAddress: 'YOUR_CONTRACT_ADDRESS',
  //   chain: 'solana',
  //   dipThreshold: 30,
  //   reversalThreshold: 20,
  // },
];
