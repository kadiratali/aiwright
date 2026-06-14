Feature: Add products to the shopping cart

  As a logged-in customer
  I want to add products to my shopping cart
  So that I can purchase them later

  Background:
    Given the user is on the login page
    When the user logs in as the "standard" user
    Then the products page should be displayed

  @smoke
  Scenario: Add a single product to the cart updates the badge
    When the user adds the "Sauce Labs Backpack" product to the cart
    Then the cart badge should show "1"
    And the "Sauce Labs Backpack" product should show a "Remove" button

  Scenario: Add multiple different products increases the badge count
    When the user adds the "Sauce Labs Backpack" product to the cart
    And the user adds the "Sauce Labs Bike Light" product to the cart
    And the user adds the "Sauce Labs Bolt T-Shirt" product to the cart
    Then the cart badge should show "3"
    And the "Sauce Labs Backpack" product should show a "Remove" button
    And the "Sauce Labs Bike Light" product should show a "Remove" button
    And the "Sauce Labs Bolt T-Shirt" product should show a "Remove" button

  Scenario: Removing a product decreases the badge count
    When the user adds the "Sauce Labs Backpack" product to the cart
    And the user adds the "Sauce Labs Bike Light" product to the cart
    Then the cart badge should show "2"
    When the user removes the "Sauce Labs Bike Light" product from the cart
    Then the cart badge should show "1"
    And the "Sauce Labs Bike Light" product should show an "Add to cart" button

  @negative
  Scenario: Removing the last product hides the cart badge
    When the user adds the "Sauce Labs Backpack" product to the cart
    Then the cart badge should show "1"
    When the user removes the "Sauce Labs Backpack" product from the cart
    Then the cart badge should not be visible
    And the "Sauce Labs Backpack" product should show an "Add to cart" button
