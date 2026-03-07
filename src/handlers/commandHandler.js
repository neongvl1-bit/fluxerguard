const fs   = require('fs');
const path = require('path');
const { getSettings } = require('../utils/db');

const commands = new Map();

// Incarca comenzile — fiecare fisier exporta un obiect principal + optional .extra[]
// Evitam dublurile: nu adaugam acelasi obiect de 2 ori
const cmdDir = path.join(__dirname, '../commands');
for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js'))) {
  const mod  = require(path.join(cmdDir, file));
  const list = mod.extra ? mod.extra : [mod]; // daca are .extra, folosim DOAR extra (include si principalul)
  // Daca are .extra, principalul e deja inclus in lista extra? Nu neaparat — adaugam tot
  const all  = mod.extra ? [mod, ...mod.extra] : [mod];
  // Deduplicare prin referinta
  const seen = new Set();
  for (const cmd of all) {
    if (!cmd || !cmd.name || seen.has(cmd)) continue;
    seen.add(cmd);
    const names = Array.isArray(cmd.names) ? cmd.names : [cmd.name];
    for (const name of names) commands.set(name.toLowerCase(), cmd);
    console.log(`[CMD] Loaded: ${names.join(', ')}`);
  }
}

function isOwner(userId) {
  return (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(userId);
}

// Calculeaza permisiunile unui user din rolurile sale
async function getPermBits(api, guildId, memberRoles) {
  try {
    const rolesData = await api.get(`/guilds/${guildId}/roles`);
    const allRoles  = Array.isArray(rolesData) ? rolesData : (rolesData?.roles || []);
    const myRoleIds = new Set((memberRoles || []).map(String));
    let perms = 0n;
    for (const role of allRoles) {
      if (String(role.id) === String(guildId) || myRoleIds.has(String(role.id))) {
        try { perms |= BigInt(role.permissions || '0'); } catch (_) {}
      }
    }
    return perms;
  } catch (_) { return 0n; }
}

// Returneaza "puterea" unui user: suma pozitiilor rolurilor sale (mai mare = mai puternic)
async function getRolePower(api, guildId, memberRoles) {
  try {
    const rolesData = await api.guilds.getRoles(guildId);
    const allRoles  = Array.isArray(rolesData) ? rolesData : [];
    const myRoleIds = new Set((memberRoles || []).map(String));
    let power = 0;
    for (const role of allRoles) {
      if (myRoleIds.has(String(role.id))) {
        power = Math.max(power, role.position || 0);
      }
    }
    return power;
  } catch (_) { return 0; }
}

async function memberHasPermission(api, guildId, message) {
  try {
    const member = message.member;

    // Varianta 1: permissions direct pe member din payload
    if (member?.permissions !== undefined && member?.permissions !== null) {
      try {
        const perms = BigInt(member.permissions);
        if ((perms & 8n) || (perms & 4n) || (perms & 2n) || (perms & 32n) || (perms & 268435456n))
          return true;
      } catch (_) {}
    }

    // Varianta 2: calculeaza din roluri
    const perms = await getPermBits(api, guildId, member?.roles);
    return !!(
      (perms & 8n) ||          // ADMINISTRATOR
      (perms & 4n) ||          // BAN_MEMBERS
      (perms & 2n) ||          // KICK_MEMBERS
      (perms & 32n) ||         // MANAGE_GUILD
      (perms & 268435456n)     // MANAGE_ROLES
    );
  } catch (err) {
    console.error('[PERMS ERROR]', err.message);
    return false;
  }
}

// Verifica daca autorul poate actiona asupra target-ului
// Reguli: nu poti actiona asupra ta insuti, nu poti actiona asupra owner-ului,
// nu poti actiona asupra cuiva cu rol mai mare sau egal cu al tau
async function canTarget(api, guildId, authorMessage, targetId) {
  // Nu poti actiona asupra ta insuti
  if (authorMessage.author.id === targetId) return { ok: false, reason: "You can't use this command on yourself." };

  // Nu poti actiona asupra owner-ului botului
  if (isOwner(targetId)) return { ok: false, reason: "You can't use this command on the bot owner." };

  // Fetch member-ul target
  const targetMember = await api.guilds.getMember(guildId, targetId).catch(() => null);
  if (!targetMember) return { ok: true }; // daca nu e in server (ex: unban), permite

  // Nu poti actiona asupra owner-ului serverului
  const { ownerCache } = require('./utils/cache');
  const ownerId = ownerCache.get ? ownerCache.get(String(guildId)) : null;
  if (ownerId && String(ownerId) === String(targetId)) {
    return { ok: false, reason: "You can't use this command on the server owner." };
  }

  // Nu poti actiona asupra unui user cu permisiuni privilegiate (admin, ban, kick, etc.)
  const { isPrivileged } = require('./utils/isPrivileged');
  if (await isPrivileged(api, guildId, targetId, targetMember.roles)) {
    return { ok: false, reason: "You can't use this command on someone with administrative permissions." };
  }

  return { ok: true };
}

async function handleMessage(api, message) {
  if (!message.guild_id || message.author?.bot) return;

  const settings = await getSettings(message.guild_id);
  const prefix   = settings?.prefix || process.env.DEFAULT_PREFIX || '!';

  if (!message.content?.startsWith(prefix)) return;

  const args    = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmdName = args.shift().toLowerCase();

  // ── DEBUG COMMANDS ────────────────────────────────────────────────────────

  if (cmdName === 'debugperms') {
    const info = { author_id: message.author?.id, member: message.member };
    console.log('[DEBUGPERMS]', JSON.stringify(info, null, 2));
    await api.channels.createMessage(message.channel_id, {
      content: '```json\n' + JSON.stringify(info, null, 2).slice(0, 1800) + '\n```'
    });
    return;
  }

  if (cmdName === 'debugroles') {
    try {
      const rolesData     = await api.get(`/guilds/${message.guild_id}/roles`);
      const allRoles      = Array.isArray(rolesData) ? rolesData : (rolesData?.roles || []);
      const memberRoleIds = new Set((message.member?.roles || []).map(r => String(r)));
      const lines = allRoles.map(r => {
        const mine = memberRoleIds.has(String(r.id)) ? '[YOU]' : '     ';
        return `${mine} ${r.name.padEnd(25)} ${r.permissions}`;
      });
      await api.channels.createMessage(message.channel_id, {
        content: `**Your roles:** ${[...memberRoleIds].join(', ') || '(none)'}\n\`\`\`\n${lines.join('\n').slice(0, 1500)}\n\`\`\``
      });
    } catch (err) {
      await api.channels.createMessage(message.channel_id, { content: `❌ debugroles error: \`${err.message}\`` });
    }
    return;
  }

  // ── COMENZI NORMALE ───────────────────────────────────────────────────────

  const cmd = commands.get(cmdName);
  if (!cmd) return;

  // Check permisiuni
  if (cmd.permissions && !isOwner(message.author.id)) {
    const allowed = await memberHasPermission(api, message.guild_id, message);
    if (!allowed) {
      await api.channels.createMessage(message.channel_id, {
        content: '❌ You need Administrator, Ban Members, Kick Members, or Manage Server to use this command.'
      });
      return;
    }
  }

  if (cmd.ownerOnly && !isOwner(message.author.id)) {
    await api.channels.createMessage(message.channel_id, { content: '❌ Bot owner only.' });
    return;
  }

  if (cmd.adminOnly && !isOwner(message.author.id)) {
    // Verifica daca e server owner sau are Administrator
    const isServerOwner = message.guild_id && message.member && message.author.id === (await api.guilds.get(message.guild_id).catch(() => ({}))).owner_id;
    let hasAdmin = false;
    try {
      const rolesData = await api.get('/guilds/' + message.guild_id + '/roles');
      const allRoles  = Array.isArray(rolesData) ? rolesData : (rolesData?.roles || []);
      const myRoleIds = new Set((message.member?.roles || []).map(String));
      for (const role of allRoles) {
        if (String(role.id) === String(message.guild_id) || myRoleIds.has(String(role.id))) {
          try { if ((BigInt(role.permissions || '0') & 8n) === 8n) { hasAdmin = true; break; } } catch (_) {}
        }
      }
    } catch (_) {}
    if (!isServerOwner && !hasAdmin) {
      await api.channels.createMessage(message.channel_id, {
        content: '❌ You need **Administrator** permission to use this command.'
      });
      return;
    }
  }

  try {
    await cmd.execute({
      api,
      message,
      args,
      guildId:   message.guild_id,
      channelId: message.channel_id,
      author:    message.author,
      canTarget: (targetId) => canTarget(api, message.guild_id, message, targetId),
    });
  } catch (err) {
    console.error(`[CMD ERROR] ${cmdName}:`, err.message);
    await api.channels.createMessage(message.channel_id, {
      content: `❌ Error: ${err.message}`
    }).catch(() => {});
  }
}

module.exports = { handleMessage };
