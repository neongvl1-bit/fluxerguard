const { getSettings, updateSettings, getThreatStats, addNote, getNotes, deleteNote } = require('../utils/db');
const E = require('../utils/embeds');

function resolveId(i) { return i ? i.replace(/[<#@!&>]/g, '') : null; }
const send = (api, channelId, midOrBody, body) => {
  const mid     = body !== undefined ? midOrBody : null;
  const content = body !== undefined ? body : midOrBody;
  const payload = typeof content === 'string' ? E.error('Error', content) : { ...content };
  if (mid) return api.channels.replyMessage(channelId, mid, payload);
  return api.channels.createMessage(channelId, payload);
};

// ── GUARDIAN LEVEL ────────────────────────────────────────────────────────────
function calcGuardianLevel(g) {
  let score = 0;
  const checks = [];

  if (g.log_channel) {
    score += 15;
    checks.push({ name: '✅ Log Channel', value: 'Configured', inline: true });
  } else {
    checks.push({ name: '❌ Log Channel', value: 'Not set — use `!setlog`', inline: true });
  }

  if (g.antiraid_enabled) {
    score += (g.antiraid_action === 'ban' ? 20 : g.antiraid_action === 'kick' ? 18 : 10);
    checks.push({ name: '✅ AntiRaid', value: `Active — action: **${g.antiraid_action}**`, inline: true });
  } else {
    checks.push({ name: '❌ AntiRaid', value: 'Disabled', inline: true });
  }

  if (g.antinuke_enabled) {
    score += 25;
    checks.push({ name: '✅ AntiNuke', value: `Active — threshold: **${g.antinuke_threshold}**`, inline: true });
  } else {
    checks.push({ name: '❌ AntiNuke', value: 'Disabled', inline: true });
  }

  if (g.antispam_enabled) {
    score += 15;
    checks.push({ name: '✅ AntiSpam', value: `Active — action: **${g.antispam_action}**`, inline: true });
  } else {
    checks.push({ name: '❌ AntiSpam', value: 'Disabled', inline: true });
  }

  if (g.antiflood_enabled) {
    score += 10;
    checks.push({ name: '✅ AntiFlood', value: 'Active', inline: true });
  } else {
    checks.push({ name: '❌ AntiFlood', value: 'Disabled', inline: true });
  }

  if (g.prefix !== '!') {
    score += 5;
    checks.push({ name: '✅ Custom Prefix', value: `\`${g.prefix}\``, inline: true });
  }

  const level = score >= 90 ? 5 : score >= 70 ? 4 : score >= 50 ? 3 : score >= 30 ? 2 : score >= 10 ? 1 : 0;

  let tip = '';
  if (!g.log_channel)                     tip = 'Set a log channel with `!setlog` to track all actions.';
  else if (!g.antinuke_enabled)           tip = 'Enable AntiNuke — it protects against mass channel/role deletion.';
  else if (g.antiraid_action === 'alert') tip = 'Consider setting AntiRaid action to `kick` or `ban` for automatic protection.';
  else if (score < 90)                    tip = 'Enable all modules and set a log channel for maximum protection.';

  if (tip) checks.push({ name: '💡 Recommendation', value: tip, inline: false });

  return { level, score: Math.min(score, 100), checks };
}

const guardian = { name: 'guardian', names: ['guardian', 'security', 'level'], permissions: false,
  async execute({ api, guildId, channelId }) {
    const g = await getSettings(guildId);
    const { level, score, checks } = calcGuardianLevel(g);
    return send(api, channelId, mid, E.guardianLevelEmbed(level, score, checks));
  }
};

// ── THREAT LOG ────────────────────────────────────────────────────────────────
const threatlog = { name: 'threatlog', names: ['threatlog', 'threats', 'stats'], permissions: true,
  async execute({ api, guildId, channelId }) {
    const allStats = await getThreatStats(guildId, 4);
    if (!allStats.length) return send(api, channelId,
      E.info('No Data Yet', 'No threats have been logged yet. Stats are tracked weekly starting from now.'));
    for (const week of allStats) {
      await send(api, channelId, mid, E.threatLogEmbed(week));
    }
  }
};

// ── LOCKDOWN ──────────────────────────────────────────────────────────────────
const lockdown = { name: 'lockdown', names: ['lockdown'], permissions: true, adminOnly: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    const g = await getSettings(guildId);
    if (g.lockdown_enabled) return send(api, channelId,
      E.error('Already Active', 'Server is already in lockdown. Use `!unlockdown` to lift it.'));
    const reason = args.join(' ') || 'Emergency lockdown';
    await updateSettings(guildId, { lockdown_enabled: true, lockdown_reason: reason, lockdown_mod: author.username });
    const updated = await getSettings(guildId);
    if (updated.log_channel) api.channels.createMessage(updated.log_channel, E.lockdownEmbed(true, reason, author.username)).catch(() => {});
    console.log(`[LOCKDOWN] Activated in ${guildId} by ${author.username}`);
    return send(api, channelId, mid, E.lockdownEmbed(true, reason, author.username));
  }
};

const unlockdown = { name: 'unlockdown', names: ['unlockdown'], permissions: true, adminOnly: true,
  async execute({ api, guildId, channelId, author }) {
    const g = await getSettings(guildId);
    if (!g.lockdown_enabled) return send(api, channelId,
      E.error('Not Active', 'Server is not currently in lockdown.'));
    await updateSettings(guildId, { lockdown_enabled: false, lockdown_reason: null, lockdown_mod: null });
    const updated = await getSettings(guildId);
    if (updated.log_channel) api.channels.createMessage(updated.log_channel, E.lockdownEmbed(false, '', author.username)).catch(() => {});
    console.log(`[LOCKDOWN] Lifted in ${guildId} by ${author.username}`);
    return send(api, channelId, mid, E.lockdownEmbed(false, '', author.username));
  }
};

// ── MOD NOTES ─────────────────────────────────────────────────────────────────
const note = { name: 'note', names: ['note'], permissions: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'list') {
      const userId = resolveId(args[1]);
      if (!userId) return send(api, channelId,
        E.error('Missing User', 'Usage: `!note list <@user|ID>`'));
      const notes = await getNotes(guildId, userId);
      return send(api, channelId, mid, E.notesListEmbed(userId, notes));
    }

    if (sub === 'delete' || sub === 'remove') {
      const noteId = parseInt(args[1]);
      if (!noteId) return send(api, channelId,
        E.error('Missing Note ID', 'Usage: `!note delete <noteID>`\nGet IDs with `!note list @user`'));
      const deleted = await deleteNote(guildId, noteId);
      if (!deleted) return send(api, channelId,
        E.error('Not Found', `No note found with ID **#${noteId}** in this server.`));
      return send(api, channelId,
        E.success('Note Deleted', `Note **#${noteId}** has been removed.`));
    }

    const userId = resolveId(args[0]);
    if (!userId) return send(api, channelId,
      E.error('Missing Arguments',
        'Usage:\n`!note <@user|ID> <text>` — add a note\n`!note list <@user|ID>` — view notes\n`!note delete <noteID>` — delete a note'));

    const text = args.slice(1).join(' ');
    if (!text) return send(api, channelId,
      E.error('Missing Note Text', 'Usage: `!note <@user|ID> <text>`\nExample: `!note @User suspicious behavior in #general`'));

    const saved = await addNote(guildId, userId, text, author.id, author.username);
    return send(api, channelId, mid, E.noteEmbed({ ...saved, user_id: userId }));
  }
};


