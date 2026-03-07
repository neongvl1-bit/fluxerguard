// ── FluxerGuard Embed Builder ─────────────────────────────────────────────────
// Centralizat: toate mesajele trec prin aici pentru un look consistent

const COLORS = {
  // Actiuni mod
  BAN:       0xED4245,
  KICK:      0xFF7043,
  WARN:      0xFFC107,
  TIMEOUT:   0x5B9BD5,
  UNBAN:     0x43B581,
  UNTIMEOUT: 0x43B581,
  // Securitate
  ANTIRAID:  0xFF5252,
  ANTINUKE:  0xFF6D00,
  ANTISPAM:  0xFFAB00,
  // UI
  INFO:      0x5865F2,
  SUCCESS:   0x43B581,
  ERROR:     0xED4245,
  WARNING:   0xFFC107,
  NEUTRAL:   0x2F3136,
};

const ICONS = {
  BAN:       '🔨',
  KICK:      '👢',
  WARN:      '⚠️',
  TIMEOUT:   '⏱️',
  UNBAN:     '✅',
  UNTIMEOUT: '✅',
  ANTIRAID:  '🛡️',
  ANTINUKE:  '💥',
  ANTISPAM:  '🚫',
  INFO:      'ℹ️',
  SUCCESS:   '✅',
  ERROR:     '❌',
  SHIELD:    '🛡️',
  CASE:      '📋',
  SETTINGS:  '⚙️',
  LIST:      '📋',
};

const FOOTER = 'FluxerGuard';

function ts() { return new Date().toISOString(); }

// Embed de baza
function embed(color, title, description, fields = [], extra = {}) {
  return {
    embeds: [{
      color,
      title,
      description: description || undefined,
      fields: fields.length ? fields : undefined,
      footer: { text: FOOTER },
      timestamp: ts(),
      ...extra,
    }]
  };
}

function field(name, value, inline = false) {
  return { name, value: String(value || '—'), inline };
}

// ── Mod action confirm (in canal) ─────────────────────────────────────────────
function modConfirm(action, targetUser, reason, caseId, duration) {
  const fields = [
    field('User',      `**${targetUser.username}**\n\`${targetUser.id}\``, true),
    field('Reason',    reason,  true),
    field('Case ID',   `\`${caseId}\``, true),
  ];
  if (duration) fields.push(field('Duration', `\`${duration}\``, true));
  return embed(COLORS[action] || COLORS.INFO, `${ICONS[action] || '🔧'}  ${action}`, null, fields);
}

// ── DM al userului ────────────────────────────────────────────────────────────
function modDM(action, serverName, reason, caseId, modUsername, duration) {
  const desc = {
    BAN:       `You have been **permanently banned** from **${serverName}**.`,
    KICK:      `You have been **kicked** from **${serverName}**.`,
    WARN:      `You have received a **warning** in **${serverName}**.`,
    TIMEOUT:   `You have been **timed out** in **${serverName}** for \`${duration}\`.`,
    UNBAN:     `Your ban in **${serverName}** has been **lifted**.`,
    UNTIMEOUT: `Your timeout in **${serverName}** has been **removed**.`,
  }[action] || `Action **${action}** was taken in **${serverName}**.`;

  const fields = [
    field('Reason',    reason,       true),
    field('Moderator', modUsername,  true),
    field('Case ID',   `\`${caseId}\``, true),
  ];
  if (duration && action === 'TIMEOUT') fields.push(field('Duration', `\`${duration}\``, true));

  return embed(COLORS[action] || COLORS.INFO, `${ICONS[action] || '🔧'}  ${action}`, desc, fields);
}

// ── Log entry ─────────────────────────────────────────────────────────────────
function logEntry(action, fieldsObj, caseEntry) {
  const fields = Object.entries(fieldsObj).map(([k, v]) => field(k, v, true));
  const caseInfo = caseEntry
    ? `\`${caseEntry.caseId}\` • ${caseEntry.auto ? '🤖 Auto' : '👮 Manual'}`
    : '';
  return embed(
    COLORS[action] || COLORS.NEUTRAL,
    `${ICONS[action] || '🔧'}  ${action}  ${caseInfo}`,
    null,
    fields
  );
}

// ── Security alert ────────────────────────────────────────────────────────────
function securityAlert(module, description, fieldsObj, caseEntry) {
  const fields = Object.entries(fieldsObj).map(([k, v]) => field(k, v, true));
  const caseInfo = caseEntry ? ` • \`${caseEntry.caseId}\`` : '';
  return embed(
    COLORS[module] || COLORS.ERROR,
    `${ICONS[module] || '🛡️'}  ${module} Triggered${caseInfo}`,
    description,
    fields
  );
}

// ── Error / usage ─────────────────────────────────────────────────────────────
function error(title, description) {
  return embed(COLORS.ERROR, `${ICONS.ERROR}  ${title}`, description);
}

function success(title, description) {
  return embed(COLORS.SUCCESS, `${ICONS.SUCCESS}  ${title}`, description);
}

function info(title, description, fields = []) {
  return embed(COLORS.INFO, title, description, fields);
}

// ── Warn history ──────────────────────────────────────────────────────────────
function warnConfirm(targetUser, reason, caseId, totalWarns) {
  return embed(COLORS.WARN, `${ICONS.WARN}  Warning Issued`, null, [
    field('User',           `**${targetUser.username}**\n\`${targetUser.id}\``, true),
    field('Total Warnings', `**${totalWarns}**`,                                 true),
    field('Case ID',        `\`${caseId}\``,                                     true),
    field('Reason',         reason,                                               false),
  ]);
}

