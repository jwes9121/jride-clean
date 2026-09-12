# Shared Test Driver device regression checks

Runs the original device schema, the shared-account migration and the actual
request resolver against an isolated PostgreSQL instance using PGlite.
No production credentials, drivers or orders are used.

Install the test engine outside the repository, then run with the existing
application dependencies installed:

```sh
npm install --prefix /tmp/jride-device-test --no-audit --no-fund --save-exact @electric-sql/pglite@0.3.14
NODE_PATH=/tmp/jride-device-test/node_modules node tests/agrimarket-devices/run.cjs
```

The checks cover multiple approved test phones, regular-driver replacement,
the unique index, repeated approvals, request expiry, revocation, administrator
permissions, token/device/driver binding, table grants and RLS.
