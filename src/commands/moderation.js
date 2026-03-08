const { doModAction }                             = require('../utils/modAction');
const { createCase, getCasesByUser, getCaseById, deleteCase } = require('../utils/db');
const { sendLog }                                 = require('../utils/logger');
const { parseDuration, formatMs }                 = require('../utils/duration');
const E = require('../utils/embeds');

function resolveId(input) { return input ? input.replace(/[<#@!&>]/g, '') : null; }

const send = (api, channelId, midOrBody, body) => {
  const mid     = body !== undefined ? midOrBody : null;
  const content = body !== undefined ? body : midOrBody;
  const payload = typeof content === 'string' ? E.error('Error', content) : { ...content };
  if (mid) return api.channels.replyMessage(channelId, mid, payload);
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
    const mid = message?.id;
    if (!args[0]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage: `!ban <@user|ID> [reason]`\nExample: `!ban @User spamming`'));
    const user = await fetchUser(api, args[0]);
    if (!user) return send(api, channelId, mid,
      E.error('User Not Found', 'Could not find that user.\nUsage: `!ban <@user|ID> [reason]`'));
    const check = await canTarget(user.id);
    if (!check.ok) return send(api, channelId, mid, E.error('Action Denied', check.reason));
    try {
      await doModAction({ api, guildId, channelId, modUser: author, action: 'BAN',
      targetUser: user, reason: args.slice(1).join(' ') || 'No reason provided' });
    } catch (err) {
      return send(api, channelId, mid, E.error('Action Failed', err.message || 'Could not perform this action.'));
    }
  }
};

// ── KICK ──────────────────────────────────────────────────────────────────────
const kick = { name: 'kick', names: ['kick'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    const mid = message?.id;
    if (!args[0]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage: `!kick <@user|ID> [reason]`\nExample: `!kick @User rule violation`'));
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId, mid,
      E.error('Member Not Found', 'That user is not in this server.\nUsage: `!kick <@user|ID> [reason]`'));
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, mid, E.error('Action Denied', check.reason));
    try {
      await doModAction({ api, guildId, channelId, modUser: author, action: 'KICK',
      targetUser: member.user, reason: args.slice(1).join(' ') || 'No reason provided' });
    } catch (err) {
      return send(api, channelId, mid, E.error('Action Failed', err.message || 'Could not perform this action.'));
    }
  }
};

// ── WARN ──────────────────────────────────────────────────────────────────────
const warn = { name: 'warn', names: ['warn'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    const mid = message?.id;
    if (!args[0]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage: `!warn <@user|ID> <reason>`\nExample: `!warn @User spamming`'));
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId, mid,
      E.error('Member Not Found', 'That user is not in this server.\nUsage: `!warn <@user|ID> <reason>`'));
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, mid, E.error('Action Denied', check.reason));
    const reason = args.slice(1).join(' ');
    if (!reason) return send(api, channelId, mid,
      E.error('Missing Reason', 'A reason is required for warnings.\nUsage: `!warn <@user|ID> <reason>`'));
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
    return send(api, channelId, mid, E.warnConfirm(member.user, reason, entry.caseId, warns));
  }
};

// ── UNBAN ─────────────────────────────────────────────────────────────────────
const unban = { name: 'unban', names: ['unban'], permissions: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    const mid = message?.id;
    if (!args[0]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage: `!unban <userID> [reason]`\nExample: `!unban 123456789012345678 appeal accepted`'));
    if (!/^\d{10,20}$/.test(args[0])) return send(api, channelId, mid,
      E.error('Invalid ID', 'Please provide a valid numeric user ID.\nUsage: `!unban <userID> [reason]`'));
    const user = await api.users.get(args[0]).catch(() => null);
    if (!user) return send(api, channelId, mid, E.error('User Not Found', 'Could not find a user with that ID.'));
    try {
      await doModAction({ api, guildId, channelId, modUser: author, action: 'UNBAN',
      targetUser: user, reason: args.slice(1).join(' ') || 'No reason provided' });
    } catch (err) {
      return send(api, channelId, mid, E.error('Action Failed', err.message || 'Could not perform this action.'));
    }
  }
};

// ── TIMEOUT ───────────────────────────────────────────────────────────────────
const timeout = { name: 'timeout', names: ['timeout', 'mute'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    const mid = message?.id;
    if (!args[0]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage: `!timeout <@user|ID> <duration> [reason]`\nDurations: `30s` `10m` `2h` `1d`\nExample: `!timeout @User 1h spamming`'));
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId, mid,
      E.error('Member Not Found', 'That user is not in this server.\nUsage: `!timeout <@user|ID> <duration> [reason]`'));
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, mid, E.error('Action Denied', check.reason));
    if (!args[1]) return send(api, channelId, mid,
      E.error('Missing Duration', 'A duration is required.\nValid formats: `30s` `10m` `2h` `1d` *(max 28d)*'));
    const parsed = parseDuration(args[1]);
    if (!parsed) return send(api, channelId, mid,
      E.error('Invalid Duration', `\`${args[1]}\` is not a valid duration.\nValid formats: \`30s\` \`10m\` \`2h\` \`1d\` *(max 28d)*`));
    try {
      await doModAction({ api, guildId, channelId, modUser: author, action: 'TIMEOUT',
      targetUser: member.user, reason: args.slice(2).join(' ') || 'No reason provided',
      duration: formatMs(parsed.ms), durationMs: parsed.ms });
    } catch (err) {
      const is403 = err.message?.includes('403');
      return send(api, channelId, mid, E.error(
        is403 ? 'Not Supported' : 'Action Failed',
        is403 ? 'Timeout is not yet fully supported on Fluxer. Please check back later.' : (err.message || 'Could not perform this action.')
      ));
    }
  }
};

