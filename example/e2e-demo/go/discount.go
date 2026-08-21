// Package e2edemo mirrors the pytest discount module for the Go track — its
// own small module, independent of the TS cart module (no cross-language imports).
package e2edemo

import (
	"errors"
	"math"
)

// ApplyDiscount applies a percentage discount to a total, rounded to 2 decimal places.
func ApplyDiscount(total float64, percent float64) (float64, error) {
	if percent < 0 || percent > 100 {
		return 0, errors.New("percent must be between 0 and 100")
	}
	discounted := total * (1 - percent/100)
	return math.Round(discounted*100) / 100, nil
}
