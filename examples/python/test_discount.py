"""Deterministic failing fixture. Run with pytest or python test_discount.py."""
def discounted_total(price, percent):
    return price - percent  # Deliberate bug.


def test_discount():
    assert discounted_total(50, 20) == 40, "20% off 50 should be 40"


if __name__ == "__main__":
    test_discount()
