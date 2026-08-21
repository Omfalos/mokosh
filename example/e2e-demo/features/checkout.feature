Feature: Checkout cart total
  As a shopper
  I want the cart total to reflect item prices and quantities
  So that I am charged the correct amount

  @pricing
  Scenario: Total reflects multiple items
    Given an empty cart
    When I add item "sku-1" priced at 12.50 with quantity 3
    Then the cart total should be 37.50

  @pricing @refund
  Scenario: Removing an item updates the total
    Given a cart containing item "sku-1" priced at 10.00 with quantity 1
    When I remove item "sku-1"
    Then the cart total should be 0.00
