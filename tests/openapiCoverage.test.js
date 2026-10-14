const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.STAFF_LINK_KEY = process.env.STAFF_LINK_KEY || "c".repeat(64);
const { ROUTES } = require("../docs/openapiSpec");

// Every route mounted in app.js, read from the routers themselves.
const mountedRoutes = () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const files = Object.fromEntries(
    [...appSource.matchAll(/const (\w+) = require\("\.\/routes\/(\w+)"\)/g)].map(
      (m) => [m[1], m[2]],
    ),
  );
  const out = [];
  for (const [, mount, name] of appSource.matchAll(/app\.use\("([^"]+)",\s*(\w+)\)/g)) {
    if (!files[name]) continue;
    const router = require(`../routes/${files[name]}`);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        const full = `${mount}${layer.route.path}`
          .replace(/\/$/, "")
          .replace(/:(\w+)/g, "{$1}");
        out.push(`${method} ${full}`);
      }
    }
  }
  return out;
};

test("every API route is documented, and every documented route exists", () => {
  const mounted = new Set(mountedRoutes());
  const documented = new Set(ROUTES.map(([m, p]) => `${m} /api/v1${p}`));
  const undocumented = [...mounted].filter((r) => !documented.has(r));
  const missing = [...documented].filter((r) => !mounted.has(r));
  assert.deepEqual(undocumented, [], "routes missing from docs/openapiSpec.js");
  assert.deepEqual(missing, [], "documented routes that don't exist");
});
