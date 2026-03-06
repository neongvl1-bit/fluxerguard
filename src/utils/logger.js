const { getSettings } = require('./db');
const COLORS = { BAN:0xed4245,KICK:0xff9a3c,WARN:0xfee75c,TIMEOUT:0x5b9bd5,UNBAN:0x57f287,UNTIMEOUT:0x57f287,ANTIRAID:0xed4245,ANTINUKE:0xff6b35,ANTISPAM:0xfee75c };
const EMOJIS = { BAN:'🔨',KICK:'👢',WARN:'⚠️',TIMEOUT:'⏱️',UNBAN:'✅',UNTIMEOUT:'✅',ANTIRAID:'🛡️',ANTINUKE:'💥',ANTISPAM:'🚫' };
async function sendLog(api, guildId, action, fields, caseEntry=null) {
  try {
    const s = await getSettings(guildId);
    if (!s.log_channel) return;
    const embed = { color:COLORS[action]||0x5865f2, title:`${EMOJIS[action]||'🔧'} ${action}`, fields:Object.entries(fields).map(([name,value])=>({name,value:String(value),inline:true})), timestamp:new Date().toISOString() };
    if (caseEntry) embed.footer = { text:`${caseEntry.caseId} • ${caseEntry.auto?'AUTO':'MANUAL'}` };
    await api.channels.createMessage(s.log_channel, { embeds:[embed] });
  } catch(err) { console.error('[LOGGER]',err.message); }
}
module.exports = { sendLog };
