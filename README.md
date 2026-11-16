# Unlucid free gems

Standalone admin site and scheduler for automated [Unlucid.ai](https://unlucid.ai) free gem claims. Extracted from FelicityWebApp.

## Hosting

- **Primary:** Cloudflare Worker (`wrangler deploy`) serves the admin UI (static assets) and JSON API, with D1 storage and a `*/5 * * * *` cron.
- **Fallback UI:** GitHub Pages deploys `public/` on every push to `main` (configure the worker URL + admin token in the Connection panel).

### Repository secrets (Cloudflare deploy job)

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Workers + D1 deploy |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account |
| `UNLUCID_ADMIN_TOKEN` | Bearer token for `/api/*` (also set as Worker secret `ADMIN_TOKEN`) |

Optional Worker secrets via dashboard or `wrangler secret put`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

### First-time Cloudflare setup

1. `npx wrangler login`
2. `npx wrangler d1 create unlucid-gems` — paste the returned `database_id` into `wrangler.toml`.
3. `npx wrangler d1 execute unlucid-gems --remote --file=./schema.sql`
4. `printf '%s' '<your-token>' | npx wrangler secret put ADMIN_TOKEN`
5. `npm run deploy`

Live URLs (after deploy):

- Worker: `https://unlucid-free-gems.<subdomain>.workers.dev`
- GitHub Pages: `https://kevinmartins84.github.io/unlucid-free-gems/`

## Development

```bash
npm install
npm run db:migrate:local
npm test
npm run dev
```

Set `ADMIN_TOKEN` in `.dev.vars`:

```
ADMIN_TOKEN=dev-local-token
```

## Migrating from Felicity

Export rows from Felicity MySQL table `UnlucidFreeGemsLogins` and re-create them in this admin UI (cookies are sensitive — do not commit them).