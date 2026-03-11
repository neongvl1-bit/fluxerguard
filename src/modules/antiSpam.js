const { getSettings, createCase, isWhitelisted, isRoleWhitelisted, incrementStat } = require('../utils/db');
const { sendLog }    = require('../utils/logger');
const { formatMs }   = require('../utils/duration');
const { alertEmbed, sendAlertPing } = require('../utils/embeds');
const { isPrivileged } = require('../utils/isPrivileged');

// tracker   — { key: [{ content, ts }] }  mesajele recente per user
// msgIds    — { key: [{ id, channelId, ts }] } ID-urile mesajelor pentru stergere
// punishing — Set activ DOAR cat dureaza punish() (timeout/kick/ban)
//             Pentru ALERT nu se foloseste — detecția trebuie sa fie continua
const tracker   = new Map();
const msgIds    = new Map();
const punishing = new Set();

// Cleanup periodic — sterge datele utilizatorilor inactivi (>30s fara mesaje)
setInterval(() => {
  const now = Date.now();
  for (const [key, msgs] of tracker) {
    const fresh = msgs.filter(m => now - m.ts < 30000);
    if (!fresh.length) { tracker.delete(key); msgIds.delete(key); }
    else tracker.set(key, fresh);
  }
}, 30000);

async function handleAntiSpam(api, guildId, message) {
  if (!message.author) return;
  if (message.author.bot) return;
  if (message.author.id === require('../utils/botState').getBotUser?.()?.id) return;

  const memberRoles = message.member?.roles || [];

  if (await isWhitelisted(guildId, message.author.id)) return;
  for (const roleId of memberRoles) {
    if (await isRoleWhitelisted(guildId, roleId)) return;
  }
  if (await isPrivileged(api, guildId, message.author.id, memberRoles, true)) return;

  const cfg = await getSettings(guildId);
  if (!cfg.antispam_enabled && !cfg.antiflood_enabled) return;

  const key = `${guildId}:${message.author.id}`;
  const now = Date.now();

  // Blocat doar daca e in curs de punishment real (timeout/kick/ban)
  if (punishing.has(key)) return;

  if (!tracker.has(key)) tracker.set(key, []);
  if (!msgIds.has(key))  msgIds.set(key, []);

  // Adauga mesajul curent
  tracker.get(key).push({ content: message.content || '', ts: now });
  msgIds.get(key).push({ id: message.id, channelId: message.channel_id, ts: now });

  // Pastreaza doar mesajele din fereastra de detectie in ambele structuri
  const recent   = tracker.get(key).filter(m => now - m.ts < cfg.antispam_interval);
  const recentIds = msgIds.get(key).filter(m => now - m.ts < cfg.antispam_interval);
  tracker.set(key, recent);
  msgIds.set(key, recentIds.slice(-20)); // max 20

  const c     = message.content || '';
  const dupes = recent.filter(m => m.content === c);

  // ── AntiSpam — prea multe mesaje in interval ─────────────────────────────
  if (cfg.antispam_enabled && recent.length >= cfg.antispam_max_msgs) {
    const spamMsgs = [...msgIds.get(key)];
    tracker.delete(key);
    msgIds.delete(key);

    if (cfg.antispam_action === 'alert') {
      fireAlert(api, guildId, message, cfg,
        `[AntiSpam] ${recent.length} messages in ${cfg.antispam_interval / 1000}s`,
        recent, spamMsgs);
    } else {
      punishing.add(key);
      try {
        await punish(api, guildId, message, cfg,
          `[AntiSpam] ${recent.length} messages in ${cfg.antispam_interval / 1000}s`,
          recent, spamMsgs);
      } finally {
        punishing.delete(key);
      }
    }
    return;
  }

  // ── AntiFlood — mesaje identice repetate ────────────────────────────────
  if (cfg.antiflood_enabled && c.length > 0 && dupes.length >= cfg.antiflood_duplicates) {
    const spamMsgs = [...msgIds.get(key)];
    tracker.delete(key);
    msgIds.delete(key);

    if (cfg.antispam_action === 'alert') {
      fireAlert(api, guildId, message, cfg,
        `[AntiFlood] ${dupes.length} identical messages`,
        recent, spamMsgs);
    } else {
      punishing.add(key);
      try {
        await punish(api, guildId, message, cfg,
          `[AntiFlood] ${dupes.length} identical messages`,
          recent, spamMsgs);
      } finally {
        punishing.delete(key);
      }
    }
  }
}

