// Timing log for real-device checks: VOLKAN_DEBUG=1 npx electron@44.5.1 app
const enabled = process.env.VOLKAN_DEBUG === '1';
function timing(step, start, extra = '') { if (enabled) console.log('[Volkan süre]', step, Math.round(performance.now() - start) + ' ms', extra); }
module.exports = { enabled, timing };
