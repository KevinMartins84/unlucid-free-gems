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

const MIN_UTC = "1970-01-01T00:00:00.000Z";

export async function listAll(db: D1Database): Promise<LoginRow[]> {
  const { results } = await db
    .prepare(
      `SELECT Id as id, Login as login, Cookie as cookie, NextFreeGemsAt as nextFreeGemsAt, AuthBlocked as authBlocked
       FROM UnlucidFreeGemsLogins
       ORDER BY Id`,
    )
    .all<LoginRow & { authBlocked: number }>();
  return (results ?? []).map((r) => ({ ...r, authBlocked: Boolean(r.authBlocked) }));
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
    .all<LoginRow & { authBlocked: number }>();
  return (results ?? []).map((r) => ({ ...r, authBlocked: Boolean(r.authBlocked) }));
}

export async function getById(db: D1Database, id: number): Promise<LoginRow | null> {
  const row = await db
    .prepare(
      `SELECT Id as id, Login as login, Cookie as cookie, NextFreeGemsAt as nextFreeGemsAt, AuthBlocked as authBlocked
       FROM UnlucidFreeGemsLogins WHERE Id = ?1`,
    )
    .bind(id)
    .first<LoginRow & { authBlocked: number }>();
  if (!row) return null;
  return { ...row, authBlocked: Boolean(row.authBlocked) };
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
  await db.prepare(`UPDATE UnlucidFreeGemsLogins SET AuthBlocked = ?2 WHERE Id = ?1`).bind(id, authBlocked ? 1 : 0).run();
}

export async function updateNextFree(db: D1Database, id: number, nextFreeGemsAtUtc: string): Promise<void> {
  await db
    .prepare(`UPDATE UnlucidFreeGemsLogins SET NextFreeGemsAt = ?2, AuthBlocked = 0 WHERE Id = ?1`)
    .bind(id, nextFreeGemsAtUtc)
    .run();
}