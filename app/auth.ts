$authShim = @'
export * from "./auth-impl";
export { default } from "./auth-impl";
'@
[System.IO.File]::WriteAllText("$root\app\auth.ts", $authShim, $utf8)
