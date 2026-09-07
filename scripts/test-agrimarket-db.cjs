// Disposable PostgreSQL only. Never point this runner at a shared database.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const psql = process.env.PSQL_BIN || 'C:/Program Files/PostgreSQL/16/bin/psql.exe';
const bootstrap = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema extensions; create extension pgcrypto schema extensions;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table public.vendor_accounts(id uuid primary key);
create table public.passenger_addresses(id uuid primary key,created_by_user_id uuid,is_active boolean default true,lat double precision,lng double precision,address_text text,label text);
create table public.drivers(id uuid primary key,wallet_balance numeric default 1000,min_wallet_required numeric default 200,wallet_locked boolean default false,roster_status text default 'active',updated_at timestamptz);
create table public.driver_profiles(driver_id uuid primary key references public.drivers(id));
create table public.driver_locations(driver_id uuid,status text,updated_at timestamptz,lat double precision,lng double precision,vehicle_type text);
create table public.bookings(id uuid primary key,driver_id uuid,assigned_driver_id uuid,status text);
create table public.driver_wallet_transactions(id uuid primary key default gen_random_uuid(),driver_id uuid,amount numeric,reason text,created_at timestamptz default now(),balance_after numeric,metadata jsonb,booking_id uuid,wallet_settlement_id uuid);
create table public.driver_notifications(driver_id uuid,type text,message text);
`;
const files=fs.readdirSync('supabase/migrations').filter(x=>x.includes('_agrimarket_') && x.endsWith('.sql')).sort();
const migrationSQL=files.map(file=>`\n-- ${file}\n`+fs.readFileSync(path.join('supabase/migrations',file),'utf8')).join('\n');
const checks=['scripts/agrimarket-db-checks.sql','scripts/agrimarket-registration-db-checks.sql','scripts/agrimarket-device-db-checks.sql','scripts/agrimarket-butchering-db-checks.sql'].map(file=>fs.readFileSync(file,'utf8')).join('\n');
// Everything, including roles and fixtures, is rolled back. Loopback and fixed port
// deliberately prevent accidentally targeting production through a connection URL.
const r=spawnSync(psql,['-X','-qAt','-h','127.0.0.1','-p','55439','-U','agrimarket_test','-d','postgres','-v','ON_ERROR_STOP=1'],{input:'BEGIN;\n'+bootstrap+'\n'+migrationSQL+'\n'+checks+'\nROLLBACK;',encoding:'utf8',maxBuffer:4*1024*1024});
const errors=(r.stderr||'').split(/\r?\n/).filter(x=>!x.startsWith('NOTICE:') || x.includes('PASS:')).join('\n');
if(errors.trim()) console.log(errors);
if(r.stdout.trim()) console.log(r.stdout.trim());
if(r.error) console.error(r.error.message);
if(r.status===0) console.log(`PASS: ${files.length} AgriMarket migrations replayed and DB assertions completed in a rolled-back local transaction.`);
process.exit(r.status??1);
