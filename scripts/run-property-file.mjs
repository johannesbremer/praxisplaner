import path from "node:path";
import { pathToFileURL } from "node:url";

const targetFile = process.argv[2];

if (!targetFile) {
  console.error("Missing property file path.");
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), targetFile);
const importedModule = await import(pathToFileURL(absolutePath).href);
const runProperty = importedModule.runProperty;

if (typeof runProperty !== "function") {
  console.error(`Property file does not export runProperty: ${targetFile}`);
  process.exit(1);
}

await runProperty();
