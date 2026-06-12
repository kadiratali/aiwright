@smoke
Feature: SauceDemo Login
  As a registered user
  I want to log in to the application
  So that I can access the product catalog

  Background:
    Given the user is on the login page

  Scenario: Successful login with valid credentials
    When the user logs in as the "standard" user
    Then the products page should be displayed

  Scenario: Login fails with locked out user
    When the user logs in as the "locked_out" user
    Then an error message containing "locked out" should be displayed

  @negative
  Scenario: Login fails with wrong password
    When the user logs in with username "standard_user" and password "wrong_password"
    Then an error message containing "do not match" should be displayed
