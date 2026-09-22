/* Resolve os specifiers "@minecraft/*" pros stubs locais da simulacao. */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const MAP = {
  "@minecraft/server": join(here, "stubs", "server.mjs"),
  "@minecraft/server-ui": join(here, "stubs", "server-ui.mjs"),
};

export async function resolve(specifier, context, nextResolve) {
  const target = MAP[specifier];
  if (target) {
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // os scripts do BP (main.js, shinji.js) usam ESM com extensao .js e sem
  // package.json "type": "module"
  if (/\/BP\/scripts\/[^/]+\.js$/.test(url)) {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
