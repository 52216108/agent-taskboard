# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/52216108/agent-taskboard/security/advisories/new)
instead.

Include what you'd need to reproduce it: the request or command, the configuration it happens under
(especially whether `BOARD_TOKEN` and `BOARD_HOST` are set), and what an attacker gains.

This is a personal project maintained in spare time — expect a first response within a week or so,
not within hours.

## Threat model

Understanding what this project does and does not defend against will save you time.

**What it is:** a local-first board that stores project and task state. It never launches a coding
agent and never calls a model API — agents come to it, reading and writing state through the CLI or
the HTTP API. The only subprocess the server ever spawns is `git`, read-only, with a fixed argv
(see `server/src/git.ts`), to read branch and status while scanning.

That said, the state it holds is not inert: **task descriptions become instructions that a coding
agent will act on**. Whoever can write to the board can influence what your agent does next.

**What it defends against:**

- **Exposure to the network without authentication.** Binding to a non-loopback address without
  `BOARD_TOKEN` set is refused at startup, not warned about.
- **DNS rebinding.** All `/api/` requests validate the `Host` header against a whitelist, so a
  rebound attacker domain can't reach the API even though the browser considers it same-origin.
- **Cross-site requests from a browser.** `Sec-Fetch-Site: cross-site`/`same-site` is rejected.
  This matters because a `text/plain` POST is a CORS simple request and never triggers a preflight —
  without this check, any web page you visit could quietly rewrite tasks on your `127.0.0.1` board.
- **Path traversal in served static files**, via `@fastify/static`.
- **Token leakage into logs.** Query-string tokens are redacted from access logs; token comparison
  is constant-time.

**What it does not defend against:**

- **A local attacker who can already run commands as you.** They can read `~/.project-board/token`
  and call the API directly. Nothing here is a sandbox against that.
- **Malicious task content.** Task titles and descriptions are handed to a coding agent as
  instructions. If someone can write tasks to your board, they can influence what your agent does.
  Treat write access to the board as equivalent to shell access.
- **A hostile agent.** Setting a task `done` is refused on the general `PATCH` and must go through
  `POST /api/tasks/:id/accept` (which records `accepted_at`/`accepted_by`), so a stray update can't
  silently close a task and completions are auditable. But this is a guardrail, not a boundary: the
  human and the agent share one token, so an agent can call `accept` itself. That agents claim only
  `todo` tasks and hand work back at `review` rather than closing them remains a convention in
  `AGENTS.md` and the skill file, not an API-enforced permission. See the README section on what's
  enforced and what isn't.
- **Multi-user separation.** There is one token and no per-user permissions. This is a single-user
  tool; don't share an instance.
- **Browsers that don't send `Sec-Fetch-Site`.** The cross-site check can only reject what identifies
  itself. Very old browsers omit the header and are let through, on the grounds that blocking every
  header-less client would break the CLI and curl. The Host whitelist still applies to them, so this
  gap is narrower than it sounds — but if you set `BOARD_TOKEN`, writes become header-only anyway,
  which closes it entirely.

## Supported versions

The latest commit on `main`. There are no maintained release branches.
