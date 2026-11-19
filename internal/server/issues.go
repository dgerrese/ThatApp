package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/dgerrese/ThatApp/internal/store"
)

// issueFetchTimeout bounds one instance's fetch. jira.Client allows itself 30s
// per call, which is too long here: the response waits on every instance, so a
// single stalled site would hold the whole list open. Bounding each instance
// separately means a stalled one reports its own error while the rest render.
const issueFetchTimeout = 15 * time.Second

// issueDTO is one issue as the Today view needs it. The URL is built here rather
// than in the browser because the site URL is server-side state, and a migrated
// row has none — which the empty string carries without the client having to
// know why.
type issueDTO struct {
	Key     string `json:"key"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
	URL     string `json:"url"`
}

// instanceIssuesDTO groups one instance's issues, or the reason it has none.
// Error is nil on success; Issues is never nil, so the view can iterate it
// without a null check.
type instanceIssuesDTO struct {
	ID     int64      `json:"id"`
	Name   string     `json:"name"`
	Issues []issueDTO `json:"issues"`
	Error  *errorBody `json:"error"`
}

type issuesResponseDTO struct {
	Instances []instanceIssuesDTO `json:"instances"`
}

// handleListIssues answers with every configured instance's assigned issues,
// fetched concurrently. It returns 200 whenever the instance list itself could be
// read: one unreachable Jira site is data about that instance, not a failure of
// this request.
func (s *Server) handleListIssues(w http.ResponseWriter, r *http.Request) {
	instances, err := s.db.Instances(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not read the stored instances")
		return
	}

	// fanOutInstances is why every goroutine returns nil rather than an error:
	// see its comment for the reasoning.
	groups := fanOutInstances(r.Context(), instances, issueFetchTimeout, s.issuesForInstance)

	writeJSON(w, http.StatusOK, issuesResponseDTO{Instances: groups})
}

// issuesForInstance fetches one instance's assigned issues. It never returns an
// error: a per-instance failure is part of the response, and returning one would
// cancel every sibling through the errgroup's context.
func (s *Server) issuesForInstance(ctx context.Context, inst store.Instance) instanceIssuesDTO {
	group := instanceIssuesDTO{ID: inst.ID, Name: inst.Name, Issues: []issueDTO{}}

	client, err := s.clients.forInstance(ctx, &inst)
	if err != nil {
		group.Error = instanceErrorBody(err)
		return group
	}

	issues, err := client.SearchAssigned(ctx)
	if err != nil {
		group.Error = instanceErrorBody(err)
		return group
	}

	for _, issue := range issues {
		group.Issues = append(group.Issues, issueDTO{
			Key:     issue.Key,
			Summary: issue.Summary,
			Status:  issue.Status,
			URL:     browseURL(inst.SiteURL, issue.Key),
		})
	}

	return group
}

// instanceErrorBody is the mapping the top-level writer uses, as a body to embed
// in a response that is otherwise a success. The status is dropped deliberately:
// the enclosing response is a 200.
func instanceErrorBody(err error) *errorBody {
	_, code, message := instanceErrorFor(err)

	return &errorBody{Code: code, Message: message}
}

// browseURL is the human-facing link to an issue. An instance migrated from a
// gateway URL has no site to link to, and the empty string is how the view learns
// to render the key as plain text instead of a dead anchor.
func browseURL(siteURL, key string) string {
	if siteURL == "" {
		return ""
	}

	return strings.TrimSuffix(siteURL, "/") + "/browse/" + key
}
