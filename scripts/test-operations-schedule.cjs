const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const file = require('node:path').resolve('lib/operations-schedule.ts');
const mod = new Module(file, module);
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { emptySchedule, changeSchedule, monthDays, nextMonth, weekStart, restCount, issues } = mod.exports;
const admin = { email: 'admin@example.test', role: 'admin', name: 'Admin' };
const approved = ['a@example.test', 'b@example.test', 'c@example.test'];
const actors = approved.map((email, i) => ({ email, role: 'dispatcher', name: `Person ${i + 1}` }));
const now = new Date('2026-09-07T00:00:00Z');
const apply = (s, actor, action, extras = {}, at = now, drivers = []) => changeSchedule(s, actor, { action, ...extras }, at, approved, drivers).state;
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
let base = mod.exports.effectiveSchedule(emptySchedule()); base.employees.forEach((e,i) => e.email=approved[i]);
base = apply(base, admin, 'open_month', { month: '2026-10' });
test('next month uses Philippine date at month boundary', () => assert.equal(nextMonth(new Date('2026-09-30T17:00:00Z')), '2026-11'));
test('October includes complete boundary weeks', () => { assert.equal(monthDays('2026-10')[0], '2026-09-28'); assert.equal(monthDays('2026-10').at(-1), '2026-11-01'); });
test('leap year and year rollover', () => { assert(monthDays('2028-02').includes('2028-02-29')); assert.equal(nextMonth(new Date('2026-12-15Z')), '2027-01'); });
test('unauthorized coordinator cannot set up roster', () => assert.throws(() => apply(base, actors[0], 'setup', { employees: [] }), /cannot be edited/));
test('unmapped account cannot claim', () => assert.throws(() => apply(base, { ...actors[0], email: 'other@example.test' }, 'claim', { day: '2026-10-01', duty: 'primary' }), /link your account/));
test('employee cannot impersonate another coordinator', () => { const s = apply(base, actors[0], 'claim', { day: '2026-10-01', duty: 'primary', employee: 'coordinator-2' }); assert.equal(s.slots['2026-10-01/primary'].owner, 'coordinator-1'); });
let claimed = apply(base, actors[0], 'claim', { day: '2026-10-01', duty: 'primary' });
test('cannot claim an owned duty', () => assert.throws(() => apply(claimed, actors[1], 'claim', { day: '2026-10-01', duty: 'primary' }), /already owns/));
test('Primary and Backup cannot be same person', () => assert.throws(() => apply(claimed, actors[0], 'claim', { day: '2026-10-01', duty: 'backup' }), /different people/));
test('Core and Evening may share an employee', () => assert.equal(apply(claimed, actors[0], 'claim', { day: '2026-10-01', duty: 'evening' }).slots['2026-10-01/evening'].owner, 'coordinator-1'));
test('future release and bawi', () => { const s = apply(claimed, actors[0], 'release', { day: '2026-10-01', duty: 'primary' }); assert.equal(s.slots['2026-10-01/primary'].owner, null); assert.equal(apply(s, actors[0], 'claim', { day: '2026-10-02', duty: 'backup' }).slots['2026-10-02/backup'].owner, 'coordinator-1'); });
test('release is rejected exactly 24 hours before start', () => assert.throws(() => apply(claimed, actors[0], 'release', { day: '2026-10-01', duty: 'primary' }, new Date('2026-09-30T02:00Z')), /Within 24/));
test('coverage retains owner until accepted and cannot be accepted twice', () => { const s = apply(claimed, actors[0], 'coverage', { day: '2026-10-01', duty: 'primary', note: 'Vendor visit' }); assert.equal(s.slots['2026-10-01/primary'].owner, 'coordinator-1'); const t = apply(s, actors[1], 'accept', { day: '2026-10-01', duty: 'primary' }); assert.deepEqual(t.slots['2026-10-01/primary'], { owner: 'coordinator-2', coverage: false }); assert.throws(() => apply(t, actors[2], 'accept', { day: '2026-10-01', duty: 'primary' }), /no longer available/); });
test('backup cannot take Primary without replacement for Backup', () => { let s = apply(claimed, actors[1], 'claim', { day: '2026-10-01', duty: 'backup' }); s = apply(s, actors[0], 'coverage', { day: '2026-10-01', duty: 'primary', note: 'Need cover' }); assert.throws(() => apply(s, actors[1], 'accept', { day: '2026-10-01', duty: 'primary' }), /different people/); });
test('rest conflicts, third rest and duty-rest overlap are rejected', () => { let s = apply(base, actors[0], 'rest', { day: '2026-09-28' }); assert.throws(() => apply(s, actors[1], 'rest', { day: '2026-09-28' }), /Another coordinator/); s = apply(s, actors[0], 'rest', { day: '2026-09-29' }); assert.equal(restCount(s, 'coordinator-1', '2026-09-28'), 2); assert.throws(() => apply(s, actors[0], 'rest', { day: '2026-10-01' }), /already have two/); assert.throws(() => apply(s, actors[0], 'claim', { day: '2026-09-28', duty: 'primary' }), /rest day/); assert.throws(() => apply(claimed, actors[0], 'rest', { day: '2026-10-01' }), /release your duties/); });
test('Admin override needs reason and retains safe coverage constraints', () => { assert.throws(() => apply(claimed, admin, 'override', { day: '2026-10-01', duty: 'primary', employee: 'coordinator-2' }), /reason/); const s = apply(claimed, admin, 'override', { day: '2026-10-01', duty: 'primary', employee: 'coordinator-2', note: 'Approved coverage' }); assert.equal(s.slots['2026-10-01/primary'].owner, 'coordinator-2'); });
test('past and ended assignments cannot be changed', () => assert.throws(() => apply(claimed, admin, 'override', { day: '2026-10-01', duty: 'primary', employee: 'coordinator-2', note: 'Late edit' }, new Date('2026-10-01T07:00Z')), /ended/));
test('exact two rest days and coverage required before finalizing', () => { assert.throws(() => apply(base, admin, 'publish', { month: '2026-10' }), /Complete all duties/); let s = JSON.parse(JSON.stringify(base)); for (const [i, day] of monthDays('2026-10').entries()) { const weekday = i % 7; if (weekday < 6) s = apply(s, admin, 'rest', { day, employee: `coordinator-${Math.floor(weekday / 2) + 1}` }); if (day.startsWith('2026-10')) { const ids = ['coordinator-1','coordinator-2','coordinator-3'].filter(id => id !== s.rests[day]); s = apply(s, admin, 'override', { day, duty: 'primary', employee: ids[0], note: 'Plan' }); s = apply(s, admin, 'override', { day, duty: 'backup', employee: ids[1], note: 'Plan' }); s = apply(s, admin, 'override', { day, duty: 'evening', employee: ids[0], note: 'Plan' }); } } assert.equal(issues(s, '2026-10').length, 0); s = apply(s, admin, 'publish', { month: '2026-10' }); assert(s.months['2026-10']); s = apply(s, admin, 'unrest', { day: '2026-09-28', employee: 'coordinator-1' }); assert.equal(s.months['2026-10'], false); });
test('balanced random teams balance towns and total sizes', () => { const drivers = ['Lagawe','Hingyon','Banaue','Lamut'].flatMap((town, j) => Array.from({ length: [43,2,31,34][j] }, (_, i) => ({ id: town + i, name: town + i, town }))); for (let trial = 0; trial < 30; trial++) { const s = apply(base, admin, 'balance_teams', { note: 'Initial teams' }, now, drivers); const counts = base.employees.map(e => Object.values(s.teams).filter(id => id === e.id).length); assert(Math.max(...counts) - Math.min(...counts) <= 1); for (const town of ['Lagawe','Hingyon','Banaue','Lamut']) { const counts = base.employees.map(e => drivers.filter(d => d.town === town && s.teams[d.id] === e.id).length); assert(Math.max(...counts) - Math.min(...counts) <= 1); } assert.equal(Object.keys(s.teams).length, drivers.length); } });
test('audit records original and new ownership without mutating input', () => { const result = changeSchedule(claimed, admin, { action: 'override', day: '2026-10-01', duty: 'primary', employee: 'coordinator-2', note: 'Approved' }, now, approved); assert.equal(result.event.before.slots['2026-10-01/primary'].owner, 'coordinator-1'); assert.equal(result.event.after.slots['2026-10-01/primary'].owner, 'coordinator-2'); assert.equal(claimed.slots['2026-10-01/primary'].owner, 'coordinator-1'); });
test('invalid dates and non-ASCII notes are rejected', () => { assert.throws(() => apply(base, actors[0], 'claim', { day: '2026-02-30', duty: 'primary' }), /valid date/); assert.throws(() => apply(base, actors[0], 'claim', { day: '2026-10-01', duty: 'primary', note: '\u00e9' }), /ASCII/); });
test('Admin assigns tasks; only the assignee confirms completion with details', () => { const s = apply(base, admin, 'create_task', { title: 'Visit vendor', instructions: 'Meet the owner and finish the profile.', employee: 'coordinator-1', due: '2026-09-07' }); const taskId = Object.keys(s.tasks)[0]; assert.throws(() => apply(s, actors[1], 'complete_task', { taskId, note: 'Done' }), /assigned employee/); assert.throws(() => apply(s, actors[0], 'complete_task', { taskId }), /completion note/); const done = apply(s, actors[0], 'complete_task', { taskId, note: 'Met the owner; profile and opening hours completed.' }); assert.equal(done.tasks[taskId].status, 'done'); assert.equal(done.tasks[taskId].completedBy, actors[0].email); assert.throws(() => apply(done, actors[0], 'reopen_task', { taskId, note: 'More work' }), /Only Admin/); assert.equal(apply(done, admin, 'reopen_task', { taskId, note: 'Please verify menu photos.' }).tasks[taskId].status, 'open'); });
test('Employees cannot assign tasks and past task deadlines are rejected', () => { const fields = { title: 'Profile', instructions: 'Finish profile', employee: 'coordinator-1', due: '2026-09-07' }; assert.throws(() => apply(base, actors[0], 'create_task', fields), /Only Admin/); assert.throws(() => apply(base, admin, 'create_task', { ...fields, due: '2026-09-06' }), /today or a future/); });

