@smoke
Feature: Toolshop Login
  As a registered customer
  I want to log in to the Toolshop
  So that I can access my account

  Background:
    Given the user is on the login page

  Scenario: Successful login with valid credentials
    When the user logs in as the "customer" user
    Then the account menu should be displayed

  @negative
  Scenario: Login fails with a wrong password
    When the user logs in with email "customer@practicesoftwaretesting.com" and password "wrongpass"
    Then a login error should be displayed
