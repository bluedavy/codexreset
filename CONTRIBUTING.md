# Contributing

Help make the Quota Beast funnier and the Reset Card more satisfying. Ideas, bug reports and pull requests are welcome at https://github.com/bluedavy/codexreset .

## Get started

1. Fork the repository and clone your fork.
2. Use Node.js 24+, then run `npm ci`.
3. Create an ignored `.dev.vars` containing local-only values for `VISITOR_HASH_SALT` and `ADMIN_RESET_SECRET`.
4. Run `npm run dev` and open the local URL.
5. Run `npm run check` and `npm test` before submitting a pull request.

The local Wrangler environment uses its own SQLite Durable Object storage. Use local or isolated test data; do not add test hits or synthetic reset events to the live site. Cloudflare deployment requires the maintainer’s account and secrets. Never commit `.env`, `.dev.vars`, tokens, private keys or production data exports.

## Keep the joke simple

- One shared Boss and one main interaction: tap the Reset Card.
- Keep the page in English, small, framework-free and usable on narrow phones.
- The Boss itself is the quota meter, drawn as an inline SVG.
- Hits lower HP forever; only a verified public full/global reset ends a round.
- Ignore banked resets, stale feeds and predictions.
- Preserve anonymous participation, atomic counters and batch idempotency.
- Respect reduced motion and keyboard interaction.

For gameplay changes, describe the idea and include a screenshot or short clip if helpful. For backend changes, explain how counting, retries and round transitions remain correct. Opening a PR does not publish it to the live site.
