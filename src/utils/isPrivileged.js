const { rolesCache } = require('./cache');

const PRIVILEGED_BITS = [8n, 4n, 2n, 32n, 32768n, 16n, 8192n];

// Owner cache
const ownerIds = new Map();
function setOwner(guildId, ownerId) {
  ownerIds.set(String(guildId), String(ownerId));
}

// Fetch roluri cu cache
async function getGuildRoles(api, guildId) {
  let roles = rolesCache.get(String(guildId));
  if (!roles) {
    const data = await api.guilds.getRoles(String(guildId)).catch(() => []);
    roles = Array.isArray(data) ? data : [];
    if (roles.length) rolesCache.set(String(guildId), roles);
  }
  return roles;
}

// Verifica daca un set de role IDs contine perms privilegiate
function hasPrivilege(memberRoleIds, allRoles) {
  const myIds = new Set((memberRoleIds || []).map(String));
  for (const role of allRoles) {
    if (!myIds.has(String(role.id))) continue;
    try {
      const p = BigInt(role.permissions || '0');
      for (const bit of PRIVILEGED_BITS) {
        if ((p & bit) === bit) return true;
      }
    } catch (_) {}
  }
  return false;
}

// Functia principala — folosita de antiRaid si antiNuke
// memberRoleIds = array de role IDs (optional, daca le avem deja)
async function isPrivileged(api, guildId, userId, memberRoleIds) {
  const gId = String(guildId);
  const uId = String(userId);

  // Owner bypass
  if (ownerIds.get(gId) === uId) return true;

  try {
    const allRoles = await getGuildRoles(api, gId);

    // Daca avem rolurile deja pasate
    if (memberRoleIds?.length) {
      return hasPrivilege(memberRoleIds, allRoles);
    }

    // Altfel fetch member
    const member = await api.guilds.getMember(gId, uId).catch(() => null);
    if (member?.roles?.length) {
      return hasPrivilege(member.roles, allRoles);
    }
  } catch (_) {}

  return false;
}

module.exports = { isPrivileged, setOwner, getGuildRoles, hasPrivilege };
