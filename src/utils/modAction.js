const { createCase }        = require('./db');
const { sendLog }           = require('./logger');
const { modConfirm, modDM } = require('./embeds');

// Permisiuni necesare per actiune
const REQUIRED_PERMS = {
  BAN:      { bits: [8n, 4n],              name: 'Ban Members or Administrator' },
  UNBAN:    { bits: [8n, 4n],              name: 'Ban Members or Administrator' },
  KICK:     { bits: [8n, 2n],              name: 'Kick Members or Administrator' },
  TIMEOUT:  { bits: [8n, 1073741824n],     name: 'Moderate Members or Administrator' },
  UNTIMEOUT:{ bits: [8n, 1073741824n],     name: 'Moderate Members or Administrator' },
  WARN:     { bits: [8n, 4n, 2n, 32n],    name: 'Ban/Kick Members, Manage Guild, or Administrator' },
};

// Verifica daca botul are permisiunile necesare
async function checkBotPerms(api, guildId, action) {
  try {
    const { getBotUser } = require('../index');
    const botUser = getBotUser();
    if (!botUser) return; // daca nu stim bot ID, sarim verificarea

    const member = await api.guilds.getMember(guildId, botUser.id).catch(() => null);
    if (!member) return;

    const roles = await api.guilds.getRoles(guildId).catch(() => []);
    const allRoles = Array.isArray(roles) ? roles : (roles?.roles || []);
    const myRoleIds = new Set((member.roles || []).map(String));

    let perms = 0n;
    for (const role of allRoles) {
      const isEveryone = String(role.id) === String(guildId);
      const hasRole    = myRoleIds.has(String(role.id));
      if (isEveryone || hasRole) {
        try { perms |= BigInt(role.permissions || '0'); } catch (_) {}
      }
    }

    const required = REQUIRED_PERMS[action];
    if (!required) return;

    const hasPerms = required.bits.some(bit => (perms & bit) === bit);
    if (!hasPerms) {
      throw new Error(`Bot is missing permissions: **${required.name}**`);
    }
  } catch (e) {
    if (e.message?.startsWith('Bot is missing')) throw e;
    // Daca verificarea esueaza din alt motiv, continuam
  }
}

async function doModAction({ api, guildId, channelId, modUser, action, targetUser, reason, duration = null, durationMs = null }) {
  reason = reason || 'No reason provided';

  // Verifica permisiunile botului inainte sa execute
  await checkBotPerms(api, guildId, action);

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
  if (action === 'BAN')   await api.guilds.banUser(guildId, targetUser.id, { reason });
  if (action === 'KICK')  await api.guilds.removeMember(guildId, targetUser.id);
  if (action === 'UNBAN') await api.guilds.unbanUser(guildId, targetUser.id);
  if (action === 'TIMEOUT') {
    await api.guilds.editMember(guildId, targetUser.id, {
      communication_disabled_until: new Date(Date.now() + durationMs).toISOString()
    });
  }
  if (action === 'UNTIMEOUT') {
    await api.guilds.editMember(guildId, targetUser.id, {
      communication_disabled_until: null
    });
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
