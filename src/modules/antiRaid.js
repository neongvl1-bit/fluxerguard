const { getSettings, createCase, isWhitelisted, isRoleWhitelisted, incrementStat } = require('../utils/db');
const { sendLog }    = require('../utils/logger');
const { alertEmbed, sendAlertPing } = require('../utils/embeds');
const { isPrivileged } = require('../utils/isPrivileged');
const { executeLockdown } = require('../commands/security');

const tracker = new Map();

async function handleAntiRaid(api, guildId, member) {
  const cfg = await getSettings(guildId);
  if (!cfg.antiraid_enabled) return;
  if (await isWhitelisted(guildId, member.user.id)) return;
  const joinRoles = member.roles || [];
  for (const roleId of joinRoles) { if (await isRoleWhitelisted(guildId, roleId)) return; }
  // skipFetch=true — avem deja rolurile din GUILD_MEMBER_ADD event
  if (await isPrivileged(api, guildId, member.user.id, joinRoles, true)) return;

  const now = Date.now();
  if (!tracker.has(guildId)) tracker.set(guildId, []);
  const joins  = tracker.get(guildId);
  joins.push({ userId: member.user.id, ts: now });
  const recent = joins.filter(j => now - j.ts < cfg.antiraid_interval);
  tracker.set(guildId, recent);

  if (recent.length >= cfg.antiraid_threshold) {
    console.log(`[ANTIRAID] 🚨 ${recent.length} joins in ${cfg.antiraid_interval / 1000}s — action: ${cfg.antiraid_action}`);
    tracker.set(guildId, []);

    const trigger = `${recent.length} joins in ${cfg.antiraid_interval / 1000}s`;

    // ALERT
    if (cfg.antiraid_action === 'alert') {
      if (cfg.log_channel) {
        await api.channels.createMessage(cfg.log_channel, alertEmbed('ANTIRAID',
          `**${recent.length}** users joined in **${cfg.antiraid_interval / 1000}s** — possible raid detected.`,
          { 'Users': recent.map(j => `\`${j.userId}\``).join(', ').slice(0, 900), 'Threshold': `${cfg.antiraid_threshold} joins / ${cfg.antiraid_interval / 1000}s` },
          'alert'
        )).catch(() => {});
      }
      incrementStat(guildId, 'raids');
      await sendAlertPing(api, guildId, 'ANTIRAID');
      return;
    }

    // LOCKDOWN — nu ban/kick, doar lockdown
    if (cfg.antiraid_action === 'lockdown') {
      const reason = `[AntiRaid] Mass join detected — ${trigger}`;
      const locked = await executeLockdown(api, guildId, reason, 'FluxGuard').catch(() => 0);
      incrementStat(guildId, 'raids');
      if (cfg.log_channel) {
        await api.channels.createMessage(cfg.log_channel, alertEmbed('ANTIRAID',
          `Raid detected — server locked down automatically.`,
          { 'Trigger': trigger, 'Channels Locked': String(locked), 'Action': 'LOCKDOWN' },
          'lockdown'
        )).catch(() => {});
      }
      return;
    }

    // BAN / KICK
    // Fetch guild name o singura data in afara buclei — evita N API calls identice
    let raidGuildName = 'the server';
    try { const rg = await api.guilds.get(guildId); if (rg?.name) raidGuildName = rg.name; } catch (_) {}

    for (const { userId } of recent) {
      if (await isWhitelisted(guildId, userId)) continue;
      // skipFetch=true — nu avem rolurile raiderilor dar evitam getMember pe fiecare
      // Raiderul nou joinat nu are roluri privilegiate oricum
      if (await isPrivileged(api, guildId, userId, [], true)) continue;
      const reason = `[AntiRaid] Mass join detected — auto ${cfg.antiraid_action}`;
      try {
        try {
          const dm = await api.users.createDM(userId);
          await api.channels.createMessage(dm.id, { content: `🛡️ **Automated Action: ${cfg.antiraid_action.toUpperCase()}** in **${raidGuildName}**\nReason: ${reason}` });
        } catch (_) {}
        if (cfg.antiraid_action === 'ban') await api.guilds.banUser(guildId, userId, { reason });
        else if (cfg.antiraid_action === 'kick') await api.guilds.removeMember(guildId, userId);
        const entry = await createCase(guildId, { action: cfg.antiraid_action.toUpperCase(), userId, userTag: userId, modId: 'bot', modTag: 'FluxGuard', reason, auto: true });
        incrementStat(guildId, 'raids');
        await sendLog(api, guildId, 'ANTIRAID', { 'User': userId, 'Action': cfg.antiraid_action.toUpperCase(), 'Trigger': `${recent.length} joins / ${cfg.antiraid_interval / 1000}s`, 'Case': entry.caseId }, entry);
      } catch (err) { console.error('[ANTIRAID]', err.message); }
    }
  }
}

module.exports = { handleAntiRaid };
