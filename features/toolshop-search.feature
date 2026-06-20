@smoke
Feature: Toolshop Product Search
  As a shopper
  I want to search the product catalog
  So that I can quickly find the tools I need

  Background:
    Given the user is on the products page

  Scenario: Searching narrows the catalog to relevant products
    When the user searches for "Pliers"
    Then at least one product is shown
    And the results include "Combination Pliers"

  @negative
  Scenario: Searching for an unknown term shows no products
    When the user searches for "zzzznotaproduct"
    Then no products are shown
