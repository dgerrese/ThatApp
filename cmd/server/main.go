package main

import (
	"log"

	_ "time/tzdata" // embed the zoneinfo database; the scratch image has none
)

func main() {
	log.Println("work-dashboard: starting")
}
