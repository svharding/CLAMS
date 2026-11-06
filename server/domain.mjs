export const MAILBOX='clams.booking.mun@gmail.com';
export const RATE=300;
export const OUTCOMES=['Oxygen consumption (VO₂)','Carbon dioxide production (VCO₂)','Respiratory exchange ratio (RER)','Energy expenditure','Food intake','Water intake','Locomotor activity','Other'];
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export function required(v,label,max=200){if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw new HttpError(400,`${label} is required (maximum ${max} characters).`);return v.trim();}
export function email(v){v=required(v,'Email',254).toLowerCase();if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)||/[\r\n]/.test(v))throw new HttpError(400,'Enter a valid email address.');return v;}
export function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new HttpError(400,'Enter a valid date.');return v;}
export function endDate(start,weeks){date(start);if(!Number.isInteger(weeks)||weeks<1||weeks>52)throw new HttpError(400,'Choose 1–52 whole weeks.');const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+weeks*7);return d.toISOString().slice(0,10);}
export function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/St_Johns',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function validateBooking(input,{allowPast=false}={}){
 const start=date(input.start);const weeks=Number(input.weeks);const end=endDate(start,weeks);
 if(!allowPast&&start<today())throw new HttpError(400,'Choose a start date today or later.');
 const d=input.details||{};const details={};
 for(const [key,label,max] of [['piName','PI name',150],['department','Department/division',200],['faculty','Faculty',200],['projectTitle','Research project title',500],['fundingAgency','Funding agency',300],['fundingProgram','Funding program',300],['foapal','FOAPAL',120],['contactName','Primary contact name',150],['species','Species',100]])details[key]=required(d[key],label,max);
 details.piEmail=email(d.piEmail);details.contactEmail=email(d.contactEmail);
 details.students=(Array.isArray(d.students)?d.students:[]).map(s=>({name:required(s.name,'User name',150),email:email(s.email),training:['trained','not-trained','unsure'].includes(s.training)?s.training:'unsure',trainingDate:s.trainingDate?date(s.trainingDate):''}));
 if(!details.students.length||details.students.length>30)throw new HttpError(400,'Add 1–30 equipment users.');
 if(new Set(details.students.map(s=>s.email)).size!==details.students.length)throw new HttpError(400,'Each equipment user must have a unique email.');
 details.outcomes=(Array.isArray(d.outcomes)?d.outcomes:[]).filter(x=>OUTCOMES.includes(x));
 if(!details.outcomes.length)throw new HttpError(400,'Select at least one outcome of interest.');
 details.outcomeNotes=String(d.outcomeNotes||'').slice(0,3000);details.notes=String(d.notes||'').slice(0,3000);
 if(details.outcomes.includes('Other')&&!details.outcomeNotes.trim())throw new HttpError(400,'Describe the other outcomes.');
 if(d.cleaning!==true||d.publicContact!==true||d.feeAgreement!==true)throw new HttpError(400,'Accept the cleaning, public contact and fee acknowledgements.');
 Object.assign(details,{cleaning:true,publicContact:true,feeAgreement:true});return {start,end,weeks,details};
}
export const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
export function publicBooking(b){return {id:b.id,start:b.start_date,end:b.end_date,status:b.status,piName:b.status==='maintenance'?'Maintenance':b.details.piName,contactEmail:b.status==='maintenance'?'':b.details.contactEmail};}
export function notice(b){return `${b.details.piName}\n${b.start_date} to ${b.end_date} (end date is the release date)\nPrimary contact: ${b.details.contactName} <${b.details.contactEmail}>`;}
