// Command server runs the thatapp HTTP server.
package main

import (
	"log"
	"net/http"
	"os"

	_ "time/tzdata" // embed the zoneinfo database; the scratch image has none

	"codeberg.org/DionGerrese/ThatApp/internal/config"
	"codeberg.org/DionGerrese/ThatApp/internal/crypto"
	"codeberg.org/DionGerrese/ThatApp/internal/server"
	"codeberg.org/DionGerrese/ThatApp/internal/store"
	"codeberg.org/DionGerrese/ThatApp/web"
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatalf("configuration: %v", err)
	}

	sealer, err := crypto.NewSealer(cfg.Secret)
	if err != nil {
		log.Fatalf("sealer: %v", err)
	}

	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer func() { _ = db.Close() }()

	srv := server.New(cfg, web.Assets(), db, sealer)

	log.Printf("thatapp listening on %s (%s)", cfg.Addr, cfg.Location)
	if err := http.ListenAndServe(cfg.Addr, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
}