// ── UNTIMEOUT ─────────────────────────────────────────────────────────────────
const untimeout = { name: 'untimeout', names: ['untimeout', 'unmute'], permissions: true,
  async execute({ api, args, guildId, channelId, author, canTarget, message }) {
    const mid = message?.id;
    if (!args[0]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage: `!untimeout <@user|ID> [reason]`\nExample: `!untimeout @User appeal accepted`'));
    const member = await fetchMember(api, guildId, args[0]);
    if (!member) return send(api, channelId, mid,
      E.error('Member Not Found', 'That user is not in this server.'));
    const check = await canTarget(member.user.id);
    if (!check.ok) return send(api, channelId, mid, E.error('Action Denied', check.reason));
    const isTimedOut = member.communication_disabled_until &&
      new Date(member.communication_disabled_until) > new Date();
    if (!isTimedOut) return send(api, channelId, mid,
      E.error('Not Timed Out', 'That user does not have an active timeout.'));
    try {
      await doModAction({ api, guildId, channelId, modUser: author, action: 'UNTIMEOUT',
      targetUser: member.user, reason: args.slice(1).join(' ') || 'Timeout removed' });
    } catch (err) {
      return send(api, channelId, mid, E.error('Action Failed', err.message || 'Could not perform this action.'));
    }
  }
};

// ── CASE ──────────────────────────────────────────────────────────────────────
const caseCmd = { name: 'case', names: ['case'], permissions: true,
  async execute({ api, args, guildId, channelId, message }) {
    const mid = message?.id;
    if (!args[0]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage:\n`!case <ID>` — look up a case\n`!case history <@user|ID>` — view history\nExample: `!case CASE-1001`'));
    if (args[0].toLowerCase() === 'history') {
      const userId = resolveId(args[1]);
      if (!userId) return send(api, channelId, mid,
        E.error('Missing User', 'Usage: `!case history <@user|ID>`'));
      const cases = await getCasesByUser(guildId, userId);
      if (!cases.length) return send(api, channelId, mid,
        E.success('No Cases Found', `No cases on record for \`${userId}\`.`));
      return send(api, channelId, mid, E.caseHistory(userId, cases));
    }
    const c = await getCaseById(guildId, args[0].toUpperCase());
    if (!c) return send(api, channelId, mid,
      E.error('Case Not Found', `No case found with ID \`${args[0].toUpperCase()}\`.\nUsage: \`!case <ID>\` or \`!case history <@user|ID>\``));
    return send(api, channelId, mid, E.caseEmbed(c));
  }
};

module.exports = ban;

// ── DELWARN ───────────────────────────────────────────────────────────────────
const delwarn = { name: 'delwarn', names: ['delwarn', 'deletewarn', 'unwarn'], permissions: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    const mid = message?.id;
    if (!args[0] || !args[1]) return send(api, channelId, mid,
      E.error('Missing Arguments', 'Usage: `!delwarn <@user|ID> <caseID>`\nExample: `!delwarn @User CASE-1001`\nUse `!case history @user` to find the case ID.'));

    const userId = resolveId(args[0]);
    if (!userId) return send(api, channelId, mid,
      E.error('Invalid User', 'Usage: `!delwarn <@user|ID> <caseID>`'));

    const caseId = args[1].toUpperCase();

    // Verifica ca exista si e un WARN al userului
    const entry = await getCaseById(guildId, caseId);
    if (!entry) return send(api, channelId, mid,
      E.error('Case Not Found', `No case found with ID **${caseId}**.\nUse \`!case history @user\` to see all cases.`));

    if (entry.action !== 'WARN') return send(api, channelId, mid,
      E.error('Not a Warning', `Case **${caseId}** is a **${entry.action}**, not a WARN.\nThis command only deletes warnings.`));

    if (entry.user_id !== userId) return send(api, channelId, mid,
      E.error('User Mismatch', `Case **${caseId}** does not belong to that user.`));

    // Sterge din DB
    const deleted = await deleteCase(guildId, caseId);
    if (!deleted) return send(api, channelId, mid,
      E.error('Failed', `Could not delete case **${caseId}**. Please try again.`));

    // Numara warns ramase
    const remaining = (await getCasesByUser(guildId, userId)).filter(c => c.action === 'WARN').length;

    await sendLog(api, guildId, 'DELWARN', {
      'User':      `${entry.user_tag} (${userId})`,
      'Case':      caseId,
      'Reason':    entry.reason,
      'Deleted by': `${author.username} (${author.id})`,
      'Remaining Warns': String(remaining),
    }, { caseId, action: 'DELWARN' });

    return send(api, channelId, mid,
      E.success('Warning Deleted', `Warning **${caseId}** has been removed from **${entry.user_tag}**.\n*Remaining warnings: **${remaining}***`));
  }
};

module.exports.extra = [kick, warn, unban, timeout, untimeout, caseCmd, delwarn];

// ── CLEAR ─────────────────────────────────────────────────────────────────────
const clear = { name: 'clear', names: ['clear', 'purge'], permissions: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    const mid = message?.id;

    const amount = parseInt(args[0]);
    if (!args[0] || isNaN(amount) || amount < 1 || amount > 100)
      return send(api, channelId, mid,
        E.error('Invalid Amount', 'Usage: `!clear <1-100>`\nExample: `!clear 10`\nYou can delete between **1** and **100** messages at once.'));

    // Fetch messages
    let messages;
    try {
      const fetchLimit = Math.min(amount + 1, 100);
      messages = await api.channels.getMessages(channelId, { limit: fetchLimit });
    } catch (err) {
      return send(api, channelId, mid,
        E.error('Failed to Fetch', `Could not fetch messages: ${err.message}`));
    }

    if (!Array.isArray(messages) || messages.length === 0)
      return send(api, channelId, mid,
        E.error('No Messages', 'No messages found to delete.'));

    // Exclude comanda proprie daca e in lista
    const toDelete = messages
      .filter(m => m.id !== mid)
      .slice(0, amount)
      .map(m => m.id);

    if (toDelete.length === 0)
      return send(api, channelId, mid,
        E.error('No Messages', 'No messages found to delete.'));

    let deleted = 0;

    // Incearca bulk delete intai
    if (toDelete.length > 1) {
      try {
        await api.channels.bulkDeleteMessages(channelId, { messages: toDelete });
        deleted = toDelete.length;
      } catch (_) {
        // Bulk delete nu e suportat — fallback la delete individual
        for (const msgId of toDelete) {
          try {
            await api.channels.deleteMessage(channelId, msgId);
            deleted++;
            await new Promise(r => setTimeout(r, 300));
          } catch (_) {}
        }
      }
    } else {
      try {
        await api.channels.deleteMessage(channelId, toDelete[0]);
        deleted = 1;
      } catch (err) {
        return send(api, channelId, mid,
          E.error('Failed to Delete', `Could not delete message: ${err.message}`));
      }
    }

    // Sterge si comanda originala
    if (mid) api.channels.deleteMessage(channelId, mid).catch(() => {});

    // Confirmare temporara (dispare dupa 4s)
    const confirm = await send(api, channelId,
      E.success('Messages Cleared', `Successfully deleted **${deleted}** message${deleted !== 1 ? 's' : ''} in this channel.\n*Cleared by ${author.username}*`));
    if (confirm?.id) {
      setTimeout(() => api.channels.deleteMessage(channelId, confirm.id).catch(() => {}), 4000);
    }

    await sendLog(api, guildId, 'CLEAR', {
      'Channel':          `<#${channelId}> (${channelId})`,
      'Messages Deleted': String(deleted),
      'Cleared by':       `${author.username} (${author.id})`,
    }, { caseId: null, action: 'CLEAR' });
  }
};

module.exports.extra.push(clear);
