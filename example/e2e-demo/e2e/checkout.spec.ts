import { expect, test } from "@playwright/test";
import { addItem, removeItem, total } from "../src/cart";

// Deliberately doesn't request the `page` fixture — no browser install needed
// to run this in CI. What matters for the demo is that this spec file *imports*
// ../src/cart, which is what makes it reachable by mokosh's incoming-edge
// traversal when src/cart.ts changes.
test.describe("checkout", () => {
  test("cart total reflects price and quantity", () => {
    const cart = addItem([], { id: "sku-1", price: 12.5, qty: 3 });
    expect(total(cart)).toBe(37.5);
  });

  test("removing the last item empties the cart total", () => {
    const cart = addItem([], { id: "sku-1", price: 10, qty: 1 });
    expect(total(removeItem(cart, "sku-1"))).toBe(0);
  });
});