// fireAlert — fire-and-forget, nu blocheaza detectia urmatoare
function fireAlert(api, guildId, message, cfg, reason, recentMsgs, spamMsgIds) {
  const user = message.author;

  Promise.allSettled(
    spamMsgIds.map(m => api.channels.deleteMessage(m.channelId, m.id).catch(() => {}))
  ).catch(() => {});

  if (cfg.antispam_public_msg !== false) {
    const jokes = [
      `Easy there, <@${user.id}>! 📵 Spam detected — chill out.`,
      `Whoa <@${user.id}>, this isn't a typewriter. 🙃 Slow down!`,
      `<@${user.id}> got caught spamming. 🚨 Not cool.`,
      `Hey <@${user.id}>, the message button isn't a drum. 🥁 Take a breath.`,
    ];
    api.channels.createMessage(message.channel_id,
      { content: jokes[Math.floor(Math.random() * jokes.length)] }
    ).catch(() => {});
  }

  const msgList = recentMsgs.length
    ? recentMsgs.slice(-8).map(m => `> ${m.content?.slice(0, 80) || '*(empty)*'}`).join('\n')
    : '*(no content)*';

  if (cfg.log_channel) {
    api.channels.createMessage(cfg.log_channel, alertEmbed('ANTISPAM',
      `<@${user.id}> triggered spam detection.`,
      {
        'User':             `<@${user.id}> (\`${user.id}\`)`,
        'Reason':           reason,
        'Channel':          `<#${message.channel_id}>`,
        'Action':           'ALERT',
        'Messages Deleted': String(spamMsgIds.length),
        'Flagged Messages': msgList.slice(0, 900),
      },
      'alert'
    )).catch(() => {});
  }

  incrementStat(guildId, 'spams');

  Promise.race([
    sendAlertPing(api, guildId, 'ANTISPAM'),
    new Promise(r => setTimeout(r, 3000)),
  ]).catch(() => {});
}

// punish — timeout/kick/ban
async function punish(api, guildId, message, cfg, reason, recentMsgs = [], spamMsgIds = []) {
  const user   = message.author;
  const action = cfg.antispam_action;

  await Promise.allSettled(
    spamMsgIds.map(m => api.channels.deleteMessage(m.channelId, m.id).catch(() => {}))
  );

  if (cfg.antispam_public_msg !== false) {
    const jokes = [
      `Easy there, <@${user.id}>! 📵 Spam detected — chill out.`,
      `Whoa <@${user.id}>, this isn't a typewriter. 🙃 Slow down!`,
      `<@${user.id}> got caught spamming. 🚨 Not cool.`,
      `Hey <@${user.id}>, the message button isn't a drum. 🥁 Take a breath.`,
    ];
    await api.channels.createMessage(message.channel_id,
      { content: jokes[Math.floor(Math.random() * jokes.length)] }
    ).catch(() => {});
  }

  const msgList = recentMsgs.length
    ? recentMsgs.slice(-8).map(m => `> ${m.content?.slice(0, 80) || '*(empty)*'}`).join('\n')
    : '*(no content)*';

  if (cfg.log_channel) {
    const durField = action === 'timeout' ? { 'Duration': formatMs(cfg.antispam_timeout_ms) } : {};
    await api.channels.createMessage(cfg.log_channel, alertEmbed('ANTISPAM',
      `<@${user.id}> triggered spam detection.`,
      {
        'User':             `<@${user.id}> (\`${user.id}\`)`,
        'Reason':           reason,
        'Channel':          `<#${message.channel_id}>`,
        'Action':           action.toUpperCase(),
        ...durField,
        'Messages Deleted': String(spamMsgIds.length),
        'Flagged Messages': msgList.slice(0, 900),
      },
      action
    )).catch(() => {});
  }

  try {
    if (action === 'timeout')
      await api.guilds.editMember(guildId, user.id, {
        communication_disabled_until: new Date(Date.now() + cfg.antispam_timeout_ms).toISOString()
      });
    else if (action === 'kick')
      await api.guilds.removeMember(guildId, user.id);
    else if (action === 'ban')
      await api.guilds.banUser(guildId, user.id, { reason });

    let guildName = 'the server';
    try { const sg = await api.guilds.get(guildId); if (sg?.name) guildName = sg.name; } catch (_) {}

    try {
      const dm = await api.users.createDM(user.id);
      const durText = action === 'timeout' ? ` for **${formatMs(cfg.antispam_timeout_ms)}**` : '';
      await api.channels.createMessage(dm.id, {
        content: `🚫 **Automated Action: ${action.toUpperCase()}**${durText} in **${guildName}**\nReason: ${reason}`
      });
    } catch (_) {}

    const entry = await createCase(guildId, {
      action: action.toUpperCase(), userId: user.id, userTag: user.username,
      modId: 'bot', modTag: 'FluxGuard', reason,
      duration: action === 'timeout' ? formatMs(cfg.antispam_timeout_ms) : null, auto: true,
    });
    incrementStat(guildId, 'spams');

    await sendLog(api, guildId, 'ANTISPAM', {
      'User':   `${user.username} (${user.id})`,
      'Action': action.toUpperCase(),
      'Reason': reason,
      'Case':   entry.caseId,
    }, entry);
  } catch (err) { console.error('[ANTISPAM]', err.message); }
}

module.exports = { handleAntiSpam };
