package server

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/dgerrese/work-dashboard/internal/jira"
	"github.com/dgerrese/work-dashboard/internal/store"
)

// searchLimit caps one instance's summary matches. This backs a type-ahead: a
// longer list is scrolled past, not read.
const searchLimit = 10

// minSearchQuery is the floor below which no instance is reached. The browser
// debounces to the same number; enforcing it here means a hand-made request
// cannot fan a one-character query across every site.
const minSearchQuery = 2

// issueKeyPattern is Jira's key shape. A query matching it gets an exact lookup
// as well as a summary search, because `key = "..."` in JQL is an error rather
// than an empty result when the project does not exist.
var issueKeyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*-[0-9]+$`)

type issueHitDTO struct {
	InstanceID   int64  `json:"instanceId"`
	InstanceName string `json:"instanceName"`
	Key          string `json:"key"`
	Summary      string `json:"summary"`
	Status       string `json:"status"`
	URL          string `json:"url"`
}

type instanceFailureDTO struct {
	InstanceID   int64      `json:"instanceId"`
	InstanceName string     `json:"instanceName"`
	Error        *errorBody `json:"error"`
}

type issueSearchResponseDTO struct {
	Results []issueHitDTO        `json:"results"`
	Errors  []instanceFailureDTO `json:"errors"`
}

// instanceSearchResult is one instance's share of the answer: its hits, or the
// reason it has none. Both are never set at once.
type instanceSearchResult struct {
	hits    []issueHitDTO
	failure *instanceFailureDTO
}

// handleSearchIssues answers with issues matching q across every instance,
// flattened into one ordered list because one combobox renders it.
func (s *Server) handleSearchIssues(w http.ResponseWriter, r *http.Request) {
	response := issueSearchResponseDTO{Results: []issueHitDTO{}, Errors: []instanceFailureDTO{}}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) < minSearchQuery {
		writeJSON(w, http.StatusOK, response)
		return
	}

	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed",
			"could not read the stored instances")
		return
	}

	results := fanOutInstances(r.Context(), instances, issueFetchTimeout,
		func(ctx context.Context, inst store.Instance) instanceSearchResult {
			return s.searchOneInstance(ctx, inst, query)
		})

	for _, result := range results {
		response.Results = append(response.Results, result.hits...)
		if result.failure != nil {
			response.Errors = append(response.Errors, *result.failure)
		}
	}

	writeJSON(w, http.StatusOK, response)
}

// searchOneInstance never returns an error: one site being unreachable is part
// of the answer, and an error would cancel every sibling through the group's
// context.
func (s *Server) searchOneInstance(
	ctx context.Context, inst store.Instance, query string,
) instanceSearchResult {
	fail := func(err error) instanceSearchResult {
		return instanceSearchResult{failure: &instanceFailureDTO{
			InstanceID: inst.ID, InstanceName: inst.Name, Error: instanceErrorBody(err),
		}}
	}

	client, err := s.clients.forInstance(ctx, &inst)
	if err != nil {
		return fail(err)
	}

	hits := []issueHitDTO{}
	exact := ""

	if issueKeyPattern.MatchString(query) {
		key := strings.ToUpper(query)
		// A miss is an ordinary answer to "is this key here", not a failure.
		if issue, err := client.Issue(ctx, key); err == nil {
			exact = issue.Key
			hits = append(hits, hitFrom(inst, *issue))
		} else if !errors.Is(err, jira.ErrNotFound) {
			return fail(err)
		}
	}

	found, err := client.SearchText(ctx, query, searchLimit)
	if err != nil {
		return fail(err)
	}

	for _, issue := range found {
		if issue.Key == exact {
			continue
		}
		hits = append(hits, hitFrom(inst, issue))
	}

	return instanceSearchResult{hits: hits}
}

func hitFrom(inst store.Instance, issue jira.Issue) issueHitDTO {
	return issueHitDTO{
		InstanceID:   inst.ID,
		InstanceName: inst.Name,
		Key:          issue.Key,
		Summary:      issue.Summary,
		Status:       issue.Status,
		URL:          browseURL(inst.SiteURL, issue.Key),
	}
}
