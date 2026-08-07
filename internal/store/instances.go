package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Instance is a configured Jira Cloud site.
//
// TokenEnc is opaque to the store: it is written and read unchanged, and
// encrypting it is the caller's job.
type Instance struct {
	ID        int64
	Name      string
	BaseURL   string
	Email     string
	TokenEnc  []byte
	CreatedAt time.Time
}

// instanceColumns is the select list every instance query shares, in the order
// scanInstance expects.
const instanceColumns = `id, name, base_url, email, api_token_enc, created_at`

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanInstance(row scanner) (*Instance, error) {
	var (
		inst      Instance
		createdAt string
	)
	if err := row.Scan(
		&inst.ID, &inst.Name, &inst.BaseURL, &inst.Email, &inst.TokenEnc, &createdAt,
	); err != nil {
		return nil, err
	}

	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return nil, fmt.Errorf("parsing created_at %q: %w", createdAt, err)
	}
	inst.CreatedAt = parsed

	return &inst, nil
}

// CreateInstance stores a new Jira site and returns it with its assigned id.
func (s *Store) CreateInstance(
	ctx context.Context, name, baseURL, email string, tokenEnc []byte,
) (*Instance, error) {
	// Truncated because created_at is stored as RFC3339, which has one-second
	// resolution. Without this the returned value would not equal the stored one.
	createdAt := time.Now().UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`INSERT INTO instances (name, base_url, email, api_token_enc, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		name, baseURL, email, tokenEnc, createdAt.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("inserting instance %q: %w", name, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("reading id of new instance %q: %w", name, err)
	}

	return &Instance{
		ID: id, Name: name, BaseURL: baseURL, Email: email,
		TokenEnc: tokenEnc, CreatedAt: createdAt,
	}, nil
}

// Instances returns every stored Jira site, oldest first.
func (s *Store) Instances(ctx context.Context) ([]Instance, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+instanceColumns+` FROM instances ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("querying instances: %w", err)
	}
	defer func() { _ = rows.Close() }()

	instances := []Instance{}
	for rows.Next() {
		inst, err := scanInstance(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning instance: %w", err)
		}
		instances = append(instances, *inst)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating instances: %w", err)
	}

	return instances, nil
}

// Instance returns one stored Jira site. A missing id yields an error wrapping
// sql.ErrNoRows.
func (s *Store) Instance(ctx context.Context, id int64) (*Instance, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+instanceColumns+` FROM instances WHERE id = ?`, id)

	inst, err := scanInstance(row)
	if err != nil {
		return nil, fmt.Errorf("reading instance %d: %w", id, err)
	}

	return inst, nil
}

// UpdateInstance overwrites a stored Jira site. A missing id yields an error
// wrapping sql.ErrNoRows.
func (s *Store) UpdateInstance(
	ctx context.Context, id int64, name, baseURL, email string, tokenEnc []byte,
) error {
	result, err := s.db.ExecContext(ctx,
		`UPDATE instances SET name = ?, base_url = ?, email = ?, api_token_enc = ? WHERE id = ?`,
		name, baseURL, email, tokenEnc, id,
	)
	if err != nil {
		return fmt.Errorf("updating instance %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "updating instance", id)
}

// DeleteInstance removes a stored Jira site, cascading to its pinned issues,
// time entries and timer. A missing id yields an error wrapping sql.ErrNoRows.
func (s *Store) DeleteInstance(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM instances WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting instance %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "deleting instance", id)
}

// errNoRowsIfUnaffected turns "matched nothing" into sql.ErrNoRows. UPDATE and
// DELETE against a missing id are not driver errors, so without this they would
// succeed silently.
func errNoRowsIfUnaffected(result sql.Result, action string, id int64) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s %d: reading rows affected: %w", action, id, err)
	}
	if affected == 0 {
		return fmt.Errorf("%s %d: %w", action, id, sql.ErrNoRows)
	}

	return nil
}
