// Local-only QA server. Never loaded by Netlify functions or published as an asset.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {useDatabase} from './db.mjs';
import {hash} from './auth.mjs';
import {handle} from './api.mjs';
const pg=new PGlite();await pg.exec(await readFile(new URL('../netlify/database/migrations/001_initial.sql',import.meta.url),'utf8'));
useDatabase({pool:{query:(s,p)=>pg.query(s,p),connect:async()=>({query:(s,p)=>pg.query(s,p),release(){}})}});
process.env.SESSION_SECRET='local-preview-only-secret-not-for-production';process.env.ADMIN_EMAILS='preview@example.com';
await pg.query("INSERT INTO users(email,name,trained) VALUES('preview@example.com','Preview administrator',true)");await pg.query("INSERT INTO sessions(hash,email,expires_at) VALUES($1,'preview@example.com',now()+interval '1 day')",[hash('preview-only')]);
const server=http.createServer(async(req,res)=>{try{let url=new URL(req.url,`http://${req.headers.host}`);if(url.pathname==='/api/auth/start'){res.writeHead(302,{'Set-Cookie':'clams_session=preview-only; HttpOnly; SameSite=Lax; Path=/','Location':'/#admin'});res.end();return;}
if(url.pathname.startsWith('/api/')){let chunks=[];for await(const c of req)chunks.push(c);const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});let response=await handle(request);if(url.pathname==='/api/config'){let b=await response.json();b.development=true;response=Response.json(b);}res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
const files={'/':'index.html','/style.css':'style.css','/app.js':'app.js'};if(!files[url.pathname]){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(new URL('../public/'+files[url.pathname],import.meta.url)));}catch(e){res.writeHead(500);res.end('Local preview error');console.error(e);}});
server.listen(Number(process.argv[process.argv.indexOf('--port')+1])||Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('CLAMS local QA server ready'));
