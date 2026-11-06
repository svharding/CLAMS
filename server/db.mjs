import {getDatabase} from '@netlify/database';
let database;
export function db(){return database??=getDatabase();}
export function useDatabase(value){database=value;}
export async function transaction(fn){const c=await db().pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export const env=(name)=>globalThis.Netlify?.env?.get(name)??process.env[name];
