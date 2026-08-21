"""Discount calculation logic — the pytest track's own small module,
independent of the TS cart module (no cross-language imports)."""


def apply_discount(total: float, percent: float) -> float:
    """Applies a percentage discount to a total.

    Args:
        total: The pre-discount amount.
        percent: The discount percentage (0-100).

    Returns:
        The discounted amount, rounded to 2 decimal places.
    """
    if not 0 <= percent <= 100:
        raise ValueError("percent must be between 0 and 100")
    return round(total * (1 - percent / 100), 2)
