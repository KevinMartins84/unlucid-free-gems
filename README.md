# Unlucid free gems

Standalone admin site and scheduler for automated [Unlucid.ai](https://unlucid.ai) free gem claims. Replaces the FelicityWebApp components (`UnlucidFreeGemsService`, timer, admin page).

## Hosting

- **Primary:** Cloudflare Worker (`wrangler deploy`) serves the admin UI, JSON API, D1 storage, claim log, and a `*/5 * * * *` cron.
- **Mirror UI:** GitHub Pages publishes `public/` with **relative** asset paths (`./styles.css`, `./app.js`). On Pages, open **Sign in**, set the Worker URL + admin token; the Worker enables CORS for `https://kevinmartins84.github.io`.

### Repository secrets (Deploy → Cloudflare job)

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Workers + D1 deploy (required for deploy job) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account (required for deploy job) |
| `UNLUCID_ADMIN_TOKEN` | Bearer token for `/api/*` (stored as Worker secret `ADMIN_TOKEN`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for failure alerts |
| `TELEGRAM_CHAT_ID` | Telegram chat id for failure alerts |

### Repository variable (optional)

| Variable | Purpose |
|----------|---------|
| `D1_DATABASE_ID` | Existing D1 database UUID. If unset, deploy creates or finds `unlucid-gems` and patches `wrangler.toml` for that run only. |

The Deploy workflow:

1. Runs tests
2. Resolves/creates the D1 database and applies `schema.sql`
3. Deploys the Worker + static assets
4. Sets Worker secrets (`ADMIN_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) when present
5. Writes the live `*.workers.dev` URL to the GitHub Actions job summary

Deploy failures are **not** ignored (`continue-on-error` removed).

## Development

```bash
npm install
npm run db:migrate:local
npm test
npm run dev
```

Create `.dev.vars`:

```env
ADMIN_TOKEN=dev-local-token
```

Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

## API

All routes except `GET /api/health` require `Authorization: Bearer <ADMIN_TOKEN>`.

| Route | Description |
|-------|-------------|
| `GET /api/health` | Service + last cron run time/result (public) |
| `GET /api/rows` | Login rows |
| `POST /api/rows` | Add row |
| `PUT/DELETE /api/rows/:id` | Update / delete |
| `POST /api/rows/:id/claim` | Manual **Claim now** (ignores `AuthBlocked`; success clears it) |
| `GET /api/log` | Recent claim attempts (no cookies) |

## Migrating from Felicity

1. Export Felicity `UnlucidFreeGemsLogins` as JSON (`Id`, `Login`, `Cookie`, `NextFreeGemsAt`, `AuthBlocked`).
2. Ensure `wrangler.toml` points at your remote D1 database (or rely on CI to create it).
3. Run:

```bash
npm run import -- /path/to/export.json
```

The import logs counts only — never cookie values. Do not commit exports.

## Claim behaviour

Matches Felicity: SvelteKit `POST /gems?/claim`, sync from `/gems/__data.json` (`remainingMs`), fallback `now + 1 day`, `409` → sync, `401/403` → auth blocked + Telegram alert with paused note, cron every 5 minutes for due, non-blocked rows.

## Live URLs (after deploy)

- Worker: `https://unlucid-free-gems.<subdomain>.workers.dev` (see Actions summary)
- GitHub Pages: `https://kevinmartins84.github.io/unlucid-free-gems/`