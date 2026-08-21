package e2edemo

import "testing"

func TestApplyDiscount(t *testing.T) {
	got, err := ApplyDiscount(100.0, 25)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 75.0 {
		t.Fatalf("expected 75.0, got %v", got)
	}
}

func TestApplyDiscountRejectsOutOfRangePercent(t *testing.T) {
	if _, err := ApplyDiscount(100.0, 150); err == nil {
		t.Fatal("expected error for out-of-range percent")
	}
}
