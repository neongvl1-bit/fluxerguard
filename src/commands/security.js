const { getSettings, updateSettings, getThreatStats, addNote, getNotes, deleteNote } = require('../utils/db');
const E = require('../utils/embeds');

function resolveId(i) { return i ? i.replace(/[<#@!&>]/g, '') : null; }
const send = (api, channelId, body) => {
  const payload = typeof body === 'string' ? E.error('Error', body) : { ...body };
  return api.channels.createMessage(channelId, payload);
};

const lockdown = { name: 'lockdown', names: ['lockdown'], permissions: true,
  async execute({ api, args, guildId, channelId, author }) {
    const g = await getSettings(guildId);
    if (g.lockdown_enabled) return send(api, channelId,
      E.error('Already Active', 'Server is already in lockdown. Use `!unlockdown` to lift it.'));
    const reason = args.join(' ') || 'Emergency lockdown';
    await updateSettings(guildId, { lockdown_enabled: true, lockdown_reason: reason, lockdown_mod: author.username });
    const updated = await getSettings(guildId);
    if (updated.log_channel) api.channels.createMessage(updated.log_channel, E.lockdownEmbed(true, reason, author.username)).catch(() => {});
    console.log('[LOCKDOWN] Activated in ' + guildId + ' by ' + author.username);
    return send(api, channelId, E.lockdownEmbed(true, reason, author.username));
  }
};

const unlockdown = { name: 'unlockdown', names: ['unlockdown'], permissions: true,
  async execute({ api, guildId, channelId, author }) {
    const g = await getSettings(guildId);
    if (!g.lockdown_enabled) return send(api, channelId,
      E.error('Not Active', 'Server is not currently in lockdown.'));
    await updateSettings(guildId, { lockdown_enabled: false, lockdown_reason: null, lockdown_mod: null });
    const updated = await getSettings(guildId);
    if (updated.log_channel) api.channels.createMessage(updated.log_channel, E.lockdownEmbed(false, '', author.username)).catch(() => {});
    console.log('[LOCKDOWN] Lifted in ' + guildId + ' by ' + author.username);
    return send(api, channelId, E.lockdownEmbed(false, '', author.username));
  }
};

module.exports = guardian;
module.exports.extra      = [threatlog, lockdown, unlockdown, note];
module.exports.lockdownState = lockdownState;
module.exports.isLocked      = isLocked;

// ── MOD NOTES ─────────────────────────────────────────────────────────────────
const note = { name: 'note', names: ['note'], permissions: true,
  async execute({ api, args, guildId, channelId, author }) {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'list') {
      const userId = resolveId(args[1]);
      if (!userId) return send(api, channelId,
        E.error('Missing User', 'Usage: `!note list <@user|ID>`'));
      const notes = await getNotes(guildId, userId);
      return send(api, channelId, E.notesListEmbed(userId, notes));
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
    return send(api, channelId, E.noteEmbed({ ...saved, user_id: userId }));
  }
};