// ── LOOKUP ────────────────────────────────────────────────────────────────────
const lookup = { name: 'lookup', names: ['lookup', 'whois'], permissions: true,
  async execute(ctx) {
    const { api, guildId, channelId } = ctx;
    const mid  = ctx.message?.id;
    const args = ctx.args || [];

    const userId = resolveId(args[0]);
    if (!userId) return api.channels.replyMessage(channelId, mid,
      E.error('Missing User', 'Usage: `!lookup <@user|ID>`'));

    // Fetch user si member
    const user   = await api.users.get(userId).catch(() => null);
    const member = await api.guilds.getMember(guildId, userId).catch(() => null);

    if (!user) return api.channels.replyMessage(channelId, mid,
      E.error('User Not Found', `Could not find user with ID \`${userId}\`.`));

    // Calculeaza vechimea contului din ID (Snowflake)
    const EPOCH        = 1640995200000n; // Fluxer epoch (aproximativ)
    const DISCORD_EPOCH = 1420070400000n;
    let accountAge = 'Unknown';
    let accountCreated = 'Unknown';
    try {
      const ms = (BigInt(userId) >> 22n) + DISCORD_EPOCH;
      const date = new Date(Number(ms));
      const now  = Date.now();
      const days = Math.floor((now - Number(ms)) / 86400000);
      accountCreated = date.toISOString().split('T')[0];
      accountAge = days < 1 ? 'Today' : days < 30 ? `${days} days` : days < 365 ? `${Math.floor(days/30)} months` : `${Math.floor(days/365)}y ${Math.floor((days%365)/30)}m`;
    } catch (_) {}

    // Join date
    let joinedAt = 'Unknown';
    let joinDays = null;
    if (member?.joined_at) {
      const jDate = new Date(member.joined_at);
      joinedAt = jDate.toISOString().split('T')[0];
      joinDays = Math.floor((Date.now() - jDate.getTime()) / 86400000);
    }

    // Cases din DB
    const { getCasesByUser } = require('../utils/db');
    const cases = await getCasesByUser(guildId, userId).catch(() => []);
    const bans     = cases.filter(c => c.action === 'BAN').length;
    const kicks    = cases.filter(c => c.action === 'KICK').length;
    const warns    = cases.filter(c => c.action === 'WARN').length;
    const timeouts = cases.filter(c => c.action === 'TIMEOUT').length;
    const lastCases = cases.slice(0, 3);

    // Notes
    const { getNotes } = require('../utils/db');
    const notes = await getNotes(guildId, userId).catch(() => []);

    // Whitelist / Blacklist
    const { isWhitelisted, isBlacklisted } = require('../utils/db');
    const wl = await isWhitelisted(guildId, userId).catch(() => false);
    const bl = await isBlacklisted(guildId, userId).catch(() => false);

    // Risk score
    let risk = 0;
    let riskLabel = '';
    if (bl)       risk += 50;
    if (bans > 0) risk += bans * 15;
    if (kicks > 0) risk += kicks * 10;
    if (warns > 0) risk += warns * 5;
    if (joinDays !== null && joinDays < 7) risk += 10;

    if (risk >= 50)      riskLabel = '🔴 High Risk';
    else if (risk >= 25) riskLabel = '🟡 Medium Risk';
    else if (risk >= 10) riskLabel = '🟠 Low Risk';
    else                 riskLabel = '🟢 Clean';

    // Flags
    const flags = [];
    if (bl)                                    flags.push('🚫 Blacklisted');
    if (wl)                                    flags.push('✅ Whitelisted');
    if (joinDays !== null && joinDays < 7)      flags.push('🆕 New Member');
    if (member?.communication_disabled_until)  flags.push('🔇 Currently Timed Out');
    if (!member)                                flags.push('⚠️ Not in Server');

    const color = risk >= 50 ? 0xED4245 : risk >= 25 ? 0xFFC107 : risk >= 10 ? 0xFF8C00 : 0x43B581;

    const fields = [
      { name: '👤 User', value: `\`${user.username}\` (\`${userId}\`)`, inline: true },
      { name: '⚠️ Risk', value: `${riskLabel} (${risk}pts)`, inline: true },
      { name: '📅 Account Created', value: `${accountCreated}
*(${accountAge} ago)*`, inline: true },
      { name: '📥 Joined Server', value: member ? `${joinedAt}
*(${joinDays} days ago)*` : '*Not in server*', inline: true },
      { name: '📋 Cases', value: `🔨 Bans: **${bans}** | 👟 Kicks: **${kicks}**
⚠️ Warns: **${warns}** | 🔇 Timeouts: **${timeouts}**`, inline: false },
    ];

    if (flags.length) {
      fields.push({ name: '🚩 Flags', value: flags.join('  '), inline: false });
    }

    if (notes.length) {
      fields.push({ name: `📝 Notes (${notes.length})`, value: notes.slice(0, 2).map(n => `• ${n.note.slice(0, 80)}`).join('\n'), inline: false });
    }

    if (lastCases.length) {
      fields.push({
        name: '🕒 Recent Cases',
        value: lastCases.map(c => `\`${c.case_id}\` **${c.action}** — ${(c.reason || '').slice(0, 50)}`).join('\n'),
        inline: false
      });
    }

    const payload = {
      embeds: [{
        color,
        title: `🔍  Lookup — ${user.username}`,
        fields,
        footer: { text: 'FluxerGuard' },
        timestamp: new Date().toISOString(),
      }]
    };

    if (mid) return api.channels.replyMessage(channelId, mid, payload);
    return api.channels.createMessage(channelId, payload);
  }
};

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = guardian;
module.exports.extra = [threatlog, lockdown, unlockdown, note, lookup];
