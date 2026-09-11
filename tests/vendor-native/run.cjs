const { buildSync } = require('esbuild');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = 'tests/vendor-native';
buildSync({ entryPoints: [root + '/dispatch.test.ts'], outfile: root + '/dispatch-test.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
execFileSync(process.execPath, [root + '/dispatch-test.mjs'], { stdio: 'inherit' });
buildSync({ entryPoints: [root + '/route.test.ts'], outfile: root + '/route-test.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['next/server'], alias: { '@/lib/supabaseAdmin': path.resolve(root + '/admin-mock.ts') }, logLevel: 'silent' });
execFileSync(process.execPath, [root + '/route-test.cjs'], { stdio: 'inherit' });
execFileSync(process.execPath, [root + '/sound.test.cjs'], { stdio: 'inherit' });
