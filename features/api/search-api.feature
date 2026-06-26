@api
Feature: Product search API

  Background:
    Given the API is up

  Scenario: A known term returns results
    When a search for "telefon" is performed
    Then the response status is 200
    And the response contains at least 1 results
    And each result has id, name and price fields
    And at least one result mentions "telefon"

  Scenario: A non-matching term returns no results
    When a search for "xyzqwerty" is performed
    Then the response status is 200
    And the response contains no results
