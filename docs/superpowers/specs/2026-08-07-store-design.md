# Store Layer — Design

- **Date:** 2026-08-07
- **Status:** Approved
- **Scope:** GitHub issue #2 (ticket 2 of the sequence in `2026-08-04-work-dashboard-design.md`)

## Purpose

The persistence layer every later ticket writes through. The parent design already fixes the
schema — four tables, their columns, indexes and constraints — and this document settles only the
Go shape around it: how migrations are applied, how the connection is configured, and how much of
the repository layer ticket 2 builds.

Read the parent design's **Data model** and **Push semantics** sections first. Nothing here
restates them.

## Scope: a thin slice, grown per ticket

Ticket 2 delivers the schema, the migration mechanism, connection setup, and **instance CRUD
only**. Repository methods for pins, entries and timers arrive with tickets 6-9, alongside the
callers that need them.

The alternative — implementing every method any later ticket might want — was rejected. Most of it
would ship with no caller, and its signatures would be guessed rather than shaped by real use.
Instances are the exception because two near-term tickets need them: #3 stores an encrypted token,
#4 drives them from the settings UI.

## Package shape

```
internal/store/
  store.go               Open, Close, the DB handle
  migrate.go             the migration runner
  instances.go           instance CRUD
  migrations/
    2026-08-07_120000_initial.sql
```

One concrete `Store` type wrapping `*sql.DB`. **No interfaces**: there would be exactly one
implementation, which the repo conventions treat as a finding.

Later tickets add `entries.go`, `pins.go` and `timers.go` beside these. Splitting by entity rather
than by operation keeps each file small and keeps the queries for one table in one place.

## Migrations

Migration files are named `<YYYY>-<MM>-<DD>_<HHMMSS>[mmm]_<description>.sql`, where the
millisecond suffix is added only to break a collision. Timestamps rather than incrementing
integers, so two branches adding migrations do not collide on a sequence number.

The format sorts correctly under plain lexicographic ordering, including the collision case: a
string sorts before its own extensions, so `2026-08-07_143022` precedes `2026-08-07_143022123`.

`//go:embed migrations/*.sql` compiles them into the binary, so the `scratch` production image
carries its own schema with no files to mount.

### Tracking applied migrations

Applied migrations are recorded in a table, not in `PRAGMA user_version`:

```sql
CREATE TABLE schema_migrations (
  version    VARCHAR(150) PRIMARY KEY,  -- the migration's filename
  applied_at DATETIME NOT NULL          -- RFC3339
);
```

`user_version` is a 32-bit signed integer and cannot hold a timestamp-derived version — the
digits of `20260807143022` alone overflow it by four orders of magnitude. A table also records
*which* migrations ran rather than only how many, which is what makes a partially-applied history
diagnosable.

### The runner

On `Open`: create `schema_migrations` if absent, read the applied set, sort the embedded filenames,
and apply each unapplied one **in a transaction that also inserts its version row**. The migration
and its bookkeeping commit together or not at all; a migration that applied without being recorded
would re-run on next boot, and one recorded without applying would be skipped forever.

A failure aborts startup with a wrapped error. The server refusing to start on a bad schema matches
how `config.Load` treats malformed configuration — loud at boot beats subtle at runtime.

### Refusing a database from a newer build

Recording *which* migrations ran is only worth the table if something acts on it. After reading the
applied set, `Open` **errors when a recorded version is absent from the embedded set**, naming the
unknown versions. Roll the container image back after a schema change and the old binary would
otherwise start cheerfully against a database whose shape it does not understand — the same "loud at
boot" rule, applied to the one failure the version rows can detect.

There is no down-migration. Recovering from a rollback means restoring a backup or moving forward
again, not undoing schema.

### Two processes migrating at once

The applied set is read before `applyMigration` opens its transaction, so two processes starting
against the same fresh database can both decide a migration is unapplied. **The runner therefore
rechecks membership inside the transaction**, and returns without applying when the row is already
there.

The recheck is only sound because the transaction holds the write lock from `BEGIN` — see
`_txlock=immediate` below. The alternative, holding one write transaction across the whole runner,
was rejected: it would have to wrap `CREATE TABLE IF NOT EXISTS schema_migrations` and every
migration body in a single transaction, which makes a partial failure harder to reason about for no
gain over a per-migration recheck.

