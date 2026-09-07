const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
function load(source, file) { const m=new Module(file,module);m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);return m.exports; }
const {isRemovedDriver}=load(fs.readFileSync('lib/live-driver-roster.ts','utf8'),'live-driver-roster-test');
for(const status of ['inactive','terminated','deactivated','removed','removed_from_pilot','deleted','pending']) {
 assert(isRemovedDriver({driver_status:status}));assert(isRemovedDriver({driver_status:'online',roster_status:' '+status.toUpperCase()+' '}));
}
assert(!isRemovedDriver({driver_status:'offline',roster_status:'active'}));
assert(!isRemovedDriver({driver_status:'online',roster_status:null}));
const source=fs.readFileSync('app/admin/livetrips/LiveTripsClient.tsx','utf8');
const ast=ts.createSourceFile('client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='mergeDriverRows');
const {mergeDriverRows}=load(fn.getText(ast)+'\nexport {mergeDriverRows};','merge-test');
const known=[{driver_id:'allowed',updated_at:'2026-09-08T00:00Z',lat:1}];
assert.strictEqual(mergeDriverRows(known,{driver_id:'removed',lat:2}),known);
assert.deepEqual(mergeDriverRows([], {driver_id:'removed',lat:2}),[]);
assert.equal(mergeDriverRows(known,{driver_id:'allowed',lat:3})[0].lat,3);
assert.equal(known[0].lat,1);
for(const route of ['app/api/admin/driver_locations/route.ts','app/api/admin/livetrips/page-data/route.ts']) {
 const s=fs.readFileSync(route,'utf8');assert(s.includes('isRemovedDriver('));assert(s.includes('roster_status'));
}
console.log('PASS LiveTrips status filters, retained offline drivers, rejected GPS reinsertion, and updates to existing drivers');
