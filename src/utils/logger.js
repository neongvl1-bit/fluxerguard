const { getSettings } = require('./db');

const EMOJIS = {
  BAN: '🔨', KICK: '👢', WARN: '⚠️', TIMEOUT: '⏱️',
  UNBAN: '✅', UNTIMEOUT: '✅', ANTIRAID: '🛡️', ANTINUKE: '💥', ANTISPAM: '🚫'
};

async function sendLog(api, guildId, action, fields, caseEntry = null) {
  try {
    const s = await getSettings(guildId);
    if (!s.log_channel) return;

    const lines = Object.entries(fields).map(([k, v]) => `**${k}:** ${v}`);
    const caseInfo = caseEntry ? `\`${caseEntry.caseId}\` • ${caseEntry.auto ? 'AUTO' : 'MANUAL'}` : '';

    await api.channels.createMessage(s.log_channel, {
      content: `${EMOJIS[action] || '🔧'} **${action}** ${caseInfo}\n${lines.join(' | ')}`
    });
  } catch (err) {
    console.error('[LOGGER]', err.message);
  }
}

module.exports = { sendLog };