One race the recheck cannot close is the first connection's WAL conversion: `PRAGMA journal_mode =
WAL` needs exclusive access, and SQLite does **not** run the busy handler for it, so `busy_timeout`
does not apply. Two processes creating the database simultaneously leave one with an immediate
`SQLITE_BUSY` from the very first `Ping`. `Open` retries a busy `Ping` a bounded number of times; the
conversion happens once, and the retry finds the database already in WAL.

## Connection setup

Three pragmas and one transaction-locking option, set in the DSN so they apply to every pooled
connection rather than to whichever one happened to execute a `PRAGMA` statement:

| Setting | Why |
|---|---|
| `foreign_keys = ON` | SQLite defaults it **off**. Without it the schema's `ON DELETE CASCADE` clauses silently do nothing, and deleting an instance orphans its pins, entries and timer instead of removing them. |
| `journal_mode = WAL` | A reader does not block the writer. Matters once the end-of-day push writes while the UI reads. |
| `busy_timeout = 5000` | Turns a transient lock into a short wait rather than an immediate `SQLITE_BUSY`. **Covers plain statements only** — see below. |
| `_txlock=immediate` | Makes `db.Begin` issue `BEGIN IMMEDIATE`, so a transaction takes its write lock up front, where `busy_timeout` applies. |

### Why `busy_timeout` is not enough on its own

`busy_timeout` installs a busy handler that retries a blocked *statement*. It does **not** rescue a
transaction. `db.Begin` opens a **deferred** transaction, which takes only a read lock; when the
first write arrives SQLite must upgrade read→write, and it returns `SQLITE_BUSY` **immediately**
rather than invoking the busy handler, because sleeping while holding a read lock could deadlock two
upgraders against each other.

Measured on this schema, eight concurrent `CreateInstance` calls — plain `ExecContext`, no
transaction — all succeed, while eight concurrent read-then-insert transactions see **six to seven
of eight fail** with `database is locked (5) (SQLITE_BUSY)`. `_txlock=immediate` takes the write lock
at `BEGIN`, where the busy handler does run, and all eight then commit.

**The trade-off:** every transaction now takes the database's write lock, so a future read-only
transaction serialises behind writers instead of running concurrently with them. For a single-user
self-hosted app that is the right side of the trade — the alternative is intermittent, hard to
reproduce `SQLITE_BUSY` in tickets 6-9, which are inherently transactional: stopping a timer must
create its entry and clear the timer atomically, and the end-of-day push updates entries in bulk.
This is a recorded decision, not an accident. A workload that ever wants genuinely concurrent
read-only transactions must revisit it rather than quietly drop the option.

## Instances

```go
func (s *Store) CreateInstance(ctx context.Context, name, baseURL, email string, tokenEnc []byte) (*Instance, error)
func (s *Store) Instances(ctx context.Context) ([]Instance, error)
func (s *Store) Instance(ctx context.Context, id int64) (*Instance, error)
func (s *Store) UpdateInstance(ctx context.Context, id int64, name, baseURL, email string, tokenEnc []byte) error
func (s *Store) DeleteInstance(ctx context.Context, id int64) error
```

`tokenEnc` is opaque to the store — it neither encrypts nor decrypts. Encryption is ticket 3, and
keeping the store ignorant of it means ticket 3 changes one layer rather than two.

**`Instance.TokenEnc` carries `json:"-"`.** From ticket 3 it holds an AES-GCM ciphertext of a Jira
API token; without the tag, `json.NewEncoder(w).Encode(inst)` — the obvious handler body — ships that
ciphertext to the browser. The tag is **defence in depth, not permission**: ticket 4 must still
define its own response type for `/api/instances` rather than serialising the store struct, because
a DTO is what keeps the wire format from drifting every time a column is added. Tickets 6-9 should
give their own structs the same treatment for any field the browser has no business seeing.

`Instances` orders by `created_at, id`, not by `id` alone. `instances.id` is `INTEGER PRIMARY KEY`
**without** `AUTOINCREMENT`, so SQLite may reuse a rowid freed by a delete and a newly created site
could sort among the old ones. `id` breaks ties, since `created_at` has one-second resolution.

Every method takes a `context.Context`: ticket 5 fans out across instances concurrently and will
want cancellation to propagate.

**Missing rows are an error, on all three single-row methods.** `Instance`, `UpdateInstance` and
`DeleteInstance` each return an error wrapping `sql.ErrNoRows` when the id does not exist, so
callers distinguish "not found" from a real failure with `errors.Is`. For the two mutating methods
that means checking `RowsAffected`, since an `UPDATE` or `DELETE` matching nothing is not a driver
error. A silent no-op here would surface in ticket 4 as a settings form that reports success and
changes nothing.

## Time handling

The store formats its own timestamps as RFC3339. It **never computes `day`**: that is local-date
arithmetic against `config.Location`, and it belongs one layer up where the configuration lives.
Ticket 7 passes `day` in as an already-resolved string.

No clock is injected. A `now func() time.Time` field would exist only to make one test assertion
exact, which is a knob where a value would do. Tests instead capture `time.Now()` either side of
the call and assert the parsed `created_at` falls within that interval — which pins the behaviour
without a field that exists only for tests.

## Testing

Each test opens a `Store` against a temp-file database under `t.TempDir()`, migrates it, and closes
it. No shared fixture and no ordering dependence between tests.

**Not `:memory:`.** Under `database/sql` each pooled connection to an in-memory SQLite database
gets its own separate database, so a table created on one connection is missing on the next. The
resulting failures look like migration bugs and are not.

Coverage:

- migrations apply to an empty database, and every table exists afterwards
- running the migrator twice is a no-op, and `schema_migrations` gains no duplicate rows
- a failing migration rolls back and leaves `schema_migrations` unchanged
- **foreign keys are genuinely enforced** — deleting an instance removes its dependent rows. This
  is the test that fails if the pragma is dropped, and without it the cascade regression is
  invisible until a later ticket reads orphaned data.
- instances round-trip through create, list, get, update and delete
- `Instance` on a missing id returns an error satisfying `errors.Is(err, sql.ErrNoRows)`
- **eight concurrent write transactions all commit** — the test that fails if `_txlock=immediate` is
  dropped, and the one that stands in for tickets 6-9's transactional writes
- `Open` refuses a database recording a migration this build does not carry, naming it
- **eight concurrent `Open` calls on one fresh database all succeed** and record one row per
  migration file. Each `Open` gets its own connection pool, so this exercises the cross-process race
  rather than goroutines sharing a `*sql.DB`
- `json.Marshal` on an `Instance` omits the token
- `Instances` returns rows oldest first when `id` order and `created_at` order disagree

## Out of scope

Token encryption (#3). Any HTTP handler or route. Repository methods for pinned issues, time
entries and timers — those arrive with #6-#9, each with its caller.
