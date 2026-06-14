# aiwright — AI QA Agent

TypeScript + **playwright-bdd** (Gherkin → Playwright Test runner) tabanlı, Claude destekli BDD test otomasyon framework'ü.

```
User Story ──▶ AI Test Generator ──▶ .feature + steps + page objects
                                          │
                                          ▼
                         bddgen ──▶ Playwright Test runner
                   (fixtures, paralel koşum, trace, screenshot)
                                          │
                                          ▼
              HTML/JSON rapor ──▶ AI Failure Analyzer ──▶ ai-analysis.md
```

## Kurulum

```bash
npm install
npx playwright install chromium
cp .env.example .env   # ANTHROPIC_API_KEY degerini doldurun
```

## Kullanım

### Testleri çalıştır

```bash
npm test                  # tum senaryolar (paralel)
npm run test:smoke        # sadece @smoke etiketliler
npm run test:ui           # Playwright UI modunda
HEADLESS=false npm test   # tarayiciyi gorerek
npm run report            # Playwright HTML raporunu ac
```

Raporlar `reports/` altına yazılır: Playwright HTML raporu, Cucumber HTML/JSON raporu. Başarısız senaryolarda screenshot ve trace otomatik toplanır (`reports/test-results/`).

### AI ile test üret

User story'den feature dosyası, step definition ve gereken page object'leri üretir:

```bash
npm run ai:generate -- stories/checkout.txt
# veya dogrudan metin:
npm run ai:generate -- "As a user I want to add products to the cart so that..."
```

Mevcut bir dosyanın üzerine asla yazmaz — çakışma olursa `.generated` uzantısıyla yan dosya oluşturur. Yeni page object üretildiyse fixture kayıt snippet'i çıktıdaki notlarda verilir.

### AI ile hata analizi

Test koşumundan sonra başarısız senaryoları analiz eder, her birini `app-bug | test-bug | flaky | environment` olarak sınıflandırır ve çözüm önerir:

```bash
npm test
npm run ai:analyze
```

Detaylı rapor: `reports/ai-analysis.md`

## Proje Yapısı

```
playwright.config.ts   defineBddConfig + reporter + use ayarlari
features/              Gherkin feature dosyalari
fixtures/              Test verisi (users.json, ...)
src/
  fixtures/            Playwright fixture'lari (page objects) + veri yardimcilari
    index.ts           test = base.extend({ loginPage, productsPage, ... })
    data.ts            loadFixture / getUser
  steps/               Step definition'lar (createBdd ile fixture-tabanli)
  pages/               Page Object Model (BasePage'den turer)
  ai/                  Claude entegrasyonu (uretici + analizci + promptlar)
  cli/                 ai:generate / ai:analyze komutlari
.features-gen/         bddgen'in urettigi spec'ler (git'e girmez)
```

## Hassas Veri Güvenliği (PII)

TCKN, kredi kartı, IBAN gibi hassas veriler **hiçbir zaman LLM'e gitmez** ve bu dosyalar LLM tarafından okunamaz. Üç katmanlı koruma:

1. **İzolasyon** — Gerçek PII `fixtures/sensitive/` altında durur, `.gitignore` ile repoya girmez (yalnızca `*.example.json` şablonları commit'lenir).
2. **Read-deny** — `.claude/settings.json` içindeki `permissions.deny`, Claude Code'un (kod ajanının) `fixtures/sensitive/**` ve `.env` dosyalarını okumasını engeller. *(Kural yeni oturumda etkinleşir.)*
3. **Maskeleme** — `ai:generate` ve `ai:analyze`, Claude API'ye veri yollamadan önce `src/ai/redact.ts` ile maskeler:
   - **Desen tabanlı**: TCKN (11 hane), kart, IBAN, e-posta, telefon
   - **Değer tabanlı (denylist)**: `loadSensitive()` ile okunan / `fixtures/sensitive/` altındaki tüm gerçek değerler, formata uymasa bile (isim, gizli kod vb.) birebir maskelenir

Maskelemenin regresyon kontrolü: `npm run verify:redaction`. Detaylı politika: `fixtures/sensitive/README.md`.

### Konvansiyonlar

- **Step'ler fixture kullanır**: `async ({ loginPage }, param) => ...` — `new LoginPage(page)` yazılmaz.
- **Test verisi fixtures/*.json'da**: step içinde hardcoded kimlik bilgisi yok; `getUser('standard')`.
- **Selector önceliği**: `data-test`/`data-testid` > id > role. Kırılgan CSS zincirleri yasak.
- **Senaryolar bağımsız**: ortak kurulum `Background`'a, senaryolar arası state paylaşımı yok.

## Yol Haritası (mimari diyagramına göre)

- [x] playwright-bdd çekirdeği (fixtures, POM, paralel koşum, raporlama)
- [x] LLM katmanı: user story → test üretimi (Claude API, structured outputs)
- [x] LLM katmanı: hata/risk analizi
- [ ] Jira entegrasyonu (user story çekme, sonuçları issue'ya yazma)
- [ ] MCP server (araçlara güvenli erişim katmanı)
- [x] CI/CD entegrasyonu (GitHub Actions: test + AI analiz + artifact)
- [ ] TestRail / Slack bildirimleri
