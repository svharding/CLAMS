import {isMailWindow} from '../../server/mail-schedule.mjs';
export default async()=>{
 // Reject the alternate DST slot before importing mail/database dependencies.
 if(!isMailWindow()) return;
 const start=Date.now();
 const {sendQueued}=await import('../../server/mail.mjs');
 try { const result=await sendQueued(); console.log(JSON.stringify({event:'mail_queue_run',durationMs:Date.now()-start,...result})); }
 catch(error) { console.error(JSON.stringify({event:'mail_queue_run',durationMs:Date.now()-start,failed:true})); throw error; }
};
// Both Newfoundland UTC offsets; the local-time guard allows only 08:00/14:00 weekdays.
export const config={schedule:'30 10,11,16,17 * * 1-5'};
