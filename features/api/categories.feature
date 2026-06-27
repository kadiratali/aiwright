@api
Feature: List product categories
  As an API consumer I can list the product categories so that
  I can browse products by category.

  Background:
    Given the API is up

  Scenario: Happy path – categories list is returned with valid shape
    When the categories list is fetched
    Then the response status is 200
    And the response body contains a categories array
    And every category has slug, name and count fields
    And every category count is a positive integer
    And the total equals the number of categories returned

  Scenario: Categories endpoint returns no unexpected error fields
    When the categories list is fetched
    Then the response status is 200
    And the response body contains a categories array
    And every category has slug, name and count fields
    And the categories array is not empty
