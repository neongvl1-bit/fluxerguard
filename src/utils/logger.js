const { getSettings } = require('./db');
const { logEntry }    = require('./embeds');

async function sendLog(api, guildId, action, fields, caseEntry = null) {
  try {
    const s = await getSettings(guildId);
    if (!s.log_channel) return;
    await api.channels.createMessage(s.log_channel, logEntry(action, fields, caseEntry));
  } catch (err) {
    console.error('[LOGGER]', err.message);
  }
}

module.exports = { sendLog };
