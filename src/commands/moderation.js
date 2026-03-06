const { doModAction }                             = require('../utils/modAction');
const { createCase, getCasesByUser, getCaseById } = require('../utils/db');
const { sendLog }                                 = require('../utils/logger');
const { parseDuration, formatMs }                 = require('../utils/duration');

function resolveId(input) { return input ? input.replace(/[<@!>&]/g, '') : null; }
const reply = (api, channelId, text) => api.channels.createMessage(channelId, { content: text });

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
  async execute({ api, args, guildId, channelId, author, canTarget }) {
    if (!args[0]) return reply(api, channelId,
      '❌ **Usage:** `!ban <@user|ID> [reason]`\n**Example:** `!ban @User spamming`');
    const user = await fetchUser(api, args[0]);
    if (!user) return reply(api, channelId, '❌ User not found.\n**Usage:** `!ban <@user|ID> [reason]`');
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
    if (!member) return reply(api, channelId, '❌ Member not found.\n**Usage:** `!kick <@user|ID> [reason]`');
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
      '❌ **Usage:** `!warn <@user|ID> <reason>`\n**Example:** `!warn @User spamming`');
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return reply(api, channelId, '❌ Member not found.\n**Usage:** `!warn <@user|ID> <reason>`');
    const check = await canTarget(member.user.id);
    if (!check.ok) return reply(api, channelId, `❌ ${check.reason}`);
    const reason = args.slice(1).join(' ');
    if (!reason) return reply(api, channelId,
      '❌ A reason is required.\n**Usage:** `!warn <@user|ID> <reason>`');
    const entry = await createCase(guildId, {
      action: 'WARN', userId: member.user.id, userTag: member.user.username,
      modId: author.id, modTag: author.username, reason, auto: false
    });
    const warns = (await getCasesByUser(guildId, member.user.id)).filter(c => c.action === 'WARN').length;
    try {
      const dm = await api.users.createDM(member.user.id);
      await api.channels.createMessage(dm.id, {
        content: `⚠️ **Warning** received\nReason: ${reason}\nModerator: ${author.username}\nCase ID: ${entry.caseId}\nTotal warnings: ${warns}`
      });
    } catch (_) {}
    await sendLog(api, guildId, 'WARN', {
      'User': `${member.user.username} (${member.user.id})`,
      'Mod': author.username, 'Reason': reason,
      'Case': entry.caseId, 'Total warns': warns
    }, entry);
    return reply(api, channelId,
      `✅ **WARN** — \`${entry.caseId}\`\nUser: **${member.user.username}** (${warns} total warning${warns !== 1 ? 's' : ''})\nReason: ${reason}`);
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
    if (!member) return reply(api, channelId, '❌ Member not found.\n**Usage:** `!timeout <@user|ID> <duration> [reason]`');
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
    if (!member) return reply(api, channelId, '❌ Member not found.\n**Usage:** `!untimeout <@user|ID> [reason]`');
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
      '❌ **Usage:**\n`!case <ID>` — look up a case\n`!case history <@user|ID>` — user history\n**Example:** `!case CASE-0001` or `!case history @User`');

    if (args[0].toLowerCase() === 'history') {
      const userId = resolveId(args[1]);
      if (!userId) return reply(api, channelId,
        '❌ **Usage:** `!case history <@user|ID>`');
      const cases = await getCasesByUser(guildId, userId);
      if (!cases.length) return reply(api, channelId, `✅ No cases found for \`${userId}\`.`);
      const lines = cases.slice(0, 10).map(c =>
        `\`${c.case_id}\` **${c.action}**${c.auto ? ' [AUTO]' : ''} — ${c.reason} *(by ${c.mod_tag})*`
      );
      return reply(api, channelId,
        `📋 **Case History** — \`${userId}\` (${cases.length} total)\n${lines.join('\n')}${cases.length > 10 ? `\n_...and ${cases.length - 10} more_` : ''}`);
    }

    const c = await getCaseById(guildId, args[0].toUpperCase());
    if (!c) return reply(api, channelId,
      `❌ Case \`${args[0].toUpperCase()}\` not found.\n**Usage:** \`!case <ID>\` or \`!case history <@user|ID>\``);

    const durationLine = c.duration ? `\nDuration: **${c.duration}**` : '';
    return reply(api, channelId,
      `📋 **${c.case_id}** — ${c.action} ${c.auto ? '🤖 AUTO' : '👮 MANUAL'}\nUser: **${c.user_tag}** (\`${c.user_id}\`)\nModerator: **${c.mod_tag}**\nReason: ${c.reason}${durationLine}\nDate: ${new Date(c.created_at).toLocaleString()}`);
  }
};

module.exports = ban;
module.exports.extra = [kick, warn, unban, timeout, untimeout, caseCmd];
