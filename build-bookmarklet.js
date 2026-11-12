// Rebuilds the "Send to SAADI Hub" bookmark link in class-capacity.html from justgo-sync-bookmarklet.js.
// Run: node build-bookmarklet.js
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/justgo-sync-bookmarklet.js", "utf8")
  .split("\n").filter(l => !/^\s*\/\//.test(l)).map(l => l.trim()).filter(Boolean).join("");
new Function(src); // throws if the code doesn't parse
const href = "javascript:" + encodeURIComponent(src);
const file = __dirname + "/class-capacity.html";
const html = fs.readFileSync(file, "utf8");
const re = /(<a id="jgBookmarklet" class="bm" href=")[^"]*(")/;
if (!re.test(html)) throw new Error("Bookmark link not found in class-capacity.html");
fs.writeFileSync(file, html.replace(re, (_, a, b) => a + href + b));
console.log("Bookmark link updated (" + href.length + " characters).");
