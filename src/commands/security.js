const { getSettings, updateSettings, getThreatStats, addNote, getNotes, deleteNote } = require('../utils/db');
const E = require('../utils/embeds');

function resolveId(i) { return i ? i.replace(/[<#@!&>]/g, '') : null; }
const send = (api, channelId, body) => {
  const payload = typeof body === 'string' ? E.error('Error', body) : { ...body };
  return api.channels.createMessage(channelId, payload);
};

// ── GUARDIAN LEVEL ────────────────────────────────────────────────────────────
// Calculeaza scorul de securitate bazat pe configuratie
function calcGuardianLevel(g) {
  let score = 0;
  const checks = [];

  // Log channel setat
  if (g.log_channel) { score += 15; checks.push({ name: '✅ Log Channel', value: 'Configured', inline: true }); }
  else               { checks.push({ name: '❌ Log Channel', value: 'Not set — use `!setlog`', inline: true }); }

  // AntiRaid
  if (g.antiraid_enabled) {
    score += 20;
    const pts = g.antiraid_action === 'ban' ? '20/20' : g.antiraid_action === 'kick' ? '18/20' : '10/20';
    if (g.antiraid_action !== 'alert') score += g.antiraid_action === 'ban' ? 0 : -2;
    checks.push({ name: '✅ AntiRaid', value: `Active — action: **${g.antiraid_action}**`, inline: true });
  } else {
    checks.push({ name: '❌ AntiRaid', value: 'Disabled', inline: true });
  }

  // AntiNuke
  if (g.antinuke_enabled) {
    score += 25;
    checks.push({ name: '✅ AntiNuke', value: `Active — threshold: **${g.antinuke_threshold}**`, inline: true });
  } else {
    checks.push({ name: '❌ AntiNuke', value: 'Disabled', inline: true });
  }

  // AntiSpam
  if (g.antispam_enabled) {
    score += 15;
    checks.push({ name: '✅ AntiSpam', value: `Active — action: **${g.antispam_action}**`, inline: true });
  } else {
    checks.push({ name: '❌ AntiSpam', value: 'Disabled', inline: true });
  }

  // AntiFlood
  if (g.antiflood_enabled) {
    score += 10;
    checks.push({ name: '✅ AntiFlood', value: `Active`, inline: true });
  } else {
    checks.push({ name: '❌ AntiFlood', value: 'Disabled', inline: true });
  }

  // Prefix custom
  if (g.prefix !== '!') {
    score += 5;
    checks.push({ name: '✅ Custom Prefix', value: `\`${g.prefix}\``, inline: true });
  }

  // Calculeaza level 0-5
  const level = score >= 90 ? 5 : score >= 70 ? 4 : score >= 50 ? 3 : score >= 30 ? 2 : score >= 10 ? 1 : 0;

  // Tip sfat
  let tip = '';
  if (!g.log_channel)       tip = '💡 Tip: Set a log channel with `!setlog` to track all actions.';
  else if (!g.antinuke_enabled) tip = '💡 Tip: Enable AntiNuke — it protects against server destruction.';
  else if (g.antiraid_action === 'alert') tip = '💡 Tip: Consider setting AntiRaid action to `kick` or `ban` for automatic protection.';
  else if (score < 90)      tip = '💡 Tip: Enable all modules and set a log channel for maximum protection.';

  if (tip) checks.push({ name: '💡 Recommendation', value: tip, inline: false });

  return { level, score: Math.min(score, 100), checks };
}

const guardian = { name: 'guardian', names: ['guardian', 'security', 'level'], permissions: false,
  async execute({ api, guildId, channelId, message }) {
    const g = await getSettings(guildId);
    const { level, score, checks } = calcGuardianLevel(g);
    return send(api, channelId, E.guardianLevelEmbed(level, score, checks));
  }
};

// ── THREAT LOG ────────────────────────────────────────────────────────────────
const threatlog = { name: 'threatlog', names: ['threatlog', 'threats', 'stats'], permissions: true,
  async execute({ api, guildId, channelId, message }) {
    const allStats = await getThreatStats(guildId, 4);
    if (!allStats.length) return send(api, channelId,
      E.info('No Data Yet', 'No threats have been logged yet. Stats are tracked weekly.'));

    // Trimite un embed per saptamana (max 4)
    for (const week of allStats) {
      await send(api, channelId, E.threatLogEmbed(week));
    }
  }
};

// ── LOCKDOWN ──────────────────────────────────────────────────────────────────
const lockdown = { name: 'lockdown', names: ['lockdown'], permissions: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    const g = await getSettings(guildId);

    if (g.lockdown_enabled) return send(api, channelId,
      E.error('Already Active', 'Server is already in lockdown. Use `!unlockdown` to lift it.'));

    const reason = args.join(' ') || 'Emergency lockdown';
    await updateSettings(guildId, { lockdown_enabled: true, lockdown_reason: reason, lockdown_mod: author.username });

    // Log
    if (g.log_channel) {
      await api.channels.createMessage(g.log_channel, E.lockdownEmbed(true, reason, author.username)).catch(() => {});
    }

    console.log(`[LOCKDOWN] Activated in ${guildId} by ${author.username}`);
    return send(api, channelId, E.lockdownEmbed(true, reason, author.username));
  }
};

const unlockdown = { name: 'unlockdown', names: ['unlockdown'], permissions: true,
  async execute({ api, guildId, channelId, author, message }) {
    const g = await getSettings(guildId);

    if (!g.lockdown_enabled) return send(api, channelId,
      E.error('Not Active', 'Server is not in lockdown.'));

    await updateSettings(guildId, { lockdown_enabled: false, lockdown_reason: null, lockdown_mod: null });

    if (g.log_channel) {
      await api.channels.createMessage(g.log_channel, E.lockdownEmbed(false, '', author.username)).catch(() => {});
    }

    console.log(`[LOCKDOWN] Lifted in ${guildId} by ${author.username}`);
    return send(api, channelId, E.lockdownEmbed(false, '', author.username));
  }
};

// ── MOD NOTES ─────────────────────────────────────────────────────────────────
const note = { name: 'note', names: ['note'], permissions: true,
  async execute({ api, args, guildId, channelId, author, message }) {
    const sub = (args[0] || '').toLowerCase();

    // !note list @user
    if (sub === 'list') {
      const userId = resolveId(args[1]);
      if (!userId) return send(api, channelId,
        E.error('Missing User', 'Usage: `!note list <@user|ID>`'));
      const notes = await getNotes(guildId, userId);
      return send(api, channelId, E.notesListEmbed(userId, notes));
    }

    // !note delete <id>
    if (sub === 'delete' || sub === 'remove') {
      const noteId = parseInt(args[1]);
      if (!noteId) return send(api, channelId,
        E.error('Missing Note ID', 'Usage: `!note delete <noteID>`\nGet IDs with `!note list @user`'));
      const deleted = await deleteNote(guildId, noteId);
      if (!deleted) return send(api, channelId,
        E.error('Note Not Found', `No note found with ID **#${noteId}** in this server.`));
      return send(api, channelId,
        E.success('Note Deleted', `Note **#${noteId}** has been deleted.`));
    }

    // !note @user <text>  (add)
    const userId = resolveId(args[0]);
    if (!userId) return send(api, channelId,
      E.error('Missing Arguments',
        'Usage:\n`!note <@user|ID> <text>` — add a note\n`!note list <@user|ID>` — view notes\n`!note delete <noteID>` — delete a note'
      ));

    const text = args.slice(1).join(' ');
    if (!text) return send(api, channelId,
      E.error('Missing Note Text', 'Usage: `!note <@user|ID> <text>`\nExample: `!note @User suspicious behavior in #general`'));

    const saved = await addNote(guildId, userId, text, author.id, author.username);
    return send(api, channelId, E.noteEmbed({ ...saved, user_id: userId }));
  }
};

module.exports = guardian;
module.exports.extra = [threatlog, lockdown, unlockdown, note];
