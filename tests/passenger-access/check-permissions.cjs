const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const targets=JSON.parse(fs.readFileSync(path.join(__dirname,'private-objects.json'),'utf8').replace(/^\uFEFF/,''));
const bin=process.env.PSQL_BIN || 'psql';
let checks=0;
function sql(text,allowed){
 const r=cp.spawnSync(bin,['-h','127.0.0.1','-p','55497','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At','-c',text],{encoding:'utf8',windowsHide:true});
 if(r.error)throw r.error;
 if(allowed)assert.equal(r.status,0,r.stderr);
 else {assert.notEqual(r.status,0);assert.match(r.stderr,/permission denied/);}
 checks++;
}
for(const role of ['anon','authenticated']){
 for(const t of [...targets.tables,...targets.views])sql(`SET ROLE ${role}; SELECT * FROM public.${t} WHERE false`,false);
 for(const signature of targets.fns){const [name,params]=signature.split('(');const args=params.slice(0,-1).split(',').map(t=>'NULL::'+t).join(',');sql(`SET ROLE ${role}; SELECT public.${name}(${args})`,false);}
}
for(const t of [...targets.tables,...targets.views])sql(`SET ROLE service_role; SELECT count(*) FROM public.${t}`,true);
for(const signature of targets.fns){const [name,params]=signature.split('(');const args=params.slice(0,-1).split(',').map(t=>'NULL::'+t).join(',');sql(`SET ROLE service_role; SELECT public.${name}(${args})`,true);}
console.log(`PASS ${checks} local PostgreSQL permission checks: public access denied and server access preserved.`);
