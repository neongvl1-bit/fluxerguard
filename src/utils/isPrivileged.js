// Returneaza true daca userul are permisiuni privilegiate
// Foloseste API-urile corecte ale Fluxer

const PRIVILEGED_BITS = [
  8n,      // Administrator
  4n,      // Ban Members
  2n,      // Kick Members
  32n,     // Manage Messages
  32768n,  // Manage Roles
  16n,     // Manage Guild
  8192n,   // Manage Channels
];

// Cache ca sa nu facem request la fiecare mesaj
const cache = new Map(); // key: guildId:userId -> { result, ts }
const CACHE_TTL = 30000; // 30 secunde

async function isPrivileged(api, guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();

  // Returneaza din cache daca e proaspat
  if (cache.has(key)) {
    const { result, ts } = cache.get(key);
    if (now - ts < CACHE_TTL) return result;
  }

  try {
    // Ia member
    const member = await api.guilds.getMember(guildId, userId).catch(() => null);
    if (!member) {
      cache.set(key, { result: false, ts: now });
      return false;
    }

    // Ia rolurile serverului
    const allRoles = await api.guilds.getRoles(guildId).catch(() => []);
    const roles    = Array.isArray(allRoles) ? allRoles : (allRoles?.roles || []);
    const myRoleIds = new Set((member.roles || []).map(String));

    for (const role of roles) {
      // Everyone role (same id as guild) sau rolurile userului
      if (String(role.id) === String(guildId) || myRoleIds.has(String(role.id))) {
        try {
          const perms = BigInt(role.permissions || '0');
          for (const bit of PRIVILEGED_BITS) {
            if ((perms & bit) === bit) {
              cache.set(key, { result: true, ts: now });
              return true;
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  cache.set(key, { result: false, ts: now });
  return false;
}

module.exports = { isPrivileged };
