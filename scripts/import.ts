import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type ExportRow = {
  Id: number;
  Login: string;
  Cookie: string;
  NextFreeGemsAt: string;
  AuthBlocked: boolean | number;
};

const MIN_UTC = "1970-01-01T00:00:00.000Z";

function sqlEscape(value: string): string {
  return value.replaceAll("'", "''");
}

function toIsoOrMin(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return MIN_UTC;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid NextFreeGemsAt in export row");
  return d.toISOString();
}

function main(): void {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Usage: npm run import -- <export.json>");
    process.exit(1);
  }

  const filePath = resolve(fileArg);
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as ExportRow[] | { rows?: ExportRow[] };
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!rows?.length) {
    console.error("No rows found in export file.");
    process.exit(1);
  }

  const statements: string[] = ["BEGIN TRANSACTION;"];
  let skipped = 0;

  for (const row of rows) {
    if (typeof row.Id !== "number" || !row.Login?.trim()) {
      skipped += 1;
      continue;
    }
    const next = toIsoOrMin(row.NextFreeGemsAt);
    const auth = row.AuthBlocked ? 1 : 0;
    statements.push(
      `INSERT INTO UnlucidFreeGemsLogins (Id, Login, Cookie, NextFreeGemsAt, AuthBlocked) VALUES (${row.Id}, '${sqlEscape(row.Login.trim())}', '${sqlEscape(row.Cookie ?? "")}', '${sqlEscape(next)}', ${auth}) ON CONFLICT(Id) DO UPDATE SET Login=excluded.Login, Cookie=excluded.Cookie, NextFreeGemsAt=excluded.NextFreeGemsAt, AuthBlocked=excluded.AuthBlocked;`,
    );
  }
  statements.push("COMMIT;");

  if (statements.length <= 2) {
    console.error("No valid rows to import.");
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), "unlucid-import-"));
  const sqlPath = join(dir, "import.sql");
  writeFileSync(sqlPath, statements.join("\n"), "utf8");

  execFileSync("npx", ["wrangler", "d1", "execute", "unlucid-gems", "--remote", "--file", sqlPath], {
    stdio: "inherit",
  });

  const upserted = statements.length - 2;
  console.log(`Import finished: ${upserted} row(s) upserted, ${skipped} skipped. Cookie values were never logged.`);
}

main();