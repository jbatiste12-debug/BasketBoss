import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [path.join(root, "client/auth-sdk.mjs")],
  outfile: path.join(root, "bb-auth-sdk.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["safari16"],
  minify: true,
  legalComments: "eof",
});
