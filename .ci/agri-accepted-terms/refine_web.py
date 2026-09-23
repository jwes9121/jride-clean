from pathlib import Path
import hashlib

def change(source, old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new)

p = Path('app/agrimarket/page.tsx')
s = p.read_text()
assert hashlib.sha256(p.read_bytes()).hexdigest() == '914975842d91c718ef05f0c28ba395a893f0aee831c418944f01ee85a5713252'
s = change(s, 'import { cartConflict, cargoGroupLabel } from "@/lib/agrimarket/cartCompatibility";', 'import { cartConflict, cargoGroupLabel } from "@/lib/agrimarket/cartCompatibility";\nimport { lineCents, moneyFromCents } from "@/lib/agrimarket/checkoutMoney";')
s = change(s, 'const amount = Number(value || 0);', 'const amount = Number(value ?? 0);')
s = change(s, 'return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;', 'return Number.isFinite(amount) ? `PHP ${amount.toFixed(2)}` : "Amount unavailable";')
s = change(s, 'function formatDate(value: unknown): string {', '''function cartLineAmount(line: CartLine): number {
  try { return moneyFromCents(lineCents(line.product.unit_price, line.quantity)); }
  catch { return Number.NaN; }
}
function cartProductsAmount(lines: CartLine[]): number {
  try { return moneyFromCents(lines.reduce((sum, line) => sum + lineCents(line.product.unit_price, line.quantity), BigInt(0))); }
  catch { return Number.NaN; }
}

function formatDate(value: unknown): string {''')
s = change(s, '() => cart.reduce((sum, line) => sum + line.product.unit_price * line.quantity, 0)', '() => cartProductsAmount(cart)')
s = change(s, 'money(line.product.unit_price * line.quantity)', 'money(cartLineAmount(line))')
a = s.index('  async function placeOrder()'); b = s.index('\n  if (loading', a)
block = change(s[a:b], '    if (cartError) { setCartMessage(cartError); return; }\n', '')
s = s[:a] + block + s[b:]
s = change(s, '<span>Initial approved amount</span>', '<span>Current quoted total</span>')
s = change(s, '                <button onClick={placeOrder}', '                <p className="mt-3 text-xs text-slate-600">Price quote valid until {formatDate(quote.checkout_quote?.expires_at)} (Philippine time). This does not change the preparation schedule or the farmer confirmation window.</p>\n                <button onClick={placeOrder}')
assert hashlib.sha256(s.encode()).hexdigest() == 'e04c924bf7b57e67edb41f2e6a021c8434b9803ba05ae3af1f6197a2d6f0aa72'
p.write_text(s)
p = Path('tests/agrimarket-accepted-terms/run.cjs')
s = p.read_text()
assert hashlib.sha256(p.read_bytes()).hexdigest() == '2135d53f01ad11e411fa301dfa6a3ea973bf3e97a584c2359b8974b6fa921420'
anchor = ' console.log(`PASS: ${count} accepted-terms test groups. Mocked I/O, no real orders.`);'
addition = ''' await test('web cart display uses exact per-line decimal totals and names its quote expiry',()=>{
  const source=fs.readFileSync(path.join(root,'app/agrimarket/page.tsx'),'utf8');
  const start=source.indexOf('function cartLineAmount('),end=source.indexOf('function formatDate(',start);
  const module={exports:{}};const code=ts.transpileModule(source.slice(start,end)+'\\nmodule.exports={cartLineAmount,cartProductsAmount}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,...money});
  const rows=[{product:{unit_price:55},quantity:.555},{product:{unit_price:65},quantity:.555}];
  assert.equal(module.exports.cartLineAmount(rows[0]),30.53);assert.equal(module.exports.cartLineAmount(rows[1]),36.08);assert.equal(module.exports.cartProductsAmount(rows),66.61);
  assert(Number.isNaN(module.exports.cartProductsAmount([{product:{unit_price:1},quantity:.0001}])));
  assert(source.includes('Current quoted total'));assert(source.includes('Price quote valid until'));
  assert(!source.slice(source.indexOf('  async function placeOrder()'),source.indexOf('  if (loading')).includes('if (cartError)'));
 });
'''
s = change(s, anchor, addition + anchor)
assert hashlib.sha256(s.encode()).hexdigest() == '17d3951742518b7bdbf81dc35aff36b08ca1c588b130843ef700afe9b79cdd56'
p.write_text(s)
print('PASS: exact web cart money and quote-expiry changes; only two guarded files modified')
