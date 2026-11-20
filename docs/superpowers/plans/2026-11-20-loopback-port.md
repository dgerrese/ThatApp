# #26 — the dev stack listens on loopback only

**Date:** 2026-11-20
**Supersedes:** nothing
**Superseded by:** nothing

Ticket: https://github.com/dgerrese/ThatApp/issues/26. The approach (loopback only, no new `THAT_*`
variable) was settled with the owner on 2026-11-04 and is in the ticket body.

## Task 1 — publish the `app` port on 127.0.0.1

- `docker-compose.yml`, `app` service: `"127.0.0.1:${THAT_PORT:-8080}:8080"`, with a short comment:
  ThatApp has no login, so anything that reaches the port can use the Jira tokens it holds — the same
  reason the README binds the release to `127.0.0.1`. Check no other service publishes a port.
- `.env.example`: the `THAT_PORT` comment says the port is bound to loopback.
- The `eod` skill's check (`.claude/skills/eod/SKILL.md`, `ss -ltn | grep ":$PORT"`) still matches a
  `127.0.0.1:<port>` listener, so it needs no change. Confirm against the real `ss` output.

**Verification (paste commands and output):**

1. `docker compose config` shows the `app` port with `host_ip: 127.0.0.1`.
2. `make up`; `ss -ltn | grep ":8091"` shows `127.0.0.1:8091` only (no `0.0.0.0` or `[::]`).
3. `curl http://127.0.0.1:8091/api/health` answers. `curl` to the host's LAN address on 8091 is
   refused (find the address with `ip -4 addr show scope global`).
4. Run the eod skill's `ss` line against this checkout's `.env` and show it matches.
5. `make down`, `make verify`, `make test-e2e`.
