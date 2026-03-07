const { createCase }        = require('./db');
const { sendLog }           = require('./logger');
const { modConfirm, modDM } = require('./embeds');

async function doModAction({ api, guildId, channelId, modUser, action, targetUser, reason, duration = null, durationMs = null }) {
  reason = reason || 'No reason provided';

  const entry = await createCase(guildId, {
    action, userId: targetUser.id, userTag: targetUser.username,
    modId: modUser.id, modTag: modUser.username,
    reason, duration, auto: false,
  });

  // DM user
  try {
    const dm = await api.users.createDM(targetUser.id);
    await api.channels.createMessage(dm.id, modDM(action, 'this server', reason, entry.caseId, modUser.username, duration));
  } catch (_) {}

  // Executa actiunea
  if (action === 'BAN')       await api.guilds.banUser(guildId, targetUser.id, { reason });
  if (action === 'KICK')      await api.guilds.removeMember(guildId, targetUser.id);
  if (action === 'UNBAN')     await api.guilds.unbanUser(guildId, targetUser.id);
  if (action === 'TIMEOUT')   await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: new Date(Date.now() + durationMs).toISOString() });
  if (action === 'UNTIMEOUT') await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: null });

  // Log
  await sendLog(api, guildId, action, {
    'User':      `${targetUser.username} (${targetUser.id})`,
    'Moderator': modUser.username,
    'Reason':    reason,
    'Case ID':   entry.caseId,
    ...(duration ? { 'Duration': duration } : {}),
  }, entry);

  // Reply in canal
  const payload = { ...modConfirm(action, targetUser, reason, entry.caseId, duration) };
  await api.channels.createMessage(channelId, payload);

  console.log(`[MOD] ${action} — ${targetUser.username} (${entry.caseId})`);
  return entry;
}

module.exports = { doModAction };
