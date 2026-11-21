export type LoginRow = {
  id: number;
  login: string;
  cookie: string;
  nextFreeGemsAt: string;
  authBlocked: boolean;
};

export type LoginRowInput = {
  login: string;
  cookie: string;
  nextFreeGemsAt: string;
};

export type ClaimLogRow = {
  id: number;
  createdAt: string;
  login: string;
  outcome: string;
  httpStatus: number | null;
  message: string | null;
  nextFreeGemsAt: string | null;
};

export type ImportRow = {
  Id: number;
  Login: string;
  Cookie: string;
  NextFreeGemsAt: string;
  AuthBlocked: boolean | number;
};

const MIN_UTC = "1970-01-01T00:00:00.000Z";

type LoginRowDb = Omit<LoginRow, "authBlocked"> & { authBlocked: number };

function mapLoginRow(r: LoginRowDb): LoginRow {
  return { ...r, authBlocked: Boolean(r.authBlocked) };
}

export async function listAll(db: D1Database): Promise<LoginRow[]> {
  const { results } = await db
    .prepare(
      `SELECT Id as id, Login as login, Cookie as cookie, NextFreeGemsAt as nextFreeGemsAt, AuthBlocked as authBlocked
       FROM UnlucidFreeGemsLogins
       ORDER BY Id`,
    )
    .all<LoginRowDb>();
  return (results ?? []).map(mapLoginRow);
}

export async function listDue(db: D1Database, utcNowIso: string): Promise<LoginRow[]> {
  const { results } = await db
    .prepare(
      `SELECT Id as id, Login as login, Cookie as cookie, NextFreeGemsAt as nextFreeGemsAt, AuthBlocked as authBlocked
       FROM UnlucidFreeGemsLogins
       WHERE NextFreeGemsAt <= ?1
         AND AuthBlocked = 0
         AND length(trim(Cookie)) > 0
       ORDER BY Id`,
    )
    .bind(utcNowIso)
    .all<LoginRowDb>();
  return (results ?? []).map(mapLoginRow);
}

export async function getById(db: D1Database, id: number): Promise<LoginRow | null> {
  const row = await db
    .prepare(
      `SELECT Id as id, Login as login, Cookie as cookie, NextFreeGemsAt as nextFreeGemsAt, AuthBlocked as authBlocked
       FROM UnlucidFreeGemsLogins WHERE Id = ?1`,
    )
    .bind(id)
    .first<LoginRowDb>();
  if (!row) return null;
  return mapLoginRow(row);
}

export async function insertRow(db: D1Database, input: LoginRowInput): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO UnlucidFreeGemsLogins (Login, Cookie, NextFreeGemsAt, AuthBlocked)
       VALUES (?1, ?2, ?3, 0)`,
    )
    .bind(input.login, input.cookie, input.nextFreeGemsAt || MIN_UTC)
    .run();
  return Number(result.meta.last_row_id ?? 0);
}

export async function updateRow(db: D1Database, id: number, input: LoginRowInput): Promise<void> {
  await db
    .prepare(
      `UPDATE UnlucidFreeGemsLogins
       SET Login = ?2, Cookie = ?3, NextFreeGemsAt = ?4
       WHERE Id = ?1`,
    )
    .bind(id, input.login, input.cookie, input.nextFreeGemsAt || MIN_UTC)
    .run();
}

export async function deleteRow(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM UnlucidFreeGemsLogins WHERE Id = ?1`).bind(id).run();
}

export async function setAuthBlocked(db: D1Database, id: number, authBlocked: boolean): Promise<void> {
  await db
    .prepare(`UPDATE UnlucidFreeGemsLogins SET AuthBlocked = ?2 WHERE Id = ?1`)
    .bind(id, authBlocked ? 1 : 0)
    .run();
}

export async function updateNextFree(db: D1Database, id: number, nextFreeGemsAtUtc: string): Promise<void> {
  await db
    .prepare(`UPDATE UnlucidFreeGemsLogins SET NextFreeGemsAt = ?2, AuthBlocked = 0 WHERE Id = ?1`)
    .bind(id, nextFreeGemsAtUtc)
    .run();
}

export async function insertClaimLog(
  db: D1Database,
  entry: {
    login: string;
    outcome: string;
    httpStatus: number | null;
    message: string | null;
    nextFreeGemsAt: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ClaimLog (CreatedAt, Login, Outcome, HttpStatus, Message, NextFreeGemsAt)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      new Date().toISOString(),
      entry.login,
      entry.outcome,
      entry.httpStatus,
      entry.message,
      entry.nextFreeGemsAt,
    )
    .run();
}

export async function listClaimLogs(db: D1Database, limit = 100): Promise<ClaimLogRow[]> {
  const { results } = await db
    .prepare(
      `SELECT Id as id, CreatedAt as createdAt, Login as login, Outcome as outcome,
              HttpStatus as httpStatus, Message as message, NextFreeGemsAt as nextFreeGemsAt
       FROM ClaimLog
       ORDER BY Id DESC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<ClaimLogRow & { httpStatus: number | null }>();
  return (results ?? []).map((r) => ({
    ...r,
    httpStatus: r.httpStatus ?? null,
  }));
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT Value as value FROM WorkerMeta WHERE Key = ?1`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO WorkerMeta (Key, Value) VALUES (?1, ?2)
       ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value`,
    )
    .bind(key, value)
    .run();
}

export async function upsertImportRow(db: D1Database, row: ImportRow): Promise<"inserted" | "updated"> {
  const existing = await db.prepare(`SELECT Id FROM UnlucidFreeGemsLogins WHERE Id = ?1`).bind(row.Id).first();
  const nextFree = row.NextFreeGemsAt?.trim() || MIN_UTC;
  const authBlocked = row.AuthBlocked ? 1 : 0;
  if (existing) {
    await db
      .prepare(
        `UPDATE UnlucidFreeGemsLogins
         SET Login = ?2, Cookie = ?3, NextFreeGemsAt = ?4, AuthBlocked = ?5
         WHERE Id = ?1`,
      )
      .bind(row.Id, row.Login, row.Cookie, nextFree, authBlocked)
      .run();
    return "updated";
  }
  await db
    .prepare(
      `INSERT INTO UnlucidFreeGemsLogins (Id, Login, Cookie, NextFreeGemsAt, AuthBlocked)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(row.Id, row.Login, row.Cookie, nextFree, authBlocked)
    .run();
  return "inserted";
}