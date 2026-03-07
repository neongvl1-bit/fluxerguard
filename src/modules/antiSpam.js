const { getSettings, createCase, isWhitelisted } = require('../utils/db');
const { sendLog }    = require('../utils/logger');
const { formatMs }   = require('../utils/duration');
const { securityAlert } = require('../utils/embeds');

const tracker = new Map();
const cooldown = new Set();

async function handleAntiSpam(api, guildId, message) {
  if (message.author?.bot) return;
  if (await isWhitelisted(guildId, message.author.id)) return;
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
    await punish(api, guildId, message, cfg,
      `[AntiSpam] ${recent.length} messages in ${cfg.antispam_interval / 1000}s`);
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
  const user = message.author;
  try {
    if (cfg.antispam_action === 'timeout')
      await api.guilds.editMember(guildId, user.id, { communication_disabled_until: new Date(Date.now() + cfg.antispam_timeout_ms).toISOString() });
    else if (cfg.antispam_action === 'kick')
      await api.guilds.removeMember(guildId, user.id);
    else if (cfg.antispam_action === 'ban')
      await api.guilds.banUser(guildId, user.id, { reason });

    try {
      const dm = await api.users.createDM(user.id);
      await api.channels.createMessage(dm.id, {
        content: `🚫 **Automated Action: ${cfg.antispam_action.toUpperCase()}**\nReason: ${reason}`
      });
    } catch (_) {}

    const entry = await createCase(guildId, {
      action: cfg.antispam_action.toUpperCase(),
      userId: user.id, userTag: user.username,
      modId: 'bot', modTag: 'FluxerGuard',
      reason, duration: cfg.antispam_action === 'timeout' ? formatMs(cfg.antispam_timeout_ms) : null,
      auto: true,
    });

    await sendLog(api, guildId, 'ANTISPAM', {
      'User':   `${user.username} (${user.id})`,
      'Action': cfg.antispam_action.toUpperCase(),
      'Reason': reason,
      'Case':   entry.caseId,
    }, entry);

    console.log(`[ANTISPAM] ${cfg.antispam_action.toUpperCase()} — ${user.username}`);
  } catch (err) { console.error('[ANTISPAM]', err.message); }
}

module.exports = { handleAntiSpam };
