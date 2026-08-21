/** Step definitions for features/checkout.feature.
 *
 * This is the piece a plain .feature file can never have on its own: real
 * imports of application code. Because this file `import`s ../src/cart, it
 * gets a real edge in mokosh's dependency graph — which is what lets
 * mokosh's incoming-edge traversal (propose_tags / propose_affected_tests)
 * reach a Gherkin-driven test at all. The .feature file itself still has zero
 * imports; it's this file that closes the gap.
 */
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { addItem, type CartItem, removeItem, total } from "../src/cart";

interface CheckoutWorld {
  cart: CartItem[];
}

Given("an empty cart", function (this: CheckoutWorld) {
  this.cart = [];
});

Given(
  "a cart containing item {string} priced at {float} with quantity {int}",
  function (this: CheckoutWorld, id: string, price: number, qty: number) {
    this.cart = addItem([], { id, price, qty });
  },
);

When(
  "I add item {string} priced at {float} with quantity {int}",
  function (this: CheckoutWorld, id: string, price: number, qty: number) {
    this.cart = addItem(this.cart ?? [], { id, price, qty });
  },
);

When("I remove item {string}", function (this: CheckoutWorld, id: string) {
  this.cart = removeItem(this.cart ?? [], id);
});

Then("the cart total should be {float}", function (this: CheckoutWorld, expected: number) {
  assert.equal(total(this.cart ?? []), expected);
});
