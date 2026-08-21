package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// Pin is an issue kept on the Today view whether or not it is assigned to the
// user. Both caches are written when the pin is created and rewritten by a
// refresh; they read as "" only for a row written before status_cache existed.
type Pin struct {
	ID           int64
	InstanceID   int64
	IssueKey     string
	SummaryCache string
	StatusCache  string
	CreatedAt    time.Time
}

// PinInput carries what a caller supplies when pinning. The caches are inputs
// rather than something the store fetches: resolving them needs a Jira client,
// which the store has no business holding.
type PinInput struct {
	InstanceID   int64
	IssueKey     string
	SummaryCache string
	StatusCache  string
}

// ErrPinExists reports the UNIQUE(instance_id, issue_key) violation. Without it
// the handler could not tell a duplicate from a disk failure, and would answer
// 500 where it owes a 409.
var ErrPinExists = errors.New("store: issue already pinned on this instance")

const pinColumns = `id, instance_id, issue_key, summary_cache, status_cache, created_at`

func scanPin(row scanner) (*Pin, error) {
	var (
		pin       Pin
		summary   sql.NullString
		status    sql.NullString
		createdAt string
	)
	if err := row.Scan(
		&pin.ID, &pin.InstanceID, &pin.IssueKey, &summary, &status, &createdAt,
	); err != nil {
		return nil, err
	}
	pin.SummaryCache = summary.String
	pin.StatusCache = status.String

	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return nil, fmt.Errorf("parsing created_at %q: %w", createdAt, err)
	}
	pin.CreatedAt = parsed

	return &pin, nil
}

// isUniqueViolation reports the constraint failure by its SQLite code rather
// than by matching the driver's message, which is not part of any contract.
func isUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error

	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// CreatePin stores a pin and returns it with its assigned id.
func (s *Store) CreatePin(ctx context.Context, in PinInput) (*Pin, error) {
	// Truncated because created_at is stored as RFC3339, which has one-second
	// resolution. Without this the returned value would not equal the stored one.
	createdAt := time.Now().UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`INSERT INTO pinned_issues (instance_id, issue_key, summary_cache, status_cache, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		in.InstanceID, in.IssueKey, nullable(in.SummaryCache), nullable(in.StatusCache),
		createdAt.Format(time.RFC3339),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("pinning %q on instance %d: %w",
				in.IssueKey, in.InstanceID, ErrPinExists)
		}

		return nil, fmt.Errorf("pinning %q on instance %d: %w", in.IssueKey, in.InstanceID, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("reading id of new pin %q: %w", in.IssueKey, err)
	}

	return &Pin{
		ID: id, InstanceID: in.InstanceID, IssueKey: in.IssueKey,
		SummaryCache: in.SummaryCache, StatusCache: in.StatusCache, CreatedAt: createdAt,
	}, nil
}

// Pins returns every pin, oldest first, ordered as Instances is and for the
// same reason: id is a reusable rowid, so it cannot carry insertion order.
func (s *Store) Pins(ctx context.Context) ([]Pin, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+pinColumns+` FROM pinned_issues ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("querying pins: %w", err)
	}
	defer func() { _ = rows.Close() }()

	pins := []Pin{}
	for rows.Next() {
		pin, err := scanPin(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning pin: %w", err)
		}
		pins = append(pins, *pin)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating pins: %w", err)
	}

	return pins, nil
}

// SetPinCache rewrites what a refresh learned. A missing id yields an error
// wrapping sql.ErrNoRows.
func (s *Store) SetPinCache(ctx context.Context, id int64, summary, status string) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE pinned_issues SET summary_cache = ?, status_cache = ? WHERE id = ?`,
		nullable(summary), nullable(status), id)
	if err != nil {
		return fmt.Errorf("updating the cache of pin %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "updating the cache of pin", id)
}

// DeletePin removes a pin. A missing id yields an error wrapping sql.ErrNoRows.
func (s *Store) DeletePin(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM pinned_issues WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting pin %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "deleting pin", id)
}
