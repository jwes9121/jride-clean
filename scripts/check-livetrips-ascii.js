const fs = require("fs");
const path = require("path");

const root = process.cwd();
const targetDir = path.join(root, "app", "admin", "livetrips");

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(filePath));
    } else if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      results.push(filePath);
    }
  });
  return results;
}

function hasNonAscii(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] >= 128) return true;
  }
  return false;
}

if (!fs.existsSync(targetDir)) {
  console.error("[FAIL] LiveTrips folder not found:", targetDir);
  process.exit(2);
}

const files = getFiles(targetDir);
const badFiles = [];

files.forEach((file) => {
  const buffer = fs.readFileSync(file);
  if (hasNonAscii(buffer)) {
    badFiles.push(file);
  }
});

if (badFiles.length > 0) {
  console.error("[FAIL] Non-ASCII bytes detected in LiveTrips source:");
  badFiles.forEach((f) => console.error(" -", f));
  process.exit(1);
}

console.log("[OK] LiveTrips encoding guard passed (ASCII-only).");
process.exit(0);
