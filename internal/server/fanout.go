package server

import (
	"context"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/dgerrese/work-dashboard/internal/store"
)

// fanOutInstances runs work against every instance concurrently and returns one
// result per instance, in the order given.
//
// errgroup is here for Wait and its context, not for error propagation: work
// returns a value rather than an error precisely so that one instance failing
// cannot cancel the others. That is the property three endpoints depend on —
// assigned issues, the pin refresh and the issue search — and the reason this
// helper exists instead of a third copy.
//
// Each call is bounded by its own timeout, so one stalled site holds nothing
// but its own slot.
func fanOutInstances[T any](
	ctx context.Context,
	instances []store.Instance,
	timeout time.Duration,
	work func(context.Context, store.Instance) T,
) []T {
	// Preallocated and written by index, so the result order is the caller's
	// order without a mutex and without sorting afterwards.
	results := make([]T, len(instances))

	group, ctx := errgroup.WithContext(ctx)
	for i, inst := range instances {
		group.Go(func() error {
			callCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()

			results[i] = work(callCtx, inst)

			return nil
		})
	}
	_ = group.Wait()

	return results
}

// instancePositions indexes instances by their 0-based position in this
// slice — store.Instances' created_at order, which is what instanceHue.ts in
// the browser keys its per-instance hue off of. Handlers join it into their
// DTOs from here rather than have the browser fetch /api/instances to resolve
// an id, which would be a round trip to answer a question the server already
// had in hand.
func instancePositions(instances []store.Instance) map[int64]int {
	positions := make(map[int64]int, len(instances))
	for i, inst := range instances {
		positions[inst.ID] = i
	}

	return positions
}
