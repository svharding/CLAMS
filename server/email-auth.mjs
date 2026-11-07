import {randomBytes} from 'node:crypto';
import {db,env,transaction} from './db.mjs';
import {hash,cookie,cookies} from './auth.mjs';
import {email,HttpError} from './domain.mjs';
import {sendLoginMail} from './mail.mjs';
const generic='Check your inbox for a sign-in link. Open it in this browser within 15 minutes.';
export async function requestLink(req,input,deliver=sendLoginMail){
 const address=email(input.email);
 if((env('SESSION_SECRET')||'').length<32)throw new HttpError(503,'Sign-in is awaiting configuration.');
 const configured=await db().pool.query("SELECT key FROM settings WHERE key='gmail_refresh'");
 if(!configured.rows.length)throw new HttpError(503,'Email sign-in is awaiting mailbox connection. The administrator can use Google sign-in below to connect it.');
 const browser=cookies(req).clams_link_browser||randomBytes(32).toString('hex');
 const token=randomBytes(32).toString('hex');
 const allowed=await transaction(async c=>{
 await c.query('LOCK TABLE login_links IN SHARE ROW EXCLUSIVE MODE');
 await c.query("DELETE FROM login_links WHERE created_at<now()-interval '1 day'");
 const {rows}=await c.query("SELECT count(*) AS total, count(*) FILTER (WHERE email=$1) AS recipient, count(*) FILTER (WHERE browser_hash=$2) AS browser FROM login_links WHERE created_at>now()-interval '1 hour'",[address,hash(browser)]);
 if(Number(rows[0].total)>=50||Number(rows[0].recipient)>=5||Number(rows[0].browser)>=10)return false;
 await c.query("INSERT INTO login_links(hash,email,browser_hash,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes')",[hash(token),address,hash(browser)]);return true;
 });
 if(allowed){try{await deliver(address,`${new URL(req.url).origin}/#signin?token=${token}`);}catch{await db().pool.query('UPDATE login_links SET used_at=now() WHERE hash=$1',[hash(token)]);throw new HttpError(503,'The sign-in email could not be sent. Please contact the booking administrator.');}}
 return Response.json({message:generic},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie('clams_link_browser',browser,3600)}});
}
export async function redeemLink(req,input){
 if(!/^[a-f0-9]{64}$/.test(input.token||''))throw new HttpError(400,'This sign-in link is invalid. Request a new link.');
 const browser=cookies(req).clams_link_browser||'';
 const session=randomBytes(32).toString('hex');
 await transaction(async c=>{
 const {rows}=await c.query('SELECT * FROM login_links WHERE hash=$1 FOR UPDATE',[hash(input.token)]);
 const link=rows[0];
 if(!link||link.used_at||new Date(link.expires_at)<=new Date())throw new HttpError(400,'This sign-in link has expired or was already used. Request a new link.');
 if(!browser||link.browser_hash!==hash(browser))throw new HttpError(400,'Open this link in the same browser where you requested it, or request a new link here.');
 await c.query('UPDATE login_links SET used_at=now() WHERE hash=$1',[hash(input.token)]);
 await c.query('INSERT INTO users(email,name) VALUES($1,$1) ON CONFLICT(email) DO NOTHING',[link.email]);
 await c.query("INSERT INTO sessions(hash,email,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(session),link.email]);
 });
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie('clams_session',session,604800)}});
}
