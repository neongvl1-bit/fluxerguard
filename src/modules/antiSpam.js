const { getSettings, createCase, isWhitelisted } = require('../utils/db');
const { sendLog }    = require('../utils/logger');
const { formatMs }   = require('../utils/duration');
const { alertEmbed, sendAlertPing } = require('../utils/embeds');
const { isPrivileged } = require('../utils/isPrivileged');

const tracker  = new Map();
const cooldown = new Set();
// Salveaza message IDs per user pentru stergere — { key: [{ id, channelId }] }
const msgIds   = new Map();

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

  const whitelisted = await isWhitelisted(guildId, message.author.id);
  console.log(`[SPAM-TRACE] ${message.author.username} whitelisted=${whitelisted}`);
  if (whitelisted) return;

  const memberRoles = message.member?.roles || [];
  const privileged = await isPrivileged(api, guildId, message.author.id, memberRoles);
  console.log(`[SPAM-TRACE] ${message.author.username} privileged=${privileged}`);
  if (privileged) return;

  const cfg = await getSettings(guildId);
  console.log(`[SPAM-TRACE] antispam_enabled=${cfg.antispam_enabled} antiflood_enabled=${cfg.antiflood_enabled}`);
  if (!cfg.antispam_enabled && !cfg.antiflood_enabled) return;

  const key = `${guildId}:${message.author.id}`, now = Date.now();
  if (!tracker.has(key)) tracker.set(key, []);
  if (!msgIds.has(key))  msgIds.set(key, []);
  const msgs   = tracker.get(key);
  msgs.push({ content: message.content || '', ts: now });
  const recent = msgs.filter(m => now - m.ts < cfg.antispam_interval);
  tracker.set(key, recent);
  // Salveaza ID-ul mesajului pentru stergere ulterioara
  msgIds.get(key).push({ id: message.id, channelId: message.channel_id });
  // Pastreaza doar ultimele 20 de mesaje in buffer
  if (msgIds.get(key).length > 20) msgIds.get(key).shift();
  console.log(`[SPAM-TRACE] ${message.author.username} recent=${recent.length}/${cfg.antispam_max_msgs} cooldown=${cooldown.has(key)}`);
  if (cooldown.has(key)) return;

  if (cfg.antispam_enabled && recent.length >= cfg.antispam_max_msgs) {
    cooldown.add(key);
    setTimeout(() => cooldown.delete(key), cfg.antispam_interval * 2);
    const spamMsgs = [...(msgIds.get(key) || [])];
    msgIds.set(key, []);
    await punish(api, guildId, message, cfg, `[AntiSpam] ${recent.length} messages in ${cfg.antispam_interval / 1000}s`, recent, spamMsgs);
    return;
  }

  if (cfg.antiflood_enabled) {
    const c = message.content || '';
    const dupes = recent.filter(m => m.content === c);
    if (c.length > 0 && dupes.length >= cfg.antiflood_duplicates) {
      cooldown.add(key);
      setTimeout(() => cooldown.delete(key), cfg.antispam_interval * 2);
      const spamMsgs = [...(msgIds.get(key) || [])];
      msgIds.set(key, []);
      await punish(api, guildId, message, cfg, `[AntiFlood] Repeated identical message`, recent, spamMsgs);
    }
  }
}

async function punish(api, guildId, message, cfg, reason, recentMsgs = [], spamMsgIds = []) {
  const user   = message.author;
  const action = cfg.antispam_action;

  // 1. Sterge mesajele flaghate ca spam
  await Promise.allSettled(
    spamMsgIds.map(m => api.channels.deleteMessage(m.channelId, m.id).catch(() => {}))
  );

  // 2. Mesaj scurt in canal — mereu, inclusiv pe alert
  const jokes = [
    `Easy there, <@${user.id}>! 📵 Spam detected — chill out.`,
    `Whoa <@${user.id}>, this isn't a typewriter. 🙃 Slow down!`,
    `<@${user.id}> got caught spamming. 🚨 Not cool.`,
    `Hey <@${user.id}>, the message button isn't a drum. 🥁 Take a breath.`,
  ];
  const msg = jokes[Math.floor(Math.random() * jokes.length)];
  await api.channels.createMessage(message.channel_id, { content: msg }).catch(() => {});

  // 3. Log channel — intotdeauna, pentru toate actiunile inclusiv alert
  const msgList = recentMsgs.length
    ? recentMsgs.slice(-8).map(m => `> ${m.content?.slice(0, 80) || '*(empty)*'}`).join('\n')
    : '*(no content)*';

  const s = await getSettings(guildId);
  if (s.log_channel) {
    const durField = action === 'timeout' ? { 'Duration': formatMs(cfg.antispam_timeout_ms) } : {};
    await api.channels.createMessage(s.log_channel, alertEmbed('ANTISPAM',
      `<@${user.id}> triggered spam detection.`,
      {
        'User':     `<@${user.id}> (\`${user.id}\`)`,
        'Reason':   reason,
        'Channel':  `<#${message.channel_id}>`,
        'Action':   action.toUpperCase(),
        ...durField,
        'Messages Deleted': String(spamMsgIds.length),
        'Flagged Messages': msgList.slice(0, 900),
      },
      action
    )).catch(() => {});
  }

  if (action === 'alert') {
    await sendAlertPing(api, guildId, 'ANTISPAM');
    return;
  }

  try {
    if (action === 'timeout')
      await api.guilds.editMember(guildId, user.id, { communication_disabled_until: new Date(Date.now() + cfg.antispam_timeout_ms).toISOString() });
    else if (action === 'kick')
      await api.guilds.removeMember(guildId, user.id);
    else if (action === 'ban')
      await api.guilds.banUser(guildId, user.id, { reason });

    let spamGuildName = 'the server';
    try { const sg = await api.guilds.get(guildId); if (sg?.name) spamGuildName = sg.name; } catch (_) {}
    try {
      const dm = await api.users.createDM(user.id);
      const durText = action === 'timeout' ? ` for **${formatMs(cfg.antispam_timeout_ms)}**` : '';
      await api.channels.createMessage(dm.id, { content: `🚫 **Automated Action: ${action.toUpperCase()}**${durText} in **${spamGuildName}**\nReason: ${reason}` });
    } catch (_) {}

    const entry = await createCase(guildId, {
      action: action.toUpperCase(), userId: user.id, userTag: user.username,
      modId: 'bot', modTag: 'FluxGuard', reason,
      duration: action === 'timeout' ? formatMs(cfg.antispam_timeout_ms) : null, auto: true,
    });

    await sendLog(api, guildId, 'ANTISPAM', {
      'User': `${user.username} (${user.id})`, 'Action': action.toUpperCase(),
      'Reason': reason, 'Case': entry.caseId,
    }, entry);
  } catch (err) { console.error('[ANTISPAM]', err.message); }
}

module.exports = { handleAntiSpam };
