const { doModAction }                             = require('../utils/modAction');
const { createCase, getCasesByUser, getCaseById } = require('../utils/db');
const { sendLog }                                 = require('../utils/logger');
const { parseDuration, formatMs }                 = require('../utils/duration');

function resolveId(input) { return input ? input.replace(/[<@!>&]/g, '') : null; }
const reply = (api, channelId, content) =>
  api.channels.createMessage(channelId, typeof content === 'string' ? { content } : content);

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

const COLORS = { BAN: 0xed4245, KICK: 0xff9a3c, WARN: 0xfee75c, TIMEOUT: 0x5b9bd5, UNBAN: 0x57f287, UNTIMEOUT: 0x57f287 };

// ── BAN ───────────────────────────────────────────────────────────────────────
const ban = { name: 'ban', names: ['ban'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:** `!ban <@user|ID> [reason]`\n**Example:** `!ban @User spamming`');
    const user = await fetchUser(api, args[0]);
    if (!user) return reply(api, channelId,
      '❌ User not found.\n**Usage:** `!ban <@user|ID> [reason]`');
    const check = await canTarget(user.id);
    if (!check.ok) return reply(api, channelId, `❌ ${check.reason}`);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'BAN',
      targetUser: user, reason: args.slice(1).join(' ') || 'No reason provided' });
  }
};

// ── KICK ──────────────────────────────────────────────────────────────────────
const kick = { name: 'kick', names: ['kick'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:** `!kick <@user|ID> [reason]`\n**Example:** `!kick @User rule violation`');
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return reply(api, channelId,
      '❌ Member not found. Make sure the user is in this server.\n**Usage:** `!kick <@user|ID> [reason]`');
    const check = await canTarget(member.user.id);
    if (!check.ok) return reply(api, channelId, `❌ ${check.reason}`);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'KICK',
      targetUser: member.user, reason: args.slice(1).join(' ') || 'No reason provided' });
  }
};

// ── WARN ──────────────────────────────────────────────────────────────────────
const warn = { name: 'warn', names: ['warn'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:** `!warn <@user|ID> <reason>`\n**Example:** `!warn @User spamming in chat`');
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return reply(api, channelId,
      '❌ Member not found.\n**Usage:** `!warn <@user|ID> <reason>`');
    const check = await canTarget(member.user.id);
    if (!check.ok) return reply(api, channelId, `❌ ${check.reason}`);
    const reason = args.slice(1).join(' ');
    if (!reason) return reply(api, channelId,
      '❌ A reason is required.\n**Usage:** `!warn <@user|ID> <reason>`');
    const entry = await createCase(guildId, { action: 'WARN', userId: member.user.id,
      userTag: member.user.username, modId: author.id, modTag: author.username, reason, auto: false });
    const warns = (await getCasesByUser(guildId, member.user.id)).filter(c => c.action === 'WARN').length;
    try {
      const dm = await api.users.createDM(member.user.id);
      await api.channels.createMessage(dm.id, { embeds: [{ color: 0xfee75c,
        title: '⚠️ You received a warning',
        fields: [{ name: 'Reason', value: reason },
          { name: 'Moderator', value: author.username, inline: true },
          { name: 'Case ID', value: entry.caseId, inline: true },
          { name: 'Total Warnings', value: `${warns}`, inline: true }],
        timestamp: new Date().toISOString() }] });
    } catch (_) {}
    await sendLog(api, guildId, 'WARN', { 'User': `${member.user.username} (${member.user.id})`,
      'Mod': author.username, 'Reason': reason, 'Case': entry.caseId }, entry);
    return reply(api, channelId, { embeds: [{ color: 0xfee75c,
      title: `✅ WARN — ${entry.caseId}`,
      fields: [{ name: 'User', value: member.user.username, inline: true },
        { name: 'Total Warnings', value: `${warns}`, inline: true },
        { name: 'Reason', value: reason },
        { name: 'Case ID', value: entry.caseId, inline: true }],
      timestamp: new Date().toISOString() }] });
  }
};

// ── UNBAN ─────────────────────────────────────────────────────────────────────
const unban = { name: 'unban', names: ['unban'], permissions: true,
  async execute({ api, args, guildId, channelId, author }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:** `!unban <userID> [reason]`\n**Example:** `!unban 123456789012345678 appeal accepted`');
    if (!/^\d{10,20}$/.test(args[0])) return reply(api, channelId,
      '❌ Invalid ID. Provide a numeric user ID.\n**Usage:** `!unban <userID> [reason]`');
    const user = await api.users.get(args[0]).catch(() => null);
    if (!user) return reply(api, channelId, '❌ User not found.');
    await doModAction({ api, guildId, channelId, modUser: author, action: 'UNBAN',
      targetUser: user, reason: args.slice(1).join(' ') || 'No reason provided' });
  }
};

