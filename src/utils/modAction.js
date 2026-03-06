const { createCase } = require('./db');
const { sendLog }    = require('./logger');
const COLORS = { BAN:0xed4245,KICK:0xff9a3c,WARN:0xfee75c,TIMEOUT:0x5b9bd5,UNBAN:0x57f287,UNTIMEOUT:0x57f287 };
async function doModAction({ api, guildId, channelId, modUser, action, targetUser, reason, duration=null, durationMs=null }) {
  const entry = await createCase(guildId, { action, userId:targetUser.id, userTag:targetUser.username, modId:modUser.id, modTag:modUser.username, reason:reason||'No reason provided', duration, auto:false });
  try { const dm=await api.users.createDM(targetUser.id); await api.channels.createMessage(dm.id,{embeds:[{color:COLORS[action]||0x5865f2,title:'🔔 Action received',fields:[{name:'Action',value:action,inline:true},{name:'Moderator',value:modUser.username,inline:true},{name:'Reason',value:reason||'No reason provided'},{name:'Case ID',value:entry.caseId,inline:true},...(duration?[{name:'Duration',value:duration,inline:true}]:[])],timestamp:new Date().toISOString()}]}); } catch(_){}
  if (action==='BAN')       await api.guilds.banUser(guildId,targetUser.id,{reason});
  if (action==='KICK')      await api.guilds.removeMember(guildId,targetUser.id);
  if (action==='UNBAN')     await api.guilds.unbanUser(guildId,targetUser.id);
  if (action==='TIMEOUT')   await api.guilds.editMember(guildId,targetUser.id,{communication_disabled_until:new Date(Date.now()+durationMs).toISOString()});
  if (action==='UNTIMEOUT') await api.guilds.editMember(guildId,targetUser.id,{communication_disabled_until:null});
  await sendLog(api,guildId,action,{'User':`${targetUser.username} (${targetUser.id})`,'Moderator':modUser.username,'Reason':reason||'No reason provided','Case ID':entry.caseId,...(duration?{'Duration':duration}:{})},entry);
  await api.channels.createMessage(channelId,{embeds:[{color:COLORS[action]||0x5865f2,title:`✅ ${action} — ${entry.caseId}`,fields:[{name:'User',value:targetUser.username,inline:true},{name:'Reason',value:reason||'No reason provided',inline:true},{name:'Case ID',value:entry.caseId,inline:true},...(duration?[{name:'Duration',value:duration,inline:true}]:[])],timestamp:new Date().toISOString()}]});
  console.log(`[MOD] ${action} — ${targetUser.username} (${entry.caseId})`);
  return entry;
}
module.exports = { doModAction };
