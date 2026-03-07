const { doModAction }                             = require('../utils/modAction');
const { createCase, getCasesByUser, getCaseById } = require('../utils/db');
const { sendLog }                                 = require('../utils/logger');
const { parseDuration, formatMs }                 = require('../utils/duration');
const E = require('../utils/embeds');

function resolveId(input) { return input ? input.replace(/[<#@!&>]/g, '') : null; }

const send = (api, channelId, body, msgId = null) => {
  const payload = typeof body === 'string' ? E.error('Error', body) : { ...body };
  if (msgId) payload.message_reference = { message_id: msgId };
  return api.channels.createMessage(channelId, payload);
};

async function fetchUser(api, input) {
  const id = resolveId(input);
  if (!id || !/^\d{10,20}$/.test(id)) return null;
  return api.users.get(id).catch(() => null);
}
async function fetchMember(api, guildId, input) {
  const id = resolveId(input);
  if (!id) return null;
  return api.guilds.getMember(guildId, id).catch(() => null);
}

// ── BAN ───────────────────────────────────────────────────────────────────────
const ban = { name: 'ban', names: ['ban'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    if (!args[0]) return send(api, channelId,
      E.error('Missing Arguments', 'Usage: `!ban <@user|ID> [reason]`\nExample: `!ban @User spamming`'), message.id);
    const user = await fetchUser(api, args[0]);
    if (!user) return send(api, channelId,
      E.error('User Not Found', 'Could not find that user.\nUsage: `!ban <@user|ID> [reason]`'), message.id);
    const check = await canTarget(user.id);
    if (!check.ok) return send(api, channelId, E.error('Action Denied', check.reason), message.id);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'BAN',
      targetUser: user, reason: args.slice(1).join(' ') || 'No reason provided', msgId: message.id });
  }
};

// ── KICK ──────────────────────────────────────────────────────────────────────
const kick = { name: 'kick', names: ['kick'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    if (!args[0]) return send(api, channelId,
      E.error('Missing Arguments', 'Usage: `!kick <@user|ID> [reason]`\nExample: `!kick @User rule violation`'), message.id);
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId,
      E.error('Member Not Found', 'That user is not in this server.\nUsage: `!kick <@user|ID> [reason]`'), message.id);
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, E.error('Action Denied', check.reason), message.id);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'KICK',
      targetUser: member.user, reason: args.slice(1).join(' ') || 'No reason provided', msgId: message.id });
  }
};

// ── WARN ──────────────────────────────────────────────────────────────────────
const warn = { name: 'warn', names: ['warn'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    if (!args[0]) return send(api, channelId,
      E.error('Missing Arguments', 'Usage: `!warn <@user|ID> <reason>`\nExample: `!warn @User spamming`'), message.id);
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId,
      E.error('Member Not Found', 'That user is not in this server.\nUsage: `!warn <@user|ID> <reason>`'), message.id);
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, E.error('Action Denied', check.reason), message.id);
    const reason = args.slice(1).join(' ');
    if (!reason) return send(api, channelId,
      E.error('Missing Reason', 'A reason is required for warnings.\nUsage: `!warn <@user|ID> <reason>`'), message.id);
    const entry = await createCase(guildId, {
      action: 'WARN', userId: member.user.id, userTag: member.user.username,
      modId: author.id, modTag: author.username, reason, auto: false,
    });
    const warns = (await getCasesByUser(guildId, member.user.id)).filter(c => c.action === 'WARN').length;
    try {
      const dm = await api.users.createDM(member.user.id);
      await api.channels.createMessage(dm.id, E.modDM('WARN', 'this server', reason, entry.caseId, author.username, null));
    } catch (_) {}
    await sendLog(api, guildId, 'WARN', {
      'User': `${member.user.username} (${member.user.id})`,
      'Moderator': author.username, 'Reason': reason,
      'Case': entry.caseId, 'Total Warnings': warns,
    }, entry);
    return send(api, channelId, E.warnConfirm(member.user, reason, entry.caseId, warns), message.id);
  }
};

