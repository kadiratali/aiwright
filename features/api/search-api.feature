@api
Feature: Ürün arama API'si

  Background:
    Given arama servisi ayakta

  Scenario: Bilinen bir terim sonuç döndürür
    When "telefon" araması yapılır
    Then HTTP 200 döner
    And en az 1 ürün listelenir
    And her ürün id, name ve price alanlarını içerir
    And sonuçlardan en az biri "telefon" terimini içerir

  Scenario: Eşleşmeyen terim boş sonuç döndürür
    When "xyzqwerty" araması yapılır
    Then HTTP 200 döner
    And hiç ürün listelenmez
