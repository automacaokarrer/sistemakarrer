import { readFile, writeFile } from "node:fs/promises";

const keys = [
  "BOOTSTRAP_ADMIN_TOKEN",
  "ZAPI_INSTANCE_ID",
  "ZAPI_INSTANCE_TOKEN",
  "ZAPI_CLIENT_TOKEN",
  "ZAPI_WEBHOOK_TOKEN",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
];

const empty = process.argv.includes("--empty");
const source = empty ? "" : await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
const values = new Map(
  source
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const output = [
  "# Gerado automaticamente de .env; não versionar.",
  "ENVIRONMENT=development",
  ...keys.map((key) => `${key}=${empty ? "" : values.get(key) ?? ""}`),
  "",
].join("\n");

await writeFile(new URL("../.dev.vars", import.meta.url), output, "utf8");
