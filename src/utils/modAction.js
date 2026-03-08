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
  try {
    if (action === 'BAN')       await api.guilds.banUser(guildId, targetUser.id, { reason });
    if (action === 'KICK')      await api.guilds.removeMember(guildId, targetUser.id);
    if (action === 'UNBAN')     await api.guilds.unbanUser(guildId, targetUser.id);
    if (action === 'TIMEOUT')   await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: new Date(Date.now() + durationMs).toISOString() });
    if (action === 'UNTIMEOUT') await api.guilds.editMember(guildId, targetUser.id, { communication_disabled_until: null });
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('403')) throw new Error(`Bot is missing the required permissions to **${action.toLowerCase()}** this user. Make sure FlxGuard has the necessary role permissions.`);
    throw e;
  }

  // Log
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
