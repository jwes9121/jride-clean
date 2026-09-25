const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '../..');
let passed = 0;
function harness(options = {}) {
  const calls = [];
  const booking = { id: 'ride', booking_code: 'JR-FIXTURE', created_by_user_id: 'owner', status: 'ready',
    driver_id: 'driver', verified_fare: 40, proposed_fare: 40, pickup_distance_fee: 60,
    driver_to_pickup_km: 2.85678, trip_distance_km: 1.930173, ride_fare_mode: 'short_trip_automatic_v1',
    ...options.booking };
  const db = { from(table) {
    const q = { select() { return q; }, eq() { return q; }, limit() { return q; }, maybeSingle() { return q; },
      then(resolve, reject) { calls.push(table); const rows = {
        bookings: booking, drivers: { driver_name: 'Fixture Driver' },
        driver_profiles: { full_name: 'Fixture Driver', phone: '+639001234567', photo_url: 'https://fixture.invalid/photo.jpg', vehicle_type: 'tricycle', plate_number: 'TEST-123' },
        driver_locations_latest: { lat: 16.65, lng: 121.21, updated_at: options.updatedAt === undefined ? new Date(Date.now() - 30000).toISOString() : options.updatedAt },
        trip_ratings: [{ rating: 5 }],
      }; return Promise.resolve({ data: options.failTable === table ? null : rows[table], error: options.failTable === table ? { message: 'unavailable' } : null }).then(resolve,reject); }
    }; return q;
  }};
  class NextResponse { static json(body, init = {}) { return { body, status: init.status || 200, headers: init.headers }; } }
  const code = ts.transpileModule(fs.readFileSync(path.join(root,'app/api/passenger/track/route.ts'),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, URL, Date, Number, String,
    process: { env: { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' } },
    require(name) {
      if(name === 'next/server') return { NextResponse };
      if(name === '@supabase/supabase-js') return { createClient: (_,key) => key === 'service' ? db : {
        auth: { async getUser(token) { if(options.authThrows) throw new Error('offline'); return { data: { user: token === 'valid' ? { id: options.user || 'owner' } : null }, error: null }; } }
      }};
      if(name === '@/lib/shortTripAutomaticFare') return { SHORT_TRIP_AUTOMATIC_FARE_VERSION: 'short_trip_automatic_v1', SHORT_TRIP_AUTOMATIC_PASSENGER_BODY: 'Fixture notice', SHORT_TRIP_AUTOMATIC_PASSENGER_HEADING: 'Fixture heading' };
      throw new Error(name);
    }
  });
  return { calls, async get(token = 'valid') { return module.exports.GET({ url: 'https://fixture.invalid/api/passenger/track?booking_code=JR-FIXTURE', headers: new Headers(token === null ? {} : { authorization: 'Bearer '+token }) }); } };
}
async function test(name, fn) { await fn(); passed++; console.log('PASS '+name); }
(async () => {
  await test('owner sees driver details and actual GPS age with unchanged automatic fare',async()=>{
    const r=await harness().get(); assert.equal(r.status,200); const b=r.body;
    assert.equal(b.driver_plate_number,'TEST-123'); assert.equal(b.driver_vehicle_type,'tricycle');
    assert(b.driver_location_age_seconds>=30 && b.driver_location_age_seconds<=32);
    assert.equal(b.pickup_distance_fee,60); assert.equal(b.verified_fare,40); assert.equal(b.total_fare,115); assert.equal(b.short_trip_automatic_fare,true);
    assert.equal(b.driver_photo_url,'https://fixture.invalid/photo.jpg'); assert.equal(b.driver_phone,'+639001234567');
    assert(r.headers['Cache-Control'].includes('no-store'));
  });
  for (const [name,options,token] of [['anonymous',{},null],['invalid',{},'invalid'],['non-owner',{user:'other'},'valid'],['auth unavailable',{authThrows:true},'valid'],['legacy owner absent',{booking:{created_by_user_id:null}},'valid']]) {
    await test(name+' receives no new private enrichment and legacy tracking still works',async()=>{
      const r=await harness(options).get(token); assert.equal(r.status,200);
      for(const key of ['driver_vehicle_type','driver_plate_number','driver_location_age_seconds']) assert.equal(r.body[key],null);
      assert.equal(r.body.status,'ready'); assert.equal(r.body.total_fare,115);
    });
  }
  for(const status of ['searching','assigned','cancelled']) await test(status+' does not reveal new driver details',async()=>{
    const r=await harness({booking:{status}}).get(); assert.equal(r.body.driver_plate_number,null); assert.equal(r.body.driver_location_age_seconds,null);
  });
  await test('completed retains vehicle identity but stops new live location enrichment',async()=>{
    const r=await harness({booking:{status:'completed'}}).get(); assert.equal(r.body.driver_plate_number,'TEST-123'); assert.equal(r.body.driver_location_age_seconds,null);
  });
  for(const updatedAt of [null,'invalid',new Date(Date.now()+60000).toISOString()]) await test('missing/invalid/future GPS time is not fabricated as fresh',async()=>{
    const r=await harness({updatedAt}).get(); assert.equal(r.body.driver_location_age_seconds,null);
  });
  await test('stale GPS retains its real age',async()=>{ const r=await harness({updatedAt:new Date(Date.now()-600000).toISOString()}).get(); assert(r.body.driver_location_age_seconds>=600); });
  await test('location failure preserves fare and photo',async()=>{const r=await harness({failTable:'driver_locations_latest'}).get(); assert.equal(r.body.driver_lat,null); assert.equal(r.body.driver_location_age_seconds,null); assert.equal(r.body.total_fare,115); assert(r.body.driver_photo_url);});
  await test('legacy proposed fare and promo remain unchanged',async()=>{
    const r=await harness({booking:{status:'fare_proposed',verified_fare:null,proposed_fare:100,pickup_distance_fee:0,trip_distance_km:5,ride_fare_mode:null,promo_applied_amount:20}}).get();
    assert.equal(r.body.total_fare,95); assert.equal(r.body.short_trip_automatic_fare,false); assert.equal(r.body.status,'fare_proposed');
  });
  console.log('Passed '+passed+' passenger driver visibility route checks.');
})().catch(error=>{console.error(error);process.exitCode=1;});
