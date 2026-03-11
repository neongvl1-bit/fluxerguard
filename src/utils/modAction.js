const { createCase, incrementStat } = require('./db');
const { sendLog }           = require('./logger');
const { modConfirm, modDM } = require('./embeds');

const ACTION_COLORS = {
  BAN:      0xE74C3C,
  KICK:     0xE67E22,
  WARN:     0xF1C40F,
  TIMEOUT:  0x9B59B6,
  UNTIMEOUT:0x2ECC71,
  UNBAN:    0x2ECC71,
};

const ACTION_EMOJI = {
  BAN:      '🔨',
  KICK:     '👢',
  WARN:     '⚠️',
  TIMEOUT:  '🔇',
  UNTIMEOUT:'🔊',
  UNBAN:    '✅',
};

// Trimite DM la ownerul serverului cu detalii despre sanctiune
async function notifyOwner(api, guildId, { action, targetUser, modUser, reason, duration, caseId }) {
  try {
    const guild = await api.guilds.get(guildId);
    if (!guild?.owner_id) return;

    // Nu trimite DM daca moderatorul e chiar ownerul
    if (String(guild.owner_id) === String(modUser.id)) return;

    const emoji  = ACTION_EMOJI[action]  || '🛡️';
    const color  = ACTION_COLORS[action] || 0x5865F2;
    const now    = Math.floor(Date.now() / 1000);

    const embed = {
      embeds: [{
        color,
        title: `${emoji}  Moderation Action — ${action}`,
        description: `A moderation action was taken on your server.
Here is a full summary for your records.`,
        fields: [
          { name: '👤  Target User',  value: `**${targetUser.username}**
\`${targetUser.id}\``,    inline: true  },
          { name: '🛡️  Moderator',    value: `**${modUser.username}**
\`${modUser.id}\``,           inline: true  },
          { name: '⚡  Action',        value: `**${action}**`,                                        inline: true  },
          { name: '📋  Case ID',       value: `\`${caseId}\``,                                        inline: true  },
          ...(duration ? [{ name: '⏱️  Duration', value: `**${duration}**`, inline: true }] : []),
          { name: '📝  Reason',        value: reason,                                                 inline: false },
          { name: '🕐  Timestamp',     value: `<t:${now}:F>`,                                         inline: false },
        ],
        footer: {
          text: `FluxGuard  •  Server ID: ${guildId}`,
        },
      }],
    };

    const ownerDM = await api.users.createDM(guild.owner_id);
    await api.channels.createMessage(ownerDM.id, embed);
  } catch (_) {}
}

async function doModAction({ api, guildId, channelId, modUser, action, targetUser, reason, duration = null, durationMs = null }) {
  reason = reason || 'No reason provided';

  const entry = await createCase(guildId, {
    action, userId: targetUser.id, userTag: targetUser.username,
    modId: modUser.id, modTag: modUser.username,
    reason, duration, auto: false,
  });
  const statMap = { BAN: 'bans', KICK: 'kicks', WARN: 'warns', TIMEOUT: 'timeouts', UNBAN: null, UNTIMEOUT: null };
  if (statMap[action]) incrementStat(guildId, statMap[action]);

  // Fetch guild name for DM
  let guildName = 'the server';
  try {
    const g = await api.guilds.get(guildId);
    if (g?.name) guildName = g.name;
  } catch (_) {}

  // DM user sanctionat
  try {
    const dm = await api.users.createDM(targetUser.id);
    await api.channels.createMessage(dm.id, modDM(action, guildName, reason, entry.caseId, modUser.username, duration));
  } catch (_) {}

  // Executa actiunea
  if (action === 'BAN')       await api.guilds.banUser(guildId, targetUser.id, { reason });
  if (action === 'KICK')      await api.guilds.removeMember(guildId, targetUser.id);
  if (action === 'UNBAN')     await api.guilds.unbanUser(guildId, targetUser.id);
  if (action === 'TIMEOUT')   await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: new Date(Date.now() + durationMs).toISOString(), timeout_reason: reason });
  if (action === 'UNTIMEOUT') await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: null, timeout_reason: null });

  // DM owner
  await notifyOwner(api, guildId, {
    action,
    targetUser,
    modUser,
    reason,
    duration,
    caseId: entry.caseId,
  });

  // Log canal
  await sendLog(api, guildId, action, {
    'User':      `${targetUser.username} (${targetUser.id})`,
    'Moderator': modUser.username,
    'Reason':    reason,
    'Case ID':   entry.caseId,
    ...(duration ? { 'Duration': duration } : {}),
  }, entry);

  // Reply in canal
  await api.channels.createMessage(channelId, { ...modConfirm(action, targetUser, reason, entry.caseId, duration) });

  console.log(`[MOD] ${action} — ${targetUser.username} (${entry.caseId})`);
  return entry;
}

module.exports = { doModAction };
