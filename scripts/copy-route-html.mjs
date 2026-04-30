import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const routes = ["login.html", "chat.html", "dm.html", "news.html", "profile.html"];

await mkdir(dist, { recursive: true });
await Promise.all(routes.map((route) => copyFile(join(dist, "index.html"), join(dist, route))));
