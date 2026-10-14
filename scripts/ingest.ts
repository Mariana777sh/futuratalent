import fs from "node:fs";
import path from "node:path";
import { ingestDocument } from "../src/lib/ingest";

const dir = process.argv[2] || "./data/transcripts";
const files = fs.readdirSync(dir).filter((f) => /\.(txt|md)$/i.test(f));
(async () => {
  for (const f of files) {
    try {
      const r = await ingestDocument(f, fs.readFileSync(path.join(dir, f), "utf8"));
      console.log(f, r);
    } catch (e) {
      console.error(f, "FAILED", e);
    }
  }
})();
