// app/auth.ts  (shim everyone imports)
export { auth, signIn, signOut, handlers } from "./auth-impl";
export const { GET, POST } =
  typeof handlers !== "undefined" ? handlers : ({} as any);
export default auth;
