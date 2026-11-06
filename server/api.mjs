import {randomBytes} from 'node:crypto';
import ExcelJS from 'exceljs';
import {db,env,transaction} from './db.mjs';
import {MAILBOX,RATE,OUTCOMES,HttpError,validateBooking,publicBooking,notice,email,required,date,endDate} from './domain.mjs';
import {user,requireUser,beginAuth,finishAuth,cookie,cookies,hash} from './auth.mjs';
import {queue,sendQueued} from './mail.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const id=()=>randomBytes(8).toString('hex');
const plain=b=>({...b,start_date:typeof b.start_date==='string'?b.start_date.slice(0,10):b.start_date.toISOString().slice(0,10),end_date:typeof b.end_date==='string'?b.end_date.slice(0,10):b.end_date.toISOString().slice(0,10)});
async function body(req){const s=await req.text();if(s.length>50000)throw new HttpError(413,'Request is too large.');try{return JSON.parse(s);}catch{throw new HttpError(400,'Invalid request.');}}
async function audit(c,b,u,action){await c.query('INSERT INTO activity(booking_id,actor,action) VALUES($1,$2,$3)',[b.id,u.email,action]);}
async function noConflict(c,start,end,exclude=''){const {rows}=await c.query("SELECT id FROM bookings WHERE status IN ('confirmed','maintenance') AND start_date<$2 AND end_date>$1 AND id<>$3",[start,end,exclude]);if(rows.length)throw new HttpError(409,'These dates overlap an existing reservation. Choose another period.');}
async function participants(c,b){for(const s of b.details.students)await c.query('INSERT INTO users(email,name) VALUES($1,$2) ON CONFLICT(email) DO NOTHING',[s.email,s.name]);}
async function bookingMail(c,b,action){
 const summary=notice(b);const to=[b.owner_email,b.details.contactEmail,...b.details.students.map(s=>s.email)];
 const privateText=`CLAMS booking ${b.id}\nStatus: ${b.status}\n${summary}\n${b.weeks} week(s) × $${b.rate} CAD = $${b.weeks*b.rate} CAD\n\nStudents must clean all items that cannot go through the cage-washing facilities.\n${b.admin_note?'\nAdministrator note: '+b.admin_note+'\n':''}\nManage your request at ${env('URL')||'the CLAMS booking hub'}.\n`;
 await queue(c,b,to,`CLAMS booking ${action}`,privateText);
 if(action==='requested'||action==='updated')await queue(c,b,[env('REQUEST_EMAIL')||'sharding@mun.ca'],`CLAMS booking ${action}: ${b.details.piName}`,`${privateText}\nProject: ${b.details.projectTitle}\nReview the request in the private dashboard.`);
 if(['confirmed','rescheduled','cancelled'].includes(action)){
 const {rows}=await c.query('SELECT email FROM users WHERE active=true');const others=rows.map(x=>x.email).filter(e=>!to.includes(e));
 await queue(c,b,others,`CLAMS reservation ${action}: ${b.details.piName}`,`${summary}\nStatus: ${b.status}\n\nThis is a CLAMS user-group notice. Manage booking notices in your account on the hub.`);
 }
}
async function exportWorkbook(){const book=new ExcelJS.Workbook();book.creator='CLAMS Bookings';const {rows:raw}=await db().pool.query('SELECT * FROM bookings ORDER BY start_date');const bookings=raw.map(plain);const {rows:users}=await db().pool.query('SELECT * FROM users ORDER BY name');const {rows:activity}=await db().pool.query('SELECT * FROM activity ORDER BY id');
 const sheets={Bookings:bookings.map(b=>({ID:b.id,Status:b.status,PI:b.details.piName,'PI email':b.details.piEmail,Department:b.details.department,Faculty:b.details.faculty,'Primary contact':b.details.contactName,'Contact email':b.details.contactEmail,Start:b.start_date,'Release date':b.end_date,Weeks:b.weeks,'Rate CAD':b.rate,'Total CAD':b.status==='maintenance'?0:b.weeks*b.rate,FOAPAL:b.details.foapal,Project:b.details.projectTitle,'Funding agency':b.details.fundingAgency,'Funding program':b.details.fundingProgram,Outcomes:b.details.outcomes?.join('; '),'Outcome notes':b.details.outcomeNotes,Species:b.details.species,Notes:b.details.notes,'Admin note':b.admin_note,'Billing status':b.billing_status})),Users:users.map(u=>({Name:u.name,Email:u.email,'Active notices':u.active,'Training verified':u.trained,'Training date':u.trained_at,'Training notes':u.training_note})),Participants:bookings.flatMap(b=>(b.details.students||[]).map(s=>({'Booking ID':b.id,Name:s.name,Email:s.email,'Reported training':s.training,'Reported date':s.trainingDate}))),Billing:bookings.filter(b=>b.status==='confirmed').map(b=>({'Booking ID':b.id,PI:b.details.piName,FOAPAL:b.details.foapal,Weeks:b.weeks,'Rate CAD':b.rate,'Charge CAD':b.weeks*b.rate,Status:b.billing_status})),Activity:activity};
 for(const [name,rows]of Object.entries(sheets)){const sheet=book.addWorksheet(name);if(rows.length){sheet.columns=Object.keys(rows[0]).map(k=>({header:k,key:k,width:Math.min(40,Math.max(18,k.length+4))}));sheet.addRows(rows);sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF165E58'}};}else sheet.addRow(['No records']);}
 return new Response(await book.xlsx.writeBuffer(),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="CLAMS-bookings.xlsx"','Cache-Control':'no-store'}});
}
export async function handle(req){try{
 const url=new URL(req.url),path=url.pathname.replace(/^\/api/,'')||'/',method=req.method;
 if(!['GET','POST'].includes(method))throw new HttpError(405,'Method not allowed.');
 if(method==='POST'&&req.headers.get('origin')!==url.origin)throw new HttpError(403,'This request must come from the booking website.');
 if(path==='/auth/start')return await beginAuth(req,url.searchParams.get('mode')==='gmail'?'gmail':'login');
 if(path==='/auth/callback')return await finishAuth(req);
 if(path==='/config')return json({mailbox:MAILBOX,rate:RATE,outcomes:OUTCOMES,authConfigured:!!(env('GOOGLE_CLIENT_ID')&&env('GOOGLE_CLIENT_SECRET')&&env('SESSION_SECRET'))});
 if(path==='/me')return json({user:await user(req)});
 if(path==='/logout'&&method==='POST'){await db().pool.query('DELETE FROM sessions WHERE hash=$1',[hash(cookies(req).clams_session||'')]);return new Response('{}',{headers:{'Set-Cookie':cookie('clams_session','',0),'Content-Type':'application/json'}});}
 if(path==='/calendar'){const {rows}=await db().pool.query("SELECT * FROM bookings WHERE status IN ('confirmed','maintenance') ORDER BY start_date");return json(rows.map(plain).map(publicBooking));}
 const u=await requireUser(req,path.startsWith('/admin'));
 if(path==='/preferences'&&method==='POST'){const b=await body(req);if(typeof b.active!=='boolean')throw new HttpError(400,'Invalid preference.');await db().pool.query('UPDATE users SET active=$2 WHERE email=$1',[u.email,b.active]);return json({ok:true});}
 if(path==='/bookings'&&method==='GET'){const {rows}=await db().pool.query('SELECT * FROM bookings WHERE owner_email=$1 ORDER BY created_at DESC',[u.email]);return json(rows.map(plain));}
 if(path==='/bookings'&&method==='POST'){
 const v=validateBooking(await body(req));const b=await transaction(async c=>{
 await c.query('LOCK TABLE bookings IN SHARE ROW EXCLUSIVE MODE');await noConflict(c,v.start,v.end);
 const count=await c.query("SELECT count(*) FROM bookings WHERE owner_email=$1 AND created_at>now()-interval '1 day'",[u.email]);if(Number(count.rows[0].count)>=10)throw new HttpError(429,'Daily request limit reached. Contact the booking mailbox.');
 const {rows}=await c.query("INSERT INTO bookings(id,owner_email,status,start_date,end_date,weeks,details) VALUES($1,$2,'pending',$3,$4,$5,$6) RETURNING *",[id(),u.email,v.start,v.end,v.weeks,v.details]);const b=plain(rows[0]);await audit(c,b,u,'requested');await bookingMail(c,b,'requested');return b;});return json(b,201);
 }
 const match=path.match(/^\/(admin\/)?bookings\/([a-f0-9]{16})$/);
 if(match&&method==='POST'){
 const input=await body(req);const b=await transaction(async c=>{
 await c.query('LOCK TABLE bookings IN SHARE ROW EXCLUSIVE MODE');const {rows}=await c.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[match[2]]);if(!rows.length)throw new HttpError(404,'Booking not found.');let b=plain(rows[0]);if(!u.admin&&b.owner_email!==u.email)throw new HttpError(403,'This booking belongs to another user.');const previous=b.status;let action;
 if(input.action==='edit'){
 if(!u.admin&&!['pending','needs-info'].includes(b.status))throw new HttpError(409,'Contact the administrator to change a confirmed booking.');
 if(['cancelled','declined','maintenance'].includes(b.status))throw new HttpError(409,'This booking cannot be edited.');
 const v=validateBooking(input,{allowPast:u.admin});await noConflict(c,v.start,v.end,b.id);Object.assign(b,{start_date:v.start,end_date:v.end,weeks:v.weeks,details:v.details,status:b.status==='needs-info'?'pending':b.status});action=b.status==='confirmed'?'rescheduled':'updated';
 }else if(input.action==='cancel'){
 if(!['pending','needs-info','confirmed','maintenance'].includes(previous))throw new HttpError(409,'This booking is already closed.');b.status='cancelled';action=previous==='confirmed'?'cancelled':'withdrawn';
 }else{
 if(!u.admin)throw new HttpError(403,'Administrator access is required.');
 if(!['confirm','decline','needs-info','billing'].includes(input.action))throw new HttpError(400,'Unknown booking action.');
 if(input.action==='billing'){if(!['unbilled','billed','paid'].includes(input.billingStatus))throw new HttpError(400,'Invalid billing status.');b.billing_status=input.billingStatus;action='billing updated';}
 else{if(!['pending','needs-info'].includes(previous))throw new HttpError(409,'Only pending requests can be reviewed.');b.status={confirm:'confirmed',decline:'declined','needs-info':'needs-info'}[input.action];action=b.status==='confirmed'?'confirmed':b.status;
 if(b.status==='confirmed'){await noConflict(c,b.start_date,b.end_date,b.id);await participants(c,b);const people=await c.query('SELECT email,trained FROM users WHERE email=ANY($1::text[])',[b.details.students.map(s=>s.email)]);const all=b.details.students.every(s=>people.rows.some(p=>p.email===s.email&&p.trained));if(!all&&input.trainingOverride!==true)throw new HttpError(409,'Some users have unverified training. Verify training or acknowledge supervised use.');if(!all&&!String(input.note||'').trim())throw new HttpError(400,'Record the supervision/training arrangement in the administrator note.');}
 }
 b.admin_note=String(input.note??b.admin_note).slice(0,3000);
 }
 const saved=await c.query('UPDATE bookings SET status=$2,start_date=$3,end_date=$4,weeks=$5,details=$6,admin_note=$7,billing_status=$8,updated_at=now() WHERE id=$1 RETURNING *',[b.id,b.status,b.start_date,b.end_date,b.weeks,b.details,b.admin_note,b.billing_status]);b=plain(saved.rows[0]);await audit(c,b,u,action);
 if(previous!=='maintenance'&&action!=='billing updated')await bookingMail(c,b,action);return b;
 });return json(b);
 }
 if(path==='/admin/export')return await exportWorkbook();
 if(path==='/admin/data'){
 const [b,people,mail,settings,history]=await Promise.all([db().pool.query('SELECT * FROM bookings ORDER BY start_date DESC'),db().pool.query('SELECT * FROM users ORDER BY name'),db().pool.query('SELECT id,recipient,subject,status,attempts,last_error,created_at,sent_at FROM mail_queue ORDER BY id DESC LIMIT 100'),db().pool.query("SELECT key FROM settings WHERE key='gmail_refresh'"),db().pool.query('SELECT * FROM activity ORDER BY id DESC LIMIT 100')]);return json({bookings:b.rows.map(plain),users:people.rows,mail:mail.rows,gmailConnected:settings.rows.length>0,activity:history.rows});
 }
 if(path==='/admin/users'&&method==='POST'){const b=await body(req),e=email(b.email);if(typeof b.trained!=='boolean'||typeof b.active!=='boolean')throw new HttpError(400,'Invalid user status.');await db().pool.query('INSERT INTO users(email,name,trained,trained_at,training_note,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO UPDATE SET name=excluded.name,trained=excluded.trained,trained_at=excluded.trained_at,training_note=excluded.training_note,active=excluded.active',[e,required(b.name,'Name'),b.trained,b.trainedAt?date(b.trainedAt):null,String(b.note||'').slice(0,1000),b.active]);return json({ok:true});}
 if(path==='/admin/maintenance'&&method==='POST'){const input=await body(req),start=date(input.start),weeks=Number(input.weeks),end=endDate(start,weeks);const b=await transaction(async c=>{await c.query('LOCK TABLE bookings IN SHARE ROW EXCLUSIVE MODE');await noConflict(c,start,end);const {rows}=await c.query("INSERT INTO bookings(id,owner_email,status,start_date,end_date,weeks,details,admin_note) VALUES($1,$2,'maintenance',$3,$4,$5,$6,$7) RETURNING *",[id(),u.email,start,end,weeks,{piName:'Maintenance',students:[]},String(input.note||'').slice(0,3000)]);await audit(c,rows[0],u,'maintenance reserved');return plain(rows[0]);});return json(b);}
 if(path==='/admin/mail/retry'&&method==='POST'){await db().pool.query("UPDATE mail_queue SET status='queued',attempts=0,next_attempt=now() WHERE status='failed'");return json(await sendQueued());}
 throw new HttpError(404,'Page not found.');
 }catch(e){if(!e.status)console.error('CLAMS request failed:',e.code||e.name);return json({error:e.status?e.message:'The service is unavailable. Please try again or contact clams.booking.mun@gmail.com.'},e.status||503);}}
