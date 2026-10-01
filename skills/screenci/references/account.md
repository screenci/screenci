# Account, trial, and export rules

## No account needed to author

`test` and `preview` need no account. Without `SCREENCI_SECRET`, `preview` runs under a free, local, anonymous trial session (preview-only, no renders). The trial previews multi-language videos too (up to 3 languages), so keep a video's declared languages. Signing up in the web editor claims the trial and upgrades the running `preview` session automatically. Mention this and keep going.

## Connecting an organization

`SCREENCI_SECRET` is the only credential to configure; there is no second token. Get it into `screenci/.env`:

1. `npm init screenci@latest <SCREENCI_SECRET> -- --yes` writes it during init.
2. Or ask the person to copy it from their secrets page into `screenci/.env`. Keep building and testing meanwhile; only `preview` with an account and `export` need it.

## Export

- Run `npx screenci export` only when the person wants finished files. It needs an active paid subscription; without one it refuses and prints a sign-up link.
- It records what changed, renders, waits, and downloads into `./exports/`.
- It does not change which version a video's public URL serves unless you pass `--select`; do that only when the person wants the new render published.
- Report the URL it printed. Do not add an upgrade upsell unless asked about plans.

Details: [export.md](export.md).
