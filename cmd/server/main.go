package main

import (
	"log"
	"net/http"
	"os"

	_ "time/tzdata" // embed the zoneinfo database; the scratch image has none

	"github.com/dgerrese/work-dashboard/internal/config"
	"github.com/dgerrese/work-dashboard/internal/server"
	"github.com/dgerrese/work-dashboard/web"
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatalf("configuration: %v", err)
	}

	srv := server.New(cfg, web.Assets())

	log.Printf("work-dashboard listening on %s (%s)", cfg.Addr, cfg.Location)
	if err := http.ListenAndServe(cfg.Addr, srv); err != nil {
		log.Fatalf("server: %v", err)
	}
}
