'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = p => fs.readFileSync(p, 'utf8');
let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log('PASS ' + name);
}

const api = read('app/api/jfleet/owner/addons/confirm-payment/route.ts');
const page = read('app/jfleet/owner/page.tsx');
const form = read('components/jfleet/OwnerAddonPaymentForm.tsx');
const contract = read('lib/jfleet/ownerAddonPayment.ts');
const store = read('lib/jfleet/ownerAddonPaymentStore.ts');
const migration = read('supabase/migrations/20260925194537_jfleet_addon_payment_binding_v1.sql');

check('API does not generate a replacement random idempotency key',
  !api.includes('randomUUID') && api.includes('addonPaymentRequest'));
check('API supports receipt lookup before retry', api.includes('export async function GET'));
check('API calls hardened v2 add-on payment RPC', api.includes('jfleet_owner_confirm_addon_payment_v2'));
check('API reconciles an existing add-on-bound receipt', api.includes('reconciled'));
check('API scopes add-on through owner partner booking', api.includes('.eq("partner_id", auth.partner.id)'));
check('API verifies exact requested amount', api.includes('JFLEET_ADDON_PAYMENT_AMOUNT_CHANGED'));

check('owner page uses retry-safe add-on component', page.includes('OwnerAddonPaymentForm'));
check('legacy confirmAddonPayment function removed', !page.includes('async function confirmAddonPayment'));
check('legacy addon payment draft state removed', !page.includes('addonPaymentDrafts'));
check('paid add-on can recover receipt', page.includes('item.status === "accepted" || item.status === "paid"'));

check('form persists before network send', form.indexOf('prepareAddonPaymentSlot') < form.indexOf('fetch('));
check('form exposes retry action', form.includes('Retry saved add-on payment'));
check('form exposes receipt check action', form.includes('Check add-on payment'));
check('form warns against cross-device re-entry', form.includes('Do not re-enter this'));
check('form keeps fixed add-on amount', form.includes('amount={') === false && form.includes('Amount:'));
check('form checks server on recovery', form.includes('method: "GET"'));

check('scope includes addon identity', contract.includes('addon_id: string'));
check('request requires stable payment key', contract.includes('PAYMENT_KEY.test'));
check('receipt requires confirmed status', contract.includes('v.status !== "confirmed"'));

check('store key includes exact addon scope', store.includes('addonPaymentScopeKey'));
check('store uses strict IndexedDB transaction', store.includes('durability: "strict"'));
check('store creates key before HTTP layer uses request', store.includes('idempotency_key: "JFAP-"'));
check('store adopts authoritative cross-device receipt', store.includes('authoritative addon-bound receipt wins'));

check('migration binds payment row to addon foreign key', migration.includes('addon_id uuid references public.jfleet_addons'));
check('migration enforces one payment row per addon', migration.includes('unique index jfleet_payments_addon_unique_idx'));
check('migration enforces addon payment kind binding', migration.includes('jfleet_payments_addon_kind_binding_chk'));
check('migration preserves v1 compatibility through v2', migration.includes('return public.jfleet_owner_confirm_addon_payment_v2'));
check('v2 rejects a second different key for paid addon', migration.includes('JFLEET_ADDON_PAYMENT_ALREADY_RECORDED'));

for (const [name, source] of [['api',api],['page',page],['form',form],['contract',contract],['store',store],['migration',migration]]) {
  check(name + ' is ASCII', !/[^\x00-\x7F]/.test(source));
}

console.log('JFleet add-on payment retry checks: ' + passed + ' passed.');
