const { rolesCache } = require('./cache');

const PRIVILEGED_BITS = [8n, 4n, 2n, 32n, 8192n, 268435456n]; // Admin, Ban, Kick, Manage Guild, Manage Messages, Manage Roles

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
    const member = await api.guilds.getMember(gId, uId).catch(() => null);
    const roleIds = member?.roles?.length ? member.roles : (memberRoleIds || []);
    const allRoles = await getGuildRoles(api, gId);

    // Debug — arata rolurile userului si permisiunile lor
    console.log(`[PRIV DEBUG] user=${uId} roleIds=${JSON.stringify(roleIds)}`);
    for (const role of allRoles) {
      if (roleIds.map(String).includes(String(role.id))) {
        console.log(`[PRIV DEBUG]   role=${role.name} (${role.id}) perms=${role.permissions}`);
      }
    }
    // Include si @everyone (id = guildId)
    const everyone = allRoles.find(r => String(r.id) === gId);
    if (everyone) console.log(`[PRIV DEBUG]   @everyone perms=${everyone.permissions}`);

    if (roleIds.length && allRoles.length) return hasPrivilege(roleIds, allRoles);
  } catch (_) {}

  return false;
}

module.exports = { isPrivileged, setOwner, getGuildRoles, hasPrivilege };
