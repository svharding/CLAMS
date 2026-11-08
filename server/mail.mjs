import {db,env} from './db.mjs';
import {oauth,unseal} from './auth.mjs';
import {MAILBOX} from './domain.mjs';
export async function queue(c,b,recipients,subject,body){for(const recipient of new Set(recipients.filter(Boolean)))await c.query('INSERT INTO mail_queue(booking_id,recipient,subject,body) VALUES($1,$2,$3,$4)',[b?.id||null,recipient,subject,body]);}
export async function sendQueued(){
 const started=Date.now();let processed=0;
 const {rows:due}=await db().pool.query("SELECT id FROM mail_queue WHERE ((status IN ('queued','failed') AND attempts<8) OR status='sending') AND next_attempt<=now() LIMIT 1");
 if(!due.length)return {sent:0,connected:true,processed:0};
 const {rows:settings}=await db().pool.query("SELECT value FROM settings WHERE key='gmail_refresh'");if(!settings.length)return {sent:0,connected:false};
 const client=oauth(env('URL')||'http://localhost:8888');client.setCredentials({refresh_token:unseal(settings[0].value)});const access=await client.getAccessToken();let sent=0;
 // Process bounded batches concurrently within the scheduled function time budget.
 while(processed<50 && Date.now()-started<15000){
 const {rows}=await db().pool.query("UPDATE mail_queue SET status='sending',attempts=attempts+1,next_attempt=now()+interval '10 minutes' WHERE id IN (SELECT id FROM mail_queue WHERE ((status IN ('queued','failed') AND attempts<8) OR status='sending') AND next_attempt<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 5) RETURNING *");
 if(!rows.length)break;
 processed+=rows.length;
 await Promise.all(rows.map(async item=>{try{
 const subject='=?UTF-8?B?'+Buffer.from(item.subject).toString('base64')+'?=';
 const raw=Buffer.from([`From: CLAMS Bookings <${MAILBOX}>`,`To: ${item.recipient}`,`Reply-To: ${MAILBOX}`,`Subject: ${subject}`,`Message-ID: <clams-${item.id}@clams.booking.mun>`, 'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(item.body).toString('base64')].join('\r\n')).toString('base64url');
 const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${access.token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error(`Gmail returned ${r.status}`);
 await db().pool.query("UPDATE mail_queue SET status='sent',sent_at=now(),last_error=NULL WHERE id=$1",[item.id]);sent++;
 }catch(e){await db().pool.query("UPDATE mail_queue SET status='failed',last_error=$2,next_attempt=now()+interval '15 minutes' WHERE id=$1",[item.id,String(e.message).slice(0,200)]);}}));
 }
 return {sent,connected:true,processed};
}

// Login links are delivered immediately and never stored in the booking mail queue.
export async function sendLoginMail(recipient,link){
 const {rows}=await db().pool.query("SELECT value FROM settings WHERE key='gmail_refresh'");
 if(!rows.length)throw new Error('Mailbox not connected');
 const client=oauth(env('URL')||'http://localhost:8888');
 client.setCredentials({refresh_token:unseal(rows[0].value)});
 const access=await client.getAccessToken();
 const body=`Sign in to CLAMS Booking:\n\n${link}\n\nOpen this link in the browser where you requested it, then select Continue sign-in. It expires in 15 minutes and works once.\n\nIf you did not request this, ignore this email.`;
 const raw=Buffer.from([`From: CLAMS Bookings <${MAILBOX}>`,`To: ${recipient}`,'Subject: Your CLAMS Booking sign-in link','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(body).toString('base64')].join('\r\n')).toString('base64url');
 const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${access.token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error('Login mail delivery failed');
}
