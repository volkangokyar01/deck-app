// Plain Node smoke test. Uses Node fetch as the Electron net.fetch stub.
const path = require('path');
const os = require('os');
const { createStats } = require('../../app/stats');
const failures = new Set();
const stats = createStats({
  cacheDir: path.join(os.tmpdir(), 'volkan-deck-stats-smoke'),
  fetch: async (...args) => {
    try { return await fetch(...args); }
    catch (e) { failures.add(new URL(args[0]).hostname + ': ' + (e.cause?.code || e.message)); throw e; }
  }
});
stats.get({ weather: { city: 'İstanbul', lat: 41.01, lon: 28.97 } });
stats.start();
setTimeout(() => {
  console.log(JSON.stringify(stats.get(), null, 2));
  if (failures.size) console.log('Unavailable network sources:', [...failures].join('; '));
  stats.stop();
}, 12000);
