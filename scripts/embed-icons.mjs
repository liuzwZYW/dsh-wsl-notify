// Inline assets/*.png|ico into lib/icons.js (no runtime dependency on disk).
import { readFileSync, writeFileSync } from "node:fs";

const files = {
  done: "assets/done.png",
  question: "assets/question.png",
  approval: "assets/approval.png",
  shortcut: "assets/dsh.ico",
};

let out = [
  "// Generated from assets/ by scripts/embed-icons.mjs — do not edit by hand.",
  "// Image data is inlined so the plugin never depends on a WSL-visible path.",
  "",
  "export const TOAST_ICONS = {",
];
for (const [key, path] of Object.entries(files)) {
  out.push(`  ${key}: "${readFileSync(path).toString("base64")}",`);
}
out.push("};", "");
out.push("/** File name inside %LOCALAPPDATA%\\\\DSH\\\\notify\\\\icons for each notification kind. */");
out.push("export const ICON_FILE_BY_KIND = {");
out.push('  done: "done.png",');
out.push('  question: "question.png",');
out.push('  approval: "approval.png",');
out.push("};", "");
writeFileSync("lib/icons.js", out.join("\n"));
console.log("lib/icons.js written");