// ── TIMEOUT / MUTE ────────────────────────────────────────────────────────────
const timeout = { name: 'timeout', names: ['timeout', 'mute'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:** `!timeout <@user|ID> <duration> [reason]`\n**Durations:** `30s` `10m` `2h` `1d`\n**Example:** `!timeout @User 1h spamming`');
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return reply(api, channelId,
      '❌ Member not found.\n**Usage:** `!timeout <@user|ID> <duration> [reason]`');
    const check = await canTarget(member.user.id);
    if (!check.ok) return reply(api, channelId, `❌ ${check.reason}`);
    if (!args[1]) return reply(api, channelId,
      '❌ Duration is required.\n**Usage:** `!timeout <@user|ID> <duration> [reason]`\n**Valid:** `30s` `10m` `2h` `1d` (max 28d)');
    const parsed = parseDuration(args[1]);
    if (!parsed) return reply(api, channelId,
      `❌ Invalid duration \`${args[1]}\`.\n**Valid formats:** \`30s\` \`10m\` \`2h\` \`1d\` (max 28d)`);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'TIMEOUT',
      targetUser: member.user, reason: args.slice(2).join(' ') || 'No reason provided',
      duration: formatMs(parsed.ms), durationMs: parsed.ms });
  }
};

// ── UNTIMEOUT / UNMUTE ────────────────────────────────────────────────────────
const untimeout = { name: 'untimeout', names: ['untimeout', 'unmute'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:** `!untimeout <@user|ID> [reason]`\n**Example:** `!untimeout @User appeal accepted`');
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return reply(api, channelId,
      '❌ Member not found.\n**Usage:** `!untimeout <@user|ID> [reason]`');
    const check = await canTarget(member.user.id);
    if (!check.ok) return reply(api, channelId, `❌ ${check.reason}`);
    await doModAction({ api, guildId, channelId, modUser: author, action: 'UNTIMEOUT',
      targetUser: member.user, reason: args.slice(1).join(' ') || 'Timeout removed' });
  }
};

// ── CASE ──────────────────────────────────────────────────────────────────────
const caseCmd = { name: 'case', names: ['case'], permissions: true,
  async execute({ api, args, guildId, channelId }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:**\n`!case <ID>` — look up a case\n`!case history <@user|ID>` — view user history\n**Example:** `!case G-0001` or `!case history @User`');
    if (args[0].toLowerCase() === 'history') {
      const userId = resolveId(args[1]);
      if (!userId) return reply(api, channelId,
        '❌ **Usage:** `!case history <@user|ID>`\n**Example:** `!case history @User`');
      const cases = await getCasesByUser(guildId, userId);
      if (!cases.length) return reply(api, channelId, `✅ No cases found for \`${userId}\`.`);
      return reply(api, channelId, { embeds: [{ color: 0x5865f2,
        title: `📋 Case History — ${userId}`,
        description: `**${cases.length}** total case(s)`,
        fields: cases.slice(0, 10).map(c => ({
          name: `${c.case_id} — ${c.action}${c.auto ? ' [AUTO]' : ''}`,
          value: `**Reason:** ${c.reason}\n**By:** ${c.mod_tag} | **Date:** ${new Date(c.created_at).toLocaleDateString()}` })),
        footer: { text: cases.length > 10 ? `Showing last 10 of ${cases.length}` : '' },
        timestamp: new Date().toISOString() }] });
    }
    const c = await getCaseById(guildId, args[0].toUpperCase());
    if (!c) return reply(api, channelId,
      `❌ Case \`${args[0].toUpperCase()}\` not found.\n**Usage:** \`!case <ID>\` or \`!case history <@user|ID>\``);
    return reply(api, channelId, { embeds: [{ color: COLORS[c.action] || 0x5865f2,
      title: `📋 ${c.case_id} — ${c.action}`,
      fields: [{ name: 'User', value: `${c.user_tag} (${c.user_id})`, inline: true },
        { name: 'Moderator', value: c.mod_tag, inline: true },
        { name: 'Type', value: c.auto ? '🤖 AUTO' : '👮 MANUAL', inline: true },
        { name: 'Reason', value: c.reason },
        { name: 'Date', value: new Date(c.created_at).toLocaleString(), inline: true },
        ...(c.duration ? [{ name: 'Duration', value: c.duration, inline: true }] : [])],
      timestamp: new Date().toISOString() }] });
  }
};

// Exportam doar extra — ban e deja inclus ca primul element
module.exports = ban;
module.exports.extra = [kick, warn, unban, timeout, untimeout, caseCmd];
