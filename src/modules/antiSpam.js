const { getSettings, createCase, isWhitelisted } = require('../utils/db');
const { sendLog }    = require('../utils/logger');
const { formatMs }   = require('../utils/duration');
const { alertEmbed } = require('../utils/embeds');
const { isPrivileged } = require('../utils/isPrivileged');

const tracker  = new Map();
const cooldown = new Set();

setInterval(() => {
  const now = Date.now();
  for (const [key, msgs] of tracker) {
    const fresh = msgs.filter(m => now - m.ts < 10000);
    if (!fresh.length) tracker.delete(key);
    else tracker.set(key, fresh);
  }
}, 30000);

async function handleAntiSpam(api, guildId, message) {
  if (message.author?.bot) return;
  if (await isWhitelisted(guildId, message.author.id)) return;

  const memberRoles = message.member?.roles || [];
  if (await isPrivileged(api, guildId, message.author.id, memberRoles)) {
    console.log('[ANTISPAM] Bypass —', message.author.username, 'is privileged');
    return;
  }

  const cfg = await getSettings(guildId);
  if (!cfg.antispam_enabled && !cfg.antiflood_enabled) return;

  const key = `${guildId}:${message.author.id}`, now = Date.now();
  if (!tracker.has(key)) tracker.set(key, []);
  const msgs   = tracker.get(key);
  msgs.push({ content: message.content || '', ts: now });
  const recent = msgs.filter(m => now - m.ts < cfg.antispam_interval);
  tracker.set(key, recent);
  if (cooldown.has(key)) return;

  if (cfg.antispam_enabled && recent.length >= cfg.antispam_max_msgs) {
    cooldown.add(key);
    setTimeout(() => cooldown.delete(key), cfg.antispam_interval * 2);
    await punish(api, guildId, message, cfg, `[AntiSpam] ${recent.length} messages in ${cfg.antispam_interval / 1000}s`);
    return;
  }

  if (cfg.antiflood_enabled) {
    const c = message.content || '';
    if (c.length > 0 && recent.filter(m => m.content === c).length >= cfg.antiflood_duplicates) {
      cooldown.add(key);
      setTimeout(() => cooldown.delete(key), cfg.antispam_interval * 2);
      await punish(api, guildId, message, cfg, `[AntiFlood] Repeated identical message`);
    }
  }
}

async function punish(api, guildId, message, cfg, reason) {
  const user   = message.author;
  const action = cfg.antispam_action;

  if (action === 'alert') {
    const s = await getSettings(guildId);
    if (s.log_channel) {
      await api.channels.createMessage(s.log_channel, alertEmbed('ANTISPAM',
        `**${user.username}** triggered spam detection.`,
        { 'User': `${user.username} (\`${user.id}\`)`, 'Reason': reason, 'Channel': `<#${message.channel_id}>` }
      )).catch(() => {});
    }
    return;
  }

  try {
    if (action === 'timeout')
      await api.guilds.editMember(guildId, user.id, { communication_disabled_until: new Date(Date.now() + cfg.antispam_timeout_ms).toISOString() });
    else if (action === 'kick')
      await api.guilds.removeMember(guildId, user.id);
    else if (action === 'ban')
      await api.guilds.banUser(guildId, user.id, { reason });

    try {
      const dm = await api.users.createDM(user.id);
      await api.channels.createMessage(dm.id, { content: `🚫 **Automated Action: ${action.toUpperCase()}**\nReason: ${reason}` });
    } catch (_) {}

    const entry = await createCase(guildId, {
      action: action.toUpperCase(), userId: user.id, userTag: user.username,
      modId: 'bot', modTag: 'FluxerGuard', reason,
      duration: action === 'timeout' ? formatMs(cfg.antispam_timeout_ms) : null, auto: true,
    });

    await sendLog(api, guildId, 'ANTISPAM', {
      'User': `${user.username} (${user.id})`, 'Action': action.toUpperCase(),
      'Reason': reason, 'Case': entry.caseId,
    }, entry);
  } catch (err) { console.error('[ANTISPAM]', err.message); }
}

module.exports = { handleAntiSpam };
