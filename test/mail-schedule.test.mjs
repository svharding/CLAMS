import test from 'node:test';
import assert from 'node:assert/strict';
import {isMailWindow} from '../server/mail-schedule.mjs';
test('Newfoundland weekday schedule respects both DST offsets and weekends',()=>{
 for(const t of ['2026-11-09T11:30:00Z','2026-11-09T17:30:00Z','2026-07-06T10:30:00Z','2026-07-06T16:30:00Z'])assert.equal(isMailWindow(new Date(t)),true,t);
 for(const t of ['2026-11-09T10:30:00Z','2026-11-09T16:30:00Z','2026-07-06T11:30:00Z','2026-07-06T17:30:00Z','2026-11-08T11:30:00Z','2026-11-09T11:31:00Z'])assert.equal(isMailWindow(new Date(t)),false,t);
});
