package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Instance is a configured Jira Cloud site.
//
// SiteURL and APIBaseURL are two different things and neither is derived from
// the other: REST calls go to the API gateway, issue links go to the site host.
// Either may be empty, which is how a NULL column reads: a migrated row that
// held a gateway URL has no recoverable site, and a row awaiting its first use
// has no resolved API base. Both cannot be empty at once — validate enforces
// what ALTER TABLE could not express as a table-level CHECK.
//
// TokenEnc is opaque to the store: written and read unchanged, and encrypting
// it is the caller's job. Its json:"-" is defence in depth, not a licence to
// serialise this struct — the HTTP layer owns its own response shape.
type Instance struct {
	ID         int64
	Name       string
	SiteURL    string
	APIBaseURL string
	Email      string
	TokenEnc   []byte `json:"-"`
	CreatedAt  time.Time
}

// InstanceInput carries the fields a caller supplies when storing a site. It is
// a struct rather than positional parameters because six adjacent strings at a
// call site cannot be read for correctness.
type InstanceInput struct {
	Name       string
	SiteURL    string
	APIBaseURL string
	Email      string
	TokenEnc   []byte
}

// ErrInstanceNeedsURL reports an input carrying neither URL. The schema cannot
// enforce this: ALTER TABLE adds no table-level CHECK, and the rebuild that
// would add one cascades into time_entries.
var ErrInstanceNeedsURL = errors.New("store: instance needs a site URL or an API base URL")

func (in InstanceInput) validate() error {
	if in.SiteURL == "" && in.APIBaseURL == "" {
		return ErrInstanceNeedsURL
	}

	return nil
}

const instanceColumns = `id, name, site_url, api_base_url, email, api_token_enc, created_at`

type scanner interface {
	Scan(dest ...any) error
}

func scanInstance(row scanner) (*Instance, error) {
	var (
		inst       Instance
		siteURL    sql.NullString
		apiBaseURL sql.NullString
		createdAt  string
	)
	if err := row.Scan(
		&inst.ID, &inst.Name, &siteURL, &apiBaseURL, &inst.Email, &inst.TokenEnc, &createdAt,
	); err != nil {
		return nil, err
	}
	inst.SiteURL = siteURL.String
	inst.APIBaseURL = apiBaseURL.String

	parsed, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return nil, fmt.Errorf("parsing created_at %q: %w", createdAt, err)
	}
	inst.CreatedAt = parsed

	return &inst, nil
}

// nullable turns the Go zero value into a SQL NULL, so that absence has one
// representation in the database and the CHECK constraints stay satisfiable.
func nullable(s string) any {
	if s == "" {
		return nil
	}

	return s
}

// CreateInstance stores a new Jira site and returns it with its assigned id.
func (s *Store) CreateInstance(ctx context.Context, in InstanceInput) (*Instance, error) {
	if err := in.validate(); err != nil {
		return nil, err
	}

	// Truncated because created_at is stored as RFC3339, which has one-second
	// resolution. Without this the returned value would not equal the stored one.
	createdAt := time.Now().UTC().Truncate(time.Second)

	result, err := s.db.ExecContext(ctx,
		`INSERT INTO instances (name, site_url, api_base_url, email, api_token_enc, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		in.Name, nullable(in.SiteURL), nullable(in.APIBaseURL), in.Email, in.TokenEnc,
		createdAt.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("inserting instance %q: %w", in.Name, err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("reading id of new instance %q: %w", in.Name, err)
	}

	return &Instance{
		ID: id, Name: in.Name, SiteURL: in.SiteURL, APIBaseURL: in.APIBaseURL,
		Email: in.Email, TokenEnc: in.TokenEnc, CreatedAt: createdAt,
	}, nil
}

// Instances returns every stored Jira site, oldest first.
//
// Ordered by created_at rather than id: id is INTEGER PRIMARY KEY without
// AUTOINCREMENT, so SQLite may hand a new row a rowid freed by a delete, which
// would sort a new site among the old ones. id breaks ties, since created_at
// has one-second resolution.
func (s *Store) Instances(ctx context.Context) ([]Instance, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+instanceColumns+` FROM instances ORDER BY created_at, id`)
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
func (s *Store) UpdateInstance(ctx context.Context, id int64, in InstanceInput) error {
	if err := in.validate(); err != nil {
		return err
	}

	result, err := s.db.ExecContext(ctx,
		`UPDATE instances
		    SET name = ?, site_url = ?, api_base_url = ?, email = ?, api_token_enc = ?
		  WHERE id = ?`,
		in.Name, nullable(in.SiteURL), nullable(in.APIBaseURL), in.Email, in.TokenEnc, id,
	)
	if err != nil {
		return fmt.Errorf("updating instance %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "updating instance", id)
}

// SetInstanceAPIBase persists an API base resolved after the row was stored.
// Only a migrated row reaches here: creating an instance resolves its cloud id
// up front, because the save-time identity check cannot run without one.
func (s *Store) SetInstanceAPIBase(ctx context.Context, id int64, apiBaseURL string) error {
	if apiBaseURL == "" {
		return fmt.Errorf("setting API base for instance %d: %w", id, ErrInstanceNeedsURL)
	}

	result, err := s.db.ExecContext(ctx,
		`UPDATE instances SET api_base_url = ? WHERE id = ?`, apiBaseURL, id)
	if err != nil {
		return fmt.Errorf("setting API base for instance %d: %w", id, err)
	}

	return errNoRowsIfUnaffected(result, "setting API base for instance", id)
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
