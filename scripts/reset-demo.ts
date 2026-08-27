import { resolve } from "node:path";
import { JsonStore } from "../src/server/store.js";

const store = new JsonStore(
  resolve(process.cwd(), process.env.DATA_FILE ?? ".data/openagentlab.json"),
);
await store.reset();
process.stdout.write("Demo data reset.\n");
