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

const ALLOWED_BITS = [
  8n, 4n, 2n, 32n, 268435456n, 8192n, 16n,
];

function checkBits(permsStr) {
  try {
    const p = BigInt(permsStr || '0');
    for (const bit of ALLOWED_BITS) {
      if ((p & bit) === bit) return true;
    }
  } catch (_) {}
  return false;
}

async function memberHasPermission(api, guildId, message) {
  const userId = String(message.author?.id || '');
  const member = message.member;

  // 1. Bot owner — acces total
  if (isOwner(userId)) return true;

  // 2. Server owner — fetch guild
  try {
    const guild = await api.guilds.get(guildId);
    if (guild?.owner_id && String(guild.owner_id) === userId) return true;
  } catch (e) { console.error('[PERMS] guild fetch error:', e.message); }

  // 3. permissions pe member din MESSAGE_CREATE payload (cel mai rapid)
  if (member?.permissions != null) {
    if (checkBits(String(member.permissions))) return true;
  }

  // 4. Fetch member fresh
  try {
    const freshMember = await api.guilds.getMember(guildId, userId);

    if (freshMember?.permissions != null) {
      if (checkBits(String(freshMember.permissions))) return true;
    }

    // 5. Calculeaza din roluri (fallback daca getRoles merge pe Fluxer)
    const roleIds = freshMember?.roles || member?.roles || [];
    if (roleIds.length) {
      const perms = await getPermBits(api, guildId, roleIds);
        if (checkBits(String(perms))) return true;
    }
  } catch (e) { console.error('[PERMS] getMember error:', e.message); }

  return false;
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
  const { ownerCache } = require('../utils/cache');
  const ownerId = ownerCache.get ? ownerCache.get(String(guildId)) : null;
  if (ownerId && String(ownerId) === String(targetId)) {
    return { ok: false, reason: "You can't use this command on the server owner." };
  }

  // Nu poti actiona asupra unui user cu permisiuni privilegiate (admin, ban, kick, etc.)
  const { isPrivileged } = require('../utils/isPrivileged');
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

  // ── COMENZI NORMALE ───────────────────────────────────────────────────────

  const cmd = commands.get(cmdName);
  if (!cmd) return;

  // Check permisiuni
  if (cmd.permissions && !isOwner(message.author.id)) {
    const allowed = await memberHasPermission(api, message.guild_id, message);
    if (!allowed) {
      await api.channels.replyMessage(message.channel_id, message.id, {
        content: '❌ You need Administrator, Ban Members, Kick Members, or Manage Server to use this command.'
      });
      return;
    }
  }

  if (cmd.ownerOnly && !isOwner(message.author.id)) {
    return; // stealth
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
      await api.channels.replyMessage(message.channel_id, message.id, {
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
    await api.channels.replyMessage(message.channel_id, message.id, {
      content: `❌ Error: ${err.message}`
    }).catch(() => {});
  }
}

module.exports = { handleMessage };
