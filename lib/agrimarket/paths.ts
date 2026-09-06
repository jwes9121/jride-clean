export function isAgrimarketFarmerPath(path: string): boolean {
  return ["/agrimarket/producer", "/agrimarket/farmer", "/agrimarket/join"].some(
    prefix => path === prefix || path.startsWith(prefix + "/")
  );
}