test('one-time identity is permanent, unique, and tied to the staff account', () => {
 let s=apply(emptySchedule(),actors[0],'identify',{employee:'coordinator-1'});
 assert.equal(s.employees[0].name,'Marcus'); assert.equal(s.employees[0].email,actors[0].email);
 assert.throws(()=>apply(s,actors[0],'identify',{employee:'coordinator-2'}),/already saved/);
 assert.throws(()=>apply(s,actors[1],'identify',{employee:'coordinator-1'}),/already linked/);
 assert.throws(()=>apply(s,admin,'setup',{}),/cannot be edited/);
 assert.throws(()=>apply(s,{email:'fake@example.test',role:'dispatcher',name:'Fake'},'identify',{employee:'coordinator-2'}),/approved employee/);
});
test('September starts on the eighth and has 69 duty slots',()=>{
 assert.equal(monthDays('2026-09')[0],'2026-09-08');
 assert.equal(monthDays('2026-09').filter(d=>d.startsWith('2026-09')).length*3,69);
 const s=mod.exports.effectiveSchedule(emptySchedule());
 const problems=issues(s,'2026-09');
 assert(problems.some(p=>p.includes('2026-09-07')));
 assert(!problems.some(p=>p.includes('2026-08-31')));
 assert.throws(()=>apply(s,admin,'rest',{day:'2026-09-07',employee:'coordinator-1'}),/September 8/);
});

