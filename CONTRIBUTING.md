# Contributing

Thanks for taking a look. This started as a personal tool, so a few things are worth knowing before you dive in.

## Heads up

- **Code comments, commit messages, and the UI are in Chinese.** The README is bilingual, but the codebase is not.
  Pull requests in either language are fine.
- **macOS is the primary platform.** Linux should work for the core features; the `deploy/` autostart scripts are
  macOS-only. Windows is untested — reports welcome.
- The board is **agent-agnostic by construction**: it never launches an agent, it only stores state that
  agents read and write through the CLI or HTTP API. Please keep it that way — don't add code that
  shells out to a particular agent.

## Development setup

```bash
cd client && npm install && npm run build
cd ../server && npm install && npm run start
```

Then http://127.0.0.1:7788 . For iterating:

```bash
cd server && npm run dev    # backend, tsx watch
cd client && npm run dev    # frontend dev server, proxies /api
```

## Before you open a PR

```bash
cd server && npm run typecheck && npm test
cd client && npm run build
```

All of the above must pass — CI runs exactly these.

Also:

- **Database columns need comments.** Every table and column in `server/src/schema.sql` carries a comment
  explaining what it holds (enum values listed, FK targets named, JSON shapes described). Keep that up.
- **Schema changes need a migration.** `server/src/db.ts` runs migrations guarded by `PRAGMA user_version`.
  Existing databases must survive the upgrade — write the migration, and a test for it.
- **Update the index files** when you add files or change interfaces: `DIRECTORY.md` (what each file does),
  `SCHEMA.md` (tables and columns), `API.md` (routes and auth).

## Security-sensitive areas

The board listens on localhost and its API can modify task state that coding agents act on. Changes to the
`onRequest` hook (Host whitelist / cross-site rejection) or the auth hook in `server/src/index.ts`, or to the
binding checks in `server/src/config.ts`, deserve extra scrutiny — please call out the security reasoning in
your PR description.

If you believe you've found a vulnerability, please open a private security advisory rather than a public issue.

## Reporting bugs

Include your OS, Node version, and what `board here` or the server log printed. If it's a scanning issue,
the layout of the project directory that triggered it matters (nested repos, symlinks, missing git remote).
