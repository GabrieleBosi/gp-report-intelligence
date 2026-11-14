// npm run corpus:generate - regenerates corpus/docs and corpus/labels in place.
import path from "node:path";
import { generateCorpus } from "./generator/index.ts";

const root = path.resolve(import.meta.dirname, "..");
const written = await generateCorpus(root);
console.log(`wrote ${written.length} files:\n  ${written.join("\n  ")}`);
