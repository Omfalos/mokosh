import { describe, expect, it } from "vitest";
import { addItem, removeItem, total } from "../src/cart";

describe("cart", () => {
  it("adds items and computes the total", () => {
    let cart = addItem([], { id: "sku-1", price: 10, qty: 2 });
    cart = addItem(cart, { id: "sku-2", price: 5, qty: 1 });
    expect(total(cart)).toBe(25);
  });

  it("removes an item", () => {
    const cart = addItem([], { id: "sku-1", price: 10, qty: 1 });
    expect(removeItem(cart, "sku-1")).toHaveLength(0);
  });
});