// ── Case lookup ───────────────────────────────────────────────────────────────
function caseEmbed(c) {
  const fields = [
    field('User',      `${c.user_tag}\n\`${c.user_id}\``,  true),
    field('Moderator', c.mod_tag,                            true),
    field('Type',      c.auto ? '🤖 Auto' : '👮 Manual',   true),
    field('Reason',    c.reason,                             false),
    field('Date',      new Date(c.created_at).toLocaleString(), true),
  ];
  if (c.duration) fields.push(field('Duration', `\`${c.duration}\``, true));
  return embed(COLORS[c.action] || COLORS.INFO, `${ICONS.CASE}  ${c.case_id} — ${c.action}`, null, fields);
}

// ── Case history ──────────────────────────────────────────────────────────────
function caseHistory(userId, cases) {
  const description = cases.slice(0, 10).map(c =>
    `\`${c.case_id}\` **${c.action}**${c.auto ? ' 🤖' : ''} — ${c.reason.slice(0, 50)}${c.reason.length > 50 ? '…' : ''}`
  ).join('\n');
  return embed(COLORS.INFO, `${ICONS.CASE}  Case History`, description, [
    field('User',   `\`${userId}\``,          true),
    field('Total',  `**${cases.length}**`,    true),
    ...(cases.length > 10 ? [field('Note', `Showing latest 10 of ${cases.length}`)] : []),
  ]);
}

// ── Config display ────────────────────────────────────────────────────────────
function configEmbed(g) {
  const logStr = g.log_channel ? `<#${g.log_channel}>` : '`not set`';
  return embed(COLORS.INFO, `${ICONS.SETTINGS}  FluxerGuard Configuration`,
    `Prefix: \`${g.prefix}\`  •  Log Channel: ${logStr}`,
    [
      field('🛡️ AntiRaid',  `Enabled: **${g.antiraid_enabled}**\nThreshold: **${g.antiraid_threshold}** joins / **${g.antiraid_interval/1000}s**\nAction: **${g.antiraid_action}**`,  true),
      field('💥 AntiNuke',  `Enabled: **${g.antinuke_enabled}**\nThreshold: **${g.antinuke_threshold}** actions / **${g.antinuke_interval/1000}s**`,                                   true),
      field('⚠️ AntiSpam',  `Enabled: **${g.antispam_enabled}**\nMax: **${g.antispam_max_msgs}** msgs / **${g.antispam_interval/1000}s**\nAction: **${g.antispam_action}**`,           true),
      field('🌊 AntiFlood', `Enabled: **${g.antiflood_enabled}**\nDuplicates: **${g.antiflood_duplicates}**`,                                                                          true),
    ]
  );
}

// ── Help ──────────────────────────────────────────────────────────────────────
function helpEmbed(prefix) {
  const p = prefix || '!';
  return embed(COLORS.INFO, `${ICONS.SHIELD}  FluxerGuard — Command Reference`,
    `Use \`${p}help\` anytime to see this menu.`,
    [
      field('🔨 Moderation', [
        `\`${p}ban <@user|ID> [reason]\``,
        `\`${p}kick <@user|ID> [reason]\``,
        `\`${p}warn <@user|ID> <reason>\``,
        `\`${p}unban <userID> [reason]\``,
        `\`${p}timeout <@user|ID> <duration> [reason]\``,
        `\`${p}untimeout <@user|ID> [reason]\``,
      ].join('\n'), false),
      field('📋 Cases', [
        `\`${p}case <ID>\` — look up a case`,
        `\`${p}case history <@user|ID>\` — full history`,
      ].join('\n'), false),
      field('🛡️ Security', [
        `\`${p}config\` — view all settings`,
        `\`${p}config <module> <key> <value>\` — edit`,
        `\`${p}whitelist add/remove/list\``,
        `\`${p}blacklist add/remove/list\``,
      ].join('\n'), false),
      field('⚙️ Setup', [
        `\`${p}setprefix <prefix>\``,
        `\`${p}setlog [#channel]\``,
      ].join('\n'), true),
      field('⏱️ Duration Format', '`30s`  `10m`  `2h`  `1d`  *(max 28d)*', true),
    ]
  );
}

// ── List (whitelist/blacklist) ─────────────────────────────────────────────────
function listEmbed(type, ids) {
  const isWhite = type === 'whitelist';
  const color   = isWhite ? COLORS.SUCCESS : COLORS.ERROR;
  const icon    = isWhite ? '✅' : '🚫';
  const desc    = ids.length
    ? ids.map(id => `\`${id}\``).join('\n')
    : '*Empty*';
  const note    = isWhite
    ? 'Whitelisted users bypass all auto-security modules.'
    : 'Blacklisted users are auto-banned on join.';
  return embed(color, `${icon}  ${isWhite ? 'Whitelist' : 'Blacklist'}  (${ids.length})`, desc, [
    field('ℹ️ Note', note, false),
  ]);
}

module.exports = {
  COLORS, ICONS, field,
  modConfirm, modDM, logEntry, securityAlert,
  error, success, info,
  warnConfirm, caseEmbed, caseHistory,
  configEmbed, helpEmbed, listEmbed,
};
