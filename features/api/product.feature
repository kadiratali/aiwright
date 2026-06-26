@api
Feature: Fetch a product by ID

  Background:
    Given the API is up

  Scenario: Fetch a known product by ID returns full product details
    When the product with id "p1" is fetched
    Then the response status is 200
    And the product id field equals "p1"
    And the product has name, price and slug fields
    And the price is greater than zero

  Scenario: Fetch an unknown product ID returns 404 with an error
    When the product with id "unknown-xyz" is fetched
    Then the response status is 404
    And the response body contains an error message
    And no product data is returned
