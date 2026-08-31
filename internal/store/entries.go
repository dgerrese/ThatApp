package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Entry is time logged against one issue on one local day.
//
// Day is the user's local date, resolved against WD_TIMEZONE by whoever creates
// the entry; StartedAt is the instant that date was resolved from. They are
// stored separately because the container's clock is almost certainly UTC, so
// neither can be derived from the other after the fact.
//
// WorklogID and PushedAt belong to the push (#9). This package reads them and
// never writes them: whether an entry is unpushed, clean or dirty is computed
// from those two columns and UpdatedAt, never stored as a flag.
type Entry struct {
	ID         int64
	InstanceID int64
	IssueKey   string
	Day        string
	StartedAt  time.Time
	Seconds    int
	Comment    string
	WorklogID  string
	PushedAt   *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// EntryInput carries the fields a caller supplies when logging time. Day and
// StartedAt are inputs rather than something the store stamps: the day boundary
// is resolved once, server-side, against the configured zone, which the store
// has no business holding.
type EntryInput struct {
	InstanceID int64
	IssueKey   string
	Day        string
	StartedAt  time.Time
	Seconds    int
	Comment    string
}

// day is cast because the driver parses a column declared DATE into a
// time.Time, which arrives as a full timestamp — "2026-08-21T00:00:00Z" for a
// local date of "2026-08-21". The cast hands back the text as stored.
const entryColumns = `id, instance_id, issue_key, CAST(day AS TEXT) AS day, started_at, seconds,
	comment, worklog_id, pushed_at, created_at, updated_at`

func scanEntry(row scanner) (*Entry, error) {
	var (
		entry     Entry
		comment   sql.NullString
		worklogID sql.NullString
		pushedAt  sql.NullString
		startedAt string
		createdAt string
		updatedAt string
	)
	if err := row.Scan(
		&entry.ID, &entry.InstanceID, &entry.IssueKey, &entry.Day, &startedAt, &entry.Seconds,
		&comment, &worklogID, &pushedAt, &createdAt, &updatedAt,
	); err != nil {
		return nil, err
	}
	entry.Comment = comment.String
	entry.WorklogID = worklogID.String

	for _, field := range []struct {
		column string
		text   string
		into   *time.Time
	}{
		{"started_at", startedAt, &entry.StartedAt},
		{"created_at", createdAt, &entry.CreatedAt},
		{"updated_at", updatedAt, &entry.UpdatedAt},
	} {
		parsed, err := time.Parse(time.RFC3339, field.text)
		if err != nil {
			return nil, fmt.Errorf("parsing %s %q: %w", field.column, field.text, err)
		}
		*field.into = parsed
	}

	if pushedAt.Valid {
		parsed, err := time.Parse(time.RFC3339, pushedAt.String)
		if err != nil {
			return nil, fmt.Errorf("parsing pushed_at %q: %w", pushedAt.String, err)
		}
		entry.PushedAt = &parsed
	}

	return &entry, nil
}

func scanEntries(rows *sql.Rows, attempted string) ([]Entry, error) {
	defer func() { _ = rows.Close() }()

	entries := []Entry{}
	for rows.Next() {
		entry, err := scanEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning an entry while %s: %w", attempted, err)
		}
		entries = append(entries, *entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating entries while %s: %w", attempted, err)
	}

	return entries, nil
}

// CreateEntry stores logged time and returns it with its assigned id.
func (s *Store) CreateEntry(ctx context.Context, in EntryInput) (*Entry, error) {
	// Truncated because the timestamps are stored as RFC3339, which has
	// one-second resolution. Without this the returned value would not equal the
	// stored one.
	createdAt := time.Now().UTC().Truncate(time.Second)

	// Normalised to UTC because started_at is a text column: an offset preserved
	// here would make SQLite's lexicographic ordering disagree with chronology,
	// and both read paths sort on it.
	startedAt := in.StartedAt.UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`INSERT INTO time_entries
		        (instance_id, issue_key, day, started_at, seconds, comment, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		in.InstanceID, in.IssueKey, in.Day, startedAt.Format(time.RFC3339), in.Seconds,
		nullable(in.Comment), createdAt.Format(time.RFC3339), createdAt.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("logging %ds against %q on instance %d: %w",
			in.Seconds, in.IssueKey, in.InstanceID, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("reading id of new entry for %q: %w", in.IssueKey, err)
	}

	return &Entry{
		ID: id, InstanceID: in.InstanceID, IssueKey: in.IssueKey, Day: in.Day,
		StartedAt: startedAt, Seconds: in.Seconds, Comment: in.Comment,
		CreatedAt: createdAt, UpdatedAt: createdAt,
	}, nil
}

// EntriesForDay returns every entry whose day falls within an inclusive range,
// oldest first. A range covering nothing yields an empty slice, not nil.
func (s *Store) EntriesForDay(ctx context.Context, from, to string) ([]Entry, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+entryColumns+`
		   FROM time_entries
		  WHERE day BETWEEN ? AND ?
		  ORDER BY day, started_at, id`, from, to)
	if err != nil {
		return nil, fmt.Errorf("querying entries from %s to %s: %w", from, to, err)
	}

	return scanEntries(rows, fmt.Sprintf("reading entries from %s to %s", from, to))
}

// UpdateEntry rewrites an entry's duration and comment and returns the stored
// row. Day and started_at are never touched — the start time is not editable,
// and moving an entry between days would let the browser rewrite history the
// server stamped. A missing id yields an error wrapping sql.ErrNoRows.
//
// updated_at moves on every call, including one that writes the same seconds and
// comment back. That marks a clean, pushed entry dirty and has #9 re-push it,
// which is deliberate: the push is idempotent, so the cost is one redundant
// request, and that is cheaper than diffing the row to decide.
func (s *Store) UpdateEntry(
	ctx context.Context, id int64, seconds int, comment string,
) (*Entry, error) {
	// Moving updated_at is half of what makes an entry dirty for #9's push.
	updatedAt := time.Now().UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`UPDATE time_entries SET seconds = ?, comment = ?, updated_at = ? WHERE id = ?`,
		seconds, nullable(comment), updatedAt.Format(time.RFC3339), id)
	if err != nil {
		return nil, fmt.Errorf("updating entry %d: %w", id, err)
	}
	if err := errNoRowsIfUnaffected(result, "updating entry", id); err != nil {
		return nil, err
	}

	return s.Entry(ctx, id)
}

// DeleteEntry removes logged time. A missing id yields an error wrapping
// sql.ErrNoRows.
func (s *Store) DeleteEntry(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM time_entries WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting entry %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "deleting entry", id)
}

// MarkEntryPushed records the Jira worklog an entry became.
//
// It names only worklog_id and pushed_at. Stamping updated_at here would race
// pushed_at and could leave a just-pushed entry reading as dirty, since the
// spec derives dirty from updated_at > pushed_at.
func (s *Store) MarkEntryPushed(
	ctx context.Context, id int64, worklogID string, pushedAt time.Time,
) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE time_entries SET worklog_id = ?, pushed_at = ? WHERE id = ?`,
		worklogID, pushedAt.UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("recording worklog %s for entry %d: %w", worklogID, id, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("counting rows updated for entry %d: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("recording worklog %s: no entry %d", worklogID, id)
	}

	return nil
}

// Entry reads one entry by id. A missing id yields an error wrapping
// sql.ErrNoRows. It exists for the partial PATCH: a request carrying only a
// duration has to keep the stored comment, and UpdateEntry writes both. That
// read-then-write is not atomic — see handleUpdateEntry on why the interleaving
// is tolerated.
func (s *Store) Entry(ctx context.Context, id int64) (*Entry, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+entryColumns+` FROM time_entries WHERE id = ?`, id)

	entry, err := scanEntry(row)
	if err != nil {
		return nil, fmt.Errorf("reading entry %d: %w", id, err)
	}

	return entry, nil
}
