// Command server runs the thatapp HTTP server.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	_ "time/tzdata" // embed the zoneinfo database; the scratch image has none

	"github.com/dgerrese/ThatApp/internal/config"
	"github.com/dgerrese/ThatApp/internal/crypto"
	"github.com/dgerrese/ThatApp/internal/server"
	"github.com/dgerrese/ThatApp/internal/store"
	"github.com/dgerrese/ThatApp/internal/update"
	"github.com/dgerrese/ThatApp/web"
)

// Set at release build time; see scripts/release-image.sh.
var version = "dev"

func main() {
	log.Printf("thatapp %s", version)

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatalf("configuration: %v", err)
	}

	cfg.Version = version

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

	if version != "dev" {
		c := update.NewChecker(version, update.LatestReleaseURL, &http.Client{Timeout: 10 * time.Second})
		srv.Updates = c
		go c.Run(context.Background(), 24*time.Hour)
	}

	log.Printf("thatapp listening on %s (%s)", cfg.Addr, cfg.Location)
	if err := http.ListenAndServe(cfg.Addr, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
}
