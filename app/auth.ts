// app/auth.ts
export { auth, signIn, signOut, handlers } from "./auth-impl";
export const { GET, POST } =
  typeof handlers !== "undefined" ? handlers : ({} as any);
export default auth;
