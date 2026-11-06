import {sendQueued} from '../../server/mail.mjs';
export default async()=>{await sendQueued();};
// Every five minutes, UTC; interval is independent of Newfoundland DST.
export const config={schedule:'*/5 * * * *'};
