Feature: Storefront landing state after login

  As a logged-in customer
  I want the product catalog to load in a clean initial state
  So that I can start shopping without leftover state

  Background:
    Given the user is on the login page
    When the user logs in as the "standard" user

  @smoke
  Scenario: Standard user lands on a clean Products page after login
    Then the products page should be displayed
    And the products page heading should read "Products"
    And the cart badge should not be visible

  @smoke
  Scenario: Cart badge is absent immediately after a fresh login
    Then the cart badge should not be visible

  @smoke
  Scenario: Products heading text is exactly 'Products'
    Then the products page heading should read "Products"
