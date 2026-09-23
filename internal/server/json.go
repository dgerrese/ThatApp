package server

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

// errorBody is the shape every API failure takes. The code is stable and
// machine-readable; the message is for a person.
type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// writeJSON encodes payload as the response body.
//
// The header is written before encoding, so an encoding failure cannot change
// the status the client already has. It is logged rather than returned: the
// response is committed by then, and a half-written body is all the caller can
// observe either way.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encoding %d response: %v", status, err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Code: code, Message: message})
}

// idFromPath reads the {id} wildcard. Anything but a positive integer names no
// resource, so it is answered exactly as a missing row is: 404 not_found.
func idFromPath(w http.ResponseWriter, r *http.Request, message string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", message)
		return 0, false
	}

	return id, true
}
