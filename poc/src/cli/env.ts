// טוען .env אם קיים (Node 22+), בלי תלות חיצונית.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
