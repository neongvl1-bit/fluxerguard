const { getSettings, createCase, isWhitelisted } = require('../utils/db');
const { sendLog }    = require('../utils/logger');
const { alertEmbed, sendAlertPing } = require('../utils/embeds');
const { isPrivileged } = require('../utils/isPrivileged');

const tracker = new Map();

async function handleAntiNuke(api, guildId, eventName, executorId) {
  const cfg = await getSettings(guildId);
  if (!cfg.antinuke_enabled || !executorId) return;
  if (await isWhitelisted(guildId, executorId)) return;
  if (await isPrivileged(api, guildId, executorId, [])) {
    console.log('[ANTINUKE] Bypass —', executorId, 'is privileged');
    return;
  }

  const key = `${guildId}:${executorId}`, now = Date.now();
  if (!tracker.has(key)) tracker.set(key, []);
  const actions = tracker.get(key);
  actions.push({ event: eventName, ts: now });
  const recent  = actions.filter(a => now - a.ts < cfg.antinuke_interval);
  tracker.set(key, recent);

  if (recent.length >= cfg.antinuke_threshold) {
    tracker.delete(key);
    const action = cfg.antinuke_action || 'ban';

    if (action === 'alert') {
      const s = await getSettings(guildId);
      if (s.log_channel) {
        await api.channels.createMessage(s.log_channel, alertEmbed('ANTINUKE',
          `User \`${executorId}\` performed **${recent.length}** destructive actions in **${cfg.antinuke_interval / 1000}s**.`,
          { 'User': `\`${executorId}\``, 'Actions': recent.map(a => a.event).join(', '), 'Threshold': `${cfg.antinuke_threshold} actions / ${cfg.antinuke_interval / 1000}s` },
          'alert'
        )).catch(() => {});
      }
      await sendAlertPing(api, guildId, 'ANTINUKE');
      return;
    }

    const reason = `[AntiNuke] ${recent.length} destructive actions in ${cfg.antinuke_interval / 1000}s`;
    let nukeGuildName = 'the server';
    try { const ng = await api.guilds.get(guildId); if (ng?.name) nukeGuildName = ng.name; } catch (_) {}
    try {
      try {
        const dm = await api.users.createDM(executorId);
        await api.channels.createMessage(dm.id, { content: `💥 **Automated Action: BAN** in **${nukeGuildName}**\nReason: ${reason}` });
      } catch (_) {}
      await api.guilds.banUser(guildId, executorId, { reason });
      const entry = await createCase(guildId, { action: 'BAN', userId: executorId, userTag: executorId, modId: 'bot', modTag: 'FluxGuard', reason, auto: true });
      await sendLog(api, guildId, 'ANTINUKE', { 'User': executorId, 'Actions': `${recent.length}x in ${cfg.antinuke_interval / 1000}s`, 'Trigger': recent.map(a => a.event).join(', '), 'Case': entry.caseId }, entry);
    } catch (err) { console.error('[ANTINUKE]', err.message); }
  }
}

module.exports = { handleAntiNuke };
