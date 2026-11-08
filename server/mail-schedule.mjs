export function isMailWindow(now = new Date()) {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'America/St_Johns',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return ['Mon','Tue','Wed','Thu','Fri'].includes(parts.weekday) && ['08','14'].includes(parts.hour) && parts.minute === '00';
}