// ── UNBAN ─────────────────────────────────────────────────────────────────────
const unban = { name: 'unban', names: ['unban'], permissions: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    if (!args[0]) return send(api, channelId,
      E.error('Missing Arguments', 'Usage: `!unban <userID> [reason]`\nExample: `!unban 123456789012345678 appeal accepted`'), message.id);
    if (!/^\d{10,20}$/.test(args[0])) return send(api, channelId,
      E.error('Invalid ID', 'Please provide a valid numeric user ID.\nUsage: `!unban <userID> [reason]`'), message.id);
    const user = await api.users.get(args[0]).catch(() => null);
    if (!user) return send(api, channelId, E.error('User Not Found', 'Could not find a user with that ID.'), message.id);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'UNBAN',
      targetUser: user, reason: args.slice(1).join(' ') || 'No reason provided', msgId: message.id });
  }
};

// ── TIMEOUT ───────────────────────────────────────────────────────────────────
const timeout = { name: 'timeout', names: ['timeout', 'mute'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    if (!args[0]) return send(api, channelId,
      E.error('Missing Arguments', 'Usage: `!timeout <@user|ID> <duration> [reason]`\nDurations: `30s` `10m` `2h` `1d`\nExample: `!timeout @User 1h spamming`'), message.id);
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId,
      E.error('Member Not Found', 'That user is not in this server.\nUsage: `!timeout <@user|ID> <duration> [reason]`'), message.id);
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, E.error('Action Denied', check.reason), message.id);
    if (!args[1]) return send(api, channelId,
      E.error('Missing Duration', 'A duration is required.\nValid formats: `30s` `10m` `2h` `1d` *(max 28d)*'), message.id);
    const parsed = parseDuration(args[1]);
    if (!parsed) return send(api, channelId,
      E.error('Invalid Duration', `\`${args[1]}\` is not a valid duration.\nValid formats: \`30s\` \`10m\` \`2h\` \`1d\` *(max 28d)*`), message.id);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'TIMEOUT',
      targetUser: member.user, reason: args.slice(2).join(' ') || 'No reason provided',
      duration: formatMs(parsed.ms), durationMs: parsed.ms, msgId: message.id });
  }
};

// ── UNTIMEOUT ─────────────────────────────────────────────────────────────────
const untimeout = { name: 'untimeout', names: ['untimeout', 'unmute'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    if (!args[0]) return send(api, channelId,
      E.error('Missing Arguments', 'Usage: `!untimeout <@user|ID> [reason]`\nExample: `!untimeout @User appeal accepted`'), message.id);
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId,
      E.error('Member Not Found', 'That user is not in this server.'), message.id);
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, E.error('Action Denied', check.reason), message.id);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'UNTIMEOUT',
      targetUser: member.user, reason: args.slice(1).join(' ') || 'Timeout removed', msgId: message.id });
  }
};

// ── CASE ──────────────────────────────────────────────────────────────────────
const caseCmd = { name: 'case', names: ['case'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    if (!args[0]) return send(api, channelId,
      E.error('Missing Arguments', 'Usage:\n`!case <ID>` — look up a case\n`!case history <@user|ID>` — view history\nExample: `!case CASE-1001`'), message.id);
    if (args[0].toLowerCase() === 'history') {
      const userId = resolveId(args[1]);
      if (!userId) return send(api, channelId,
        E.error('Missing User', 'Usage: `!case history <@user|ID>`'), message.id);
      const cases = await getCasesByUser(guildId, userId);
      if (!cases.length) return send(api, channelId,
        E.success('No Cases Found', `No cases on record for \`${userId}\`.`), message.id);
      return send(api, channelId, E.caseHistory(userId, cases), message.id);
    }
    const c = await getCaseById(guildId, args[0].toUpperCase());
    if (!c) return send(api, channelId,
      E.error('Case Not Found', `No case found with ID \`${args[0].toUpperCase()}\`.\nUsage: \`!case <ID>\` or \`!case history <@user|ID>\``), message.id);
    return send(api, channelId, E.caseEmbed(c), message.id);
  }
};

module.exports = ban;
module.exports.extra = [kick, warn, unban, timeout, untimeout, caseCmd];
