/** Shared cart/pricing logic — the one module every example test track depends on.
 *  Changing this file is the trigger the demo is built around: a real dependency
 *  change here should be picked up as affecting the vitest unit test, the
 *  Playwright spec, AND the Gherkin scenario, because all three import it. */

export interface CartItem {
  id: string;
  price: number;
  qty: number;
}

/**
 * @description Returns a new cart with `item` appended.
 * @param {CartItem[]} cart - The current cart contents.
 * @param {CartItem} item - The item to add.
 * @returns {CartItem[]} A new cart array including `item`.
 */
export function addItem(cart: CartItem[], item: CartItem): CartItem[] {
  return [...cart, item];
}

/**
 * @description Returns a new cart with the item matching `id` removed.
 * @param {CartItem[]} cart - The current cart contents.
 * @param {string} id - The item id to remove.
 * @returns {CartItem[]} A new cart array excluding the matching item.
 */
export function removeItem(cart: CartItem[], id: string): CartItem[] {
  return cart.filter((item) => item.id !== id);
}

/**
 * @description Computes the total price of a cart.
 * @param {CartItem[]} cart - The cart contents.
 * @returns {number} The sum of `price * qty` across all items.
 */
export function total(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}
