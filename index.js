const { startMonitor } = require('./monitor');

console.log('🚀 Dip Monitor Bot starting...');
startMonitor().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
