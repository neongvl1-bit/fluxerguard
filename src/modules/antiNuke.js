const { getSettings, createCase, isWhitelisted } = require('../utils/db');
const { sendLog } = require('../utils/logger');
const tracker = new Map();

async function handleAntiNuke(api, guildId, eventName, executorId) {
  const cfg = await getSettings(guildId);
  if (!cfg.antinuke_enabled || !executorId) return;
  if (await isWhitelisted(guildId, executorId)) return;
  const key = `${guildId}:${executorId}`, now = Date.now();
  if (!tracker.has(key)) tracker.set(key, []);
  const actions = tracker.get(key);
  actions.push({ event: eventName, ts: now });
  const recent = actions.filter(a => now - a.ts < cfg.antinuke_interval);
  tracker.set(key, recent);
  if (recent.length >= cfg.antinuke_threshold) {
    tracker.delete(key);
    const reason = `[AntiNuke] ${recent.length} acțiuni distructive`;
    try {
      try { const dm = await api.users.createDM(executorId); await api.channels.createMessage(dm.id, { content: `Ai fost banat. Motiv: ${reason}` }); } catch (_) {}
      await api.guilds.banUser(guildId, executorId, { reason });
      const entry = await createCase(guildId, { action: 'BAN', userId: executorId, userTag: executorId, modId: 'bot', modTag: 'FluxerGuard', reason, auto: true });
      await sendLog(api, guildId, 'ANTINUKE', { 'User': executorId, 'Acțiuni': `${recent.length}x`, 'Case': entry.caseId }, entry);
      console.log(`[ANTINUKE] BAN → ${executorId}`);
    } catch (err) { console.error('[ANTINUKE]', err.message); }
  }
}
module.exports = { handleAntiNuke };
