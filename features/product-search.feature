@search
Feature: Product search on Getmobil
  As a visitor to Getmobil
  I want to search for a product by its name
  So that I can quickly find the device I am looking for

  Background:
    Given the visitor is on the Getmobil home page

  @smoke @search
  Scenario: Successful search for a known product returns a relevant results page
    Given the header search box is visible and empty
    When the visitor types "iPhone 13" into the header search box
    And the visitor submits the search
    Then the page URL contains the search query parameter for "iPhone 13"
    And at least one product card is displayed in the results
    And a product card mentioning "iPhone 13" is visible in the results
    And the results page reflects the search term "iPhone 13"
    And no empty-state message is shown

  @smoke @search @i18n
  Scenario: Search with Turkish locale characters returns correct results
    Given the header search box is visible and empty
    When the visitor types "kılıf" into the header search box
    And the visitor submits the search
    Then the page URL correctly encodes the Turkish characters for "kılıf"
    And the results page loads without a server error
    And at least one product card is displayed in the results
    And the results page reflects the search term "kılıf"
    And no empty-state message is shown
