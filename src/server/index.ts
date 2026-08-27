import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildApp } from "./app.js";
import { JsonStore } from "./store.js";

const dataFile = resolve(
  process.cwd(),
  process.env.DATA_FILE ?? ".data/openagentlab.json",
);
const app = buildApp(new JsonStore(dataFile));

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await app.listen({
      port: Number(process.env.PORT ?? 3000),
      host: process.env.HOST ?? "127.0.0.1",
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

export { app };
