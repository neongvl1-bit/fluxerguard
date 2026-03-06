const { createCase } = require('./db');
const { sendLog }    = require('./logger');

const COLORS = {
  BAN: 0xed4245, KICK: 0xff9a3c, WARN: 0xfee75c,
  TIMEOUT: 0x5b9bd5, UNBAN: 0x57f287, UNTIMEOUT: 0x57f287
};

async function doModAction({ api, guildId, channelId, modUser, action, targetUser, reason, duration = null, durationMs = null }) {
  reason = reason || 'No reason provided';

  // 1. Creeaza case
  const entry = await createCase(guildId, {
    action, userId: targetUser.id, userTag: targetUser.username,
    modId: modUser.id, modTag: modUser.username,
    reason, duration, auto: false
  });

  // 2. DM catre user (plain text — cel mai compatibil)
  try {
    const dm = await api.users.createDM(targetUser.id);
    const durationLine = duration ? `\nDuration: ${duration}` : '';
    await api.channels.createMessage(dm.id, {
      content: `🔔 **${action}** in this server\nReason: ${reason}${durationLine}\nCase ID: ${entry.caseId}\nModerator: ${modUser.username}`
    });
  } catch (_) {}

  // 3. Executa actiunea
  if (action === 'BAN')       await api.guilds.banUser(guildId, targetUser.id, { reason });
  if (action === 'KICK')      await api.guilds.removeMember(guildId, targetUser.id);
  if (action === 'UNBAN')     await api.guilds.unbanUser(guildId, targetUser.id);
  if (action === 'TIMEOUT')   await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: new Date(Date.now() + durationMs).toISOString() });
  if (action === 'UNTIMEOUT') await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: null });

  // 4. Log
  await sendLog(api, guildId, action, {
    'User':      `${targetUser.username} (${targetUser.id})`,
    'Moderator': modUser.username,
    'Reason':    reason,
    'Case ID':   entry.caseId,
    ...(duration ? { 'Duration': duration } : {})
  }, entry);

  // 5. Reply in canal (plain text)
  const durationLine = duration ? ` | Duration: **${duration}**` : '';
  await api.channels.createMessage(channelId, {
    content: `✅ **${action}** — \`${entry.caseId}\`\nUser: **${targetUser.username}**${durationLine}\nReason: ${reason}`
  });

  console.log(`[MOD] ${action} — ${targetUser.username} (${entry.caseId})`);
  return entry;
}

module.exports = { doModAction };
