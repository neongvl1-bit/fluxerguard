const { rolesCache, privilegeCache, ownerCache } = require('./cache');

const PRIVILEGED_BITS = [
  8n,      // Administrator
  4n,      // Ban Members
  2n,      // Kick Members
  32n,     // Manage Messages
  32768n,  // Manage Roles
  16n,     // Manage Guild
  8192n,   // Manage Channels
];

function setOwner(guildId, ownerId) {
  ownerCache.set(String(guildId), String(ownerId));
}

function checkPerms(roles, memberRoleIds) {
  const myIds = new Set((memberRoleIds || []).map(String));
  for (const role of roles) {
    if (!myIds.has(String(role.id))) continue;
    try {
      const perms = BigInt(role.permissions || '0');
      for (const bit of PRIVILEGED_BITS) {
        if ((perms & bit) === bit) return true;
      }
    } catch (_) {}
  }
  return false;
}

// Verifica din mesaj (pentru antiSpam — zero API calls)
function isPrivilegedFromMessage(message, guildRoles) {
  const userId  = String(message.author?.id);
  const guildId = String(message.guild_id);

  // Owner
  const ownerId = ownerCache.get(guildId);
  if (ownerId && ownerId === userId) return true;

  // Permissions calculat direct pe member (daca platforma il pune)
  if (message.member?.permissions !== undefined && message.member.permissions !== null) {
    try {
      const perms = BigInt(message.member.permissions);
      for (const bit of PRIVILEGED_BITS) {
        if ((perms & bit) === bit) return true;
      }
    } catch (_) {}
  }

  // Verifica prin roluri
  if (message.member?.roles?.length && guildRoles?.length) {
    return checkPerms(guildRoles, message.member.roles);
  }

  return false;
}

// Verifica async cu API (pentru antiRaid/antiNuke)
async function isPrivileged(api, guildId, userId, memberRoleIds) {
  const gId  = String(guildId);
  const uId  = String(userId);
  const cKey = `${gId}:${uId}`;

  // Cache hit
  const cached = privilegeCache.get(cKey);
  if (cached !== undefined) return cached;

  const set = (v) => { privilegeCache.set(cKey, v); return v; };

  // Owner check
  const ownerId = ownerCache.get(gId);
  if (ownerId && ownerId === uId) return set(true);

  try {
    // Ia rolurile din cache sau API
    let roles = rolesCache.get(gId);
    if (!roles) {
      const data = await api.guilds.getRoles(gId).catch(() => []);
      roles = Array.isArray(data) ? data : [];
      if (roles.length) rolesCache.set(gId, roles);
    }

    // Daca avem role IDs, verifica direct
    if (memberRoleIds?.length && roles.length) {
      return set(checkPerms(roles, memberRoleIds));
    }

    // Altfel ia member
    const member = await api.guilds.getMember(gId, uId).catch(() => null);
    if (member?.roles?.length) {
      return set(checkPerms(roles, member.roles));
    }
  } catch (_) {}

  return set(false);
}

// Preload roluri pentru un guild (apelat la startup)
async function preloadRoles(api, guildId) {
  try {
    const data = await api.guilds.getRoles(String(guildId)).catch(() => []);
    const roles = Array.isArray(data) ? data : [];
    if (roles.length) rolesCache.set(String(guildId), roles);
  } catch (_) {}
}

module.exports = { isPrivileged, isPrivilegedFromMessage, setOwner, preloadRoles };
