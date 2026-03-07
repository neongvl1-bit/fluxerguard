const { getSettings, createCase, isWhitelisted } = require('../utils/db');
const { sendLog } = require('../utils/logger');

const tracker = new Map();

async function handleAntiRaid(api, guildId, member) {
  const cfg = await getSettings(guildId);
  if (!cfg.antiraid_enabled) return;
  if (await isWhitelisted(guildId, member.user.id)) return;

  const now = Date.now();
  if (!tracker.has(guildId)) tracker.set(guildId, []);
  const joins  = tracker.get(guildId);
  joins.push({ userId: member.user.id, ts: now });
  const recent = joins.filter(j => now - j.ts < cfg.antiraid_interval);
  tracker.set(guildId, recent);

  if (recent.length >= cfg.antiraid_threshold) {
    console.log(`[ANTIRAID] 🚨 ${recent.length} joins in ${cfg.antiraid_interval / 1000}s — triggering`);
    tracker.set(guildId, []);

    for (const { userId } of recent) {
      if (await isWhitelisted(guildId, userId)) continue;
      const reason = `[AntiRaid] Mass join detected — auto ${cfg.antiraid_action}`;
      try {
        try {
          const dm = await api.users.createDM(userId);
          await api.channels.createMessage(dm.id, {
            content: `🛡️ **Automated Action: ${cfg.antiraid_action.toUpperCase()}**\nReason: ${reason}`
          });
        } catch (_) {}

        if (cfg.antiraid_action === 'ban') await api.guilds.banUser(guildId, userId, { reason });
        else await api.guilds.removeMember(guildId, userId);

        const entry = await createCase(guildId, {
          action: cfg.antiraid_action.toUpperCase(),
          userId, userTag: userId,
          modId: 'bot', modTag: 'FluxerGuard',
          reason, auto: true,
        });

        await sendLog(api, guildId, 'ANTIRAID', {
          'User':   userId,
          'Action': cfg.antiraid_action.toUpperCase(),
          'Trigger': `${recent.length} joins / ${cfg.antiraid_interval / 1000}s`,
          'Case':   entry.caseId,
        }, entry);
      } catch (err) { console.error('[ANTIRAID]', err.message); }
    }
  }
}

module.exports = { handleAntiRaid };
