import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {useDatabase} from '../server/db.mjs';
import {handle} from '../server/api.mjs';
import {hash,seal,unseal,signed,unsigned} from '../server/auth.mjs';
import {endDate,validateBooking,publicBooking} from '../server/domain.mjs';
const pg=new PGlite();
const pool={query:(sql,params)=>pg.query(sql,params),connect:async()=>({query:(sql,params)=>pg.query(sql,params),release(){}})};
useDatabase({pool});process.env.SESSION_SECRET='test-only-secret-of-at-least-32-characters';process.env.ADMIN_EMAILS='admin@example.com';
const data={start:'2030-03-01',weeks:1,details:{piName:'Test PI',piEmail:'pi@example.com',department:'Human Biosciences',faculty:'Science',contactName:'Test Student',contactEmail:'student@example.com',foapal:'001-002-003',projectTitle:'Private project',fundingAgency:'NSERC',fundingProgram:'Discovery',species:'Mouse',students:[{name:'Test Student',email:'student@example.com',training:'trained',trainingDate:''}],outcomes:['Energy expenditure'],notes:'',cleaning:true,publicContact:true,feeAgreement:true}};
async function call(path,token='',data){const headers={cookie:'clams_session='+token,origin:'https://clams.test'};const req=new Request('https://clams.test/api'+path,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data)});const r=await handle(req);return {status:r.status,data:r.headers.get('Content-Type')?.includes('json')?await r.json():await r.arrayBuffer()};}
test('booking workflow enforces permissions, fees, privacy, training and collisions',async()=>{
 await pg.exec(await readFile(new URL('../netlify/database/migrations/001_initial.sql',import.meta.url),'utf8'));
 for(const [email,token]of [['admin@example.com','admin'],['requester@example.com','owner'],['other@example.com','other']]){await pg.query('INSERT INTO users(email,name) VALUES($1,$1)',[email]);await pg.query("INSERT INTO sessions(hash,email,expires_at) VALUES($1,$2,now()+interval '1 day')",[hash(token),email]);}
 assert.equal((await call('/admin/data')).status,401);assert.equal((await call('/admin/data','owner')).status,403);
 let r=await call('/bookings','owner',{...data,weeks:0});assert.equal(r.status,400);
 r=await call('/bookings','owner',data);assert.equal(r.status,201);let b=r.data;assert.equal(b.weeks*b.rate,300);assert.equal(b.end_date,'2030-03-08');
 assert.equal((await call('/calendar')).data.length,0);
 assert.equal((await call('/bookings/'+b.id,'other',{action:'cancel'})).status,403);
 assert.equal((await call('/admin/bookings/'+b.id,'admin',{action:'confirm'})).status,409);
 assert.equal((await call('/admin/bookings/'+b.id,'admin',{action:'confirm',trainingOverride:true})).status,400);
 await call('/admin/users','admin',{name:'Test Student',email:'student@example.com',trained:true,active:true,note:'Verified',trainedAt:'2029-01-01'});
 r=await call('/admin/bookings/'+b.id,'admin',{action:'confirm'});assert.equal(r.status,200);assert.equal(r.data.status,'confirmed');
 const visible=(await call('/calendar')).data[0];assert.equal(visible.contactEmail,'student@example.com');assert.equal(visible.piName,'Test PI');assert.equal(visible.details,undefined);assert.equal(JSON.stringify(visible).includes('001-002'),false);
 assert.equal((await call('/admin/bookings/'+b.id,'admin',{action:'confirm'})).status,409);
 assert.equal((await call('/bookings','owner',data)).status,409);
 const adjacent=await call('/bookings','owner',{...data,start:'2030-03-08'});assert.equal(adjacent.status,201);
 assert.equal((await call('/admin/maintenance','admin',{start:'2030-03-01',weeks:1})).status,409);
 const pendingOverlap=await call('/bookings','other',{...data,start:'2030-03-08'});assert.equal(pendingOverlap.status,201);
 assert.equal((await call('/admin/bookings/'+adjacent.data.id,'admin',{action:'confirm'})).status,200);
 assert.equal((await call('/admin/bookings/'+pendingOverlap.data.id,'admin',{action:'confirm'})).status,409);
 assert.equal((await call('/admin/bookings/'+b.id,'admin',{action:'billing',billingStatus:'paid'})).status,200);
 assert.equal((await call('/admin/export','admin')).status,200);
 const mail=await pg.query("SELECT body FROM mail_queue WHERE recipient='other@example.com' AND subject LIKE '%reservation confirmed%'");assert.ok(mail.rows.length);assert.ok(mail.rows.every(m=>!m.body.includes('Private project')&&!m.body.includes('001-002')));
 r=await call('/bookings/'+b.id,'owner',{action:'cancel'});assert.equal(r.status,200);assert.equal(r.data.status,'cancelled');
 assert.equal((await call('/bookings','owner',data)).status,201);
 const csrf=await handle(new Request('https://clams.test/api/bookings',{method:'POST',headers:{cookie:'clams_session=owner',origin:'https://attacker.test'},body:JSON.stringify(data)}));assert.equal(csrf.status,403);
 await pg.close();
});
test('calendar arithmetic and input constraints',()=>{
 assert.equal(endDate('2028-02-26',1),'2028-03-04');assert.equal(endDate('2030-12-28',2),'2031-01-11');
 assert.throws(()=>endDate('2030-02-30',1));assert.throws(()=>endDate('2030-03-01',1.5));
 assert.throws(()=>validateBooking({...data,details:{...data.details,cleaning:false}}));
 assert.throws(()=>validateBooking({...data,details:{...data.details,contactEmail:'a@b.com\r\nBcc: bad@b.com'}}));
 assert.equal(validateBooking(data).details.foapal,'001-002-003');
 assert.deepEqual(Object.keys(publicBooking({id:'x',status:'maintenance',start_date:'2030-01-01',end_date:'2030-01-08',details:{foapal:'secret'}})),['id','start','end','status','piName','contactEmail']);
});
test('authorization state and encrypted Gmail token reject tampering',()=>{
 const token=seal('private-token');assert.equal(unseal(token),'private-token');assert.ok(!token.includes('private-token'));
 const state=signed({expires:Date.now()+10000,state:'abc'});assert.equal(unsigned(state).state,'abc');assert.equal(unsigned(state+'x'),null);assert.equal(unsigned(signed({expires:0})),null);
});
