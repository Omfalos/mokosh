import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from discount import apply_discount  # noqa: E402


def test_applies_percentage_discount():
    assert apply_discount(100.0, 25) == 75.0


def test_rejects_out_of_range_percent():
    try:
        apply_discount(100.0, 150)
    except ValueError:
        return
    raise AssertionError("expected ValueError")