test('September can finalize with seven rest days each and no pre-launch assignments', () => {
  let s = mod.exports.effectiveSchedule(emptySchedule()); s.employees.forEach((e,i) => e.email=approved[i]);
  const days=monthDays('2026-09');
  for(const day of days) {
    const w=weekStart(day), offset=Math.round((new Date(day)-new Date(w))/86400000);
    const id=w==='2026-09-07' ? Math.floor((offset-1)/2)+1 : w==='2026-09-28' ? offset%3+1 : Math.floor(offset/2)+1;
    if((w==='2026-09-07' || offset<6) && id<=3) s.rests[day]='coordinator-'+id;
    if(day.startsWith('2026-09')) {
      const available=s.employees.filter(e=>e.id!==s.rests[day]);
      for(const [duty, i] of [['primary',0],['backup',1],['evening',0]]) s.slots[day+'/'+duty]={owner:available[i].id,coverage:false};
    }
  }
  assert.deepEqual(issues(s,'2026-09'),[]);
  assert.equal(apply(s,admin,'publish',{month:'2026-09'}).months['2026-09'],true);
});
const eventDraft = { title: 'Vendor information drive', category: 'Information drive', audience: 'Vendors', location: 'Lagawe', day: '2026-10-01', start: '10:00', end: '12:00', participants: ['coordinator-1'], note: 'Include travel' };
test('events are Admin-only and validate dates, times and participants', () => {
  assert.throws(() => apply(base,actors[0],'create_event',eventDraft),/Only Admin/);
  for (const patch of [{day:'2026-09-07'},{end:'09:00'},{participants:[]},{participants:['coordinator-1','coordinator-1']},{title:'Bad\u00e9'},{audience:'Other'}]) assert.throws(() => apply(base,admin,'create_event',{...eventDraft,...patch}));
});
test('event conflicts preserve owners and reset finalized planning', () => {
  const before=JSON.parse(JSON.stringify(claimed));before.months['2026-10']=true;
  const s=apply(before,admin,'create_event',eventDraft);
  assert.deepEqual(s.slots,before.slots);assert.equal(s.months['2026-10'],false);
  assert(issues(s,'2026-10').some(c=>c.includes('current owner remains responsible')));
});
test('event blocks new duties and rest but permits non-overlapping shifts', () => {
  const s=apply(base,admin,'create_event',eventDraft);
  assert.throws(()=>apply(s,actors[0],'claim',{day:eventDraft.day,duty:'primary'}),/overlaps/);
  assert.throws(()=>apply(s,actors[0],'rest',{day:eventDraft.day}),/event/);
  assert(apply(s,actors[0],'claim',{day:eventDraft.day,duty:'evening'}).slots['2026-10-01/evening'].owner);
  const e=Object.values(s.plannedEvents)[0];
  assert.equal(mod.exports.eventBlocksDuty({...e,start:'09:00',end:'10:00'},'primary'),false);
  assert.equal(mod.exports.eventBlocksDuty({...e,start:'15:00',end:'16:00'},'primary'),false);
});
test('overlapping events and existing rest are visible conflicts; cancellation unblocks',()=>{
  let s=apply(base,actors[0],'rest',{day:eventDraft.day});s=apply(s,admin,'create_event',eventDraft);
  assert(issues(s,'2026-10').some(c=>c.includes('move the rest day')));
  s=apply(s,admin,'create_event',{...eventDraft,title:'Training'},new Date(now.getTime()+1));
  assert(issues(s,'2026-10').some(c=>c.includes('another event overlaps')));
  for(const eventId of Object.keys(s.plannedEvents)) {
    assert.throws(()=>apply(s,actors[0],'cancel_event',{eventId,note:'Reason'}),/Only Admin/);
    assert.throws(()=>apply(s,admin,'cancel_event',{eventId}),/reason/);
    s=apply(s,admin,'cancel_event',{eventId,note:'Reschedule'});
  }
  assert.equal(mod.exports.eventsOn(s,eventDraft.day).length,0);
  assert.equal(Object.keys(s.plannedEvents).length,2);
});
const rosterFile=require('node:path').resolve('lib/operations-driver-roster.ts');
const rosterModule=new Module(rosterFile,module);
rosterModule._compile(ts.transpileModule(fs.readFileSync(rosterFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,rosterFile);
test('team roster excludes removed records, deduplicates LiveTrips and uses registered towns',()=>{
 const locations=['good','terminated','inactive','removed','good'].map(driver_id=>({driver_id,home_town:'Lamut'}));
 const ids=[{id:'good',driver_status:'offline'}, {id:'terminated',driver_status:'offline',roster_status:'terminated'}, {id:'inactive',roster_status:'inactive'}, {id:'removed',driver_status:'removed_from_pilot'}, {id:'not-in-livetrips',roster_status:'active'}];
 const result=rosterModule.exports.operationsDriverRoster(locations,ids,[{driver_id:'good',municipality:'lagawe'}]);
 assert.deepEqual(result,[{id:'good',name:'Unnamed driver',town:'Lagawe'}]);
});
console.log(`${count} Operations Schedule tests passed.`);
