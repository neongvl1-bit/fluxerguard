const { rolesCache } = require('./cache');

const PRIVILEGED_BITS = [8n, 4n, 2n, 32n, 32768n, 16n, 8192n];

// Owner cache
const ownerIds = new Map();
function setOwner(guildId, ownerId) {
  ownerIds.set(String(guildId), String(ownerId));
}

// Verifica daca un permissions number contine un bit privilegiat
function hasPrivilegeBits(permissionsStr) {
  try {
    const p = BigInt(permissionsStr || '0');
    for (const bit of PRIVILEGED_BITS) {
      if ((p & bit) === bit) return true;
    }
  } catch (_) {}
  return false;
}

// Fetch roluri cu cache — folosit doar daca member.permissions nu e disponibil
async function getGuildRoles(api, guildId) {
  let roles = rolesCache.get(String(guildId));
  if (!roles) {
    const data = await api.guilds.getRoles(String(guildId)).catch(() => []);
    roles = Array.isArray(data) ? data : [];
    if (roles.length) rolesCache.set(String(guildId), roles);
  }
  return roles;
}

// Verifica daca un set de role IDs contine perms privilegiate (fallback)
function hasPrivilege(memberRoleIds, allRoles) {
  const myIds = new Set((memberRoleIds || []).map(String));
  for (const role of allRoles) {
    if (!myIds.has(String(role.id))) continue;
    if (hasPrivilegeBits(role.permissions)) return true;
  }
  return false;
}

// Functia principala — folosita de antiRaid, antiNuke, antiSpam
// memberRoleIds = array de role IDs (optional, daca le avem deja din event)
async function isPrivileged(api, guildId, userId, memberRoleIds) {
  const gId = String(guildId);
  const uId = String(userId);

  // 1. Owner bypass — fetch guild daca nu e in cache
  if (!ownerIds.has(gId)) {
    try {
      const guild = await api.guilds.get(gId);
      if (guild?.owner_id) ownerIds.set(gId, String(guild.owner_id));
    } catch (_) {}
  }
  if (ownerIds.get(gId) === uId) return true;

  try {
    // 2. Fetch member — Fluxer poate returna permissions direct pe member object
    const member = await api.guilds.getMember(gId, uId).catch(() => null);

    // 2a. Daca member are permissions field direct (computed permissions)
    if (member?.permissions) {
      return hasPrivilegeBits(member.permissions);
    }

    // 2b. Fallback — verifica prin rolurile din event sau de pe member
    const roleIds = member?.roles?.length ? member.roles : (memberRoleIds || []);
    if (roleIds.length) {
      const allRoles = await getGuildRoles(api, gId);
      if (allRoles.length) return hasPrivilege(roleIds, allRoles);
    }
  } catch (_) {}

  return false;
}

module.exports = { isPrivileged, setOwner, getGuildRoles, hasPrivilege };
