# aiwright → QA Test Automation Agent — Tasarım Planı

> Durum: **TASLAK / sadece plan.** Kod yok. Mevcut modülleri (`design`, `inspect`,
> `generate`, `verify`, `analyze`) tek bir orkestratör döngüsüne sarmanın planı.
> İlke korunur: **otonom yürütme, ama yargı kapıları insanda** ("amplify, not replace").

---

## 1. Hedef

Bugün kullanıcı 5 ayrı komutu elle, sırayla tetikliyor (pipeline / copilot). Hedef:
kullanıcı **bir hedef** verir ("checkout akışını test et"), agent gerisini **kendi
planlar, araçlarını seçer, kırılınca onarır**, sadece kritik kararlarda insana sorar.

```
ÖNCE (pipeline):  insan → design → insan → inspect → generate → test → analyze → insan
SONRA (agent):    insan → "hedef" → [ plan · araç-seç · çalıştır · gözlemle · onar ]* → paket
                                            ↑ kritik kararda insana sorar (policy)
```

## 2. Şu anki mekanizma (emsal)

`src/cli/index.ts` bir `switch (command)`. Her dal bir AI modülünü çağırıp dosya yazıyor.
**Tek istisna:** `generate --fix --run` zaten mini bir agent döngüsü:

```
generateTests → verifyTypeScript (tsc) → hata varsa correctArtifacts → tekrar tsc  (≤2 tur)
                                       → temizse runFeature
```

Bu döngünün genel hali bütün pipeline'a taşınacak. Yani sıfırdan icat yok; **var olan
self-correct desenini orchestrator seviyesine yükseltmek.**

## 3. Hedef mimari

```
src/agent/
  orchestrator.ts   — plan → act → observe döngüsü (Anthropic tool-use loop)
  tools.ts          — mevcut AI modüllerini "tool" şemasına saran tanımlar
  state.ts          — run boyunca hafıza (RunState)
  policy.ts         — guardrail'lar: hangi adım otomatik, hangisi insana sorar
  prompts.ts        — agent system prompt'u ("sen bir QA agent'ısın, araçların...")
src/cli/index.ts    — yeni `agent` komutu eklenir; eski komutlar AYNEN kalır (geri uyum)
```

**Önemli:** mevcut `ai/*` modülleri **değişmez**. Hepsi saf fonksiyon (girdi → çıktı +
dosya). Agent katmanı onların *üstüne* gelir; tek tek hâlâ CLI'dan çağrılabilir.

## 4. Agent döngüsü (somut)

Anthropic SDK tool-use döngüsü. Çekirdek:

1. **Plan** — Claude'a hedef + mevcut `RunState` + tool şemaları verilir.
2. **Act** — Claude bir `tool_use` döndürür (ör. `design`, sonra `inspect`).
3. **Observe** — orchestrator tool'u çalıştırır, sonucu (özet + dosya yolu) state'e yazar
   ve `tool_result` olarak geri besler.
4. `end_turn` (hedef tamam) veya bir **policy kapısı** insana soru sorana kadar 2→3 döner.

Pseudo-akış (kod değil, niyet):

```
state = newRunState(goal)
messages = [system, userGoal]
while true:
  resp = claude.messages(tools, messages, state.summary())
  if resp.stop == "end_turn": break
  for call in resp.tool_use:
    gate = policy.check(call, state)
    if gate == ASK_HUMAN: pause → insana sun → onay/iptal → state'e yaz
    result = tools[call.name](call.input)      # mevcut ai/* modülü
    state.record(call, result)
    messages += tool_result(result.summary)
```

## 5. Tool kataloğu (mevcut modüllerin eşlemesi)

| Tool | Sarar | Girdi | Çıktı (state'e) | Risk |
|---|---|---|---|---|
| `design` | `designTests` + `writeDesignReport` | story | `test-design-*.md` yolu, sayımlar | düşük |
| `inspect` | `inspectPage` + `writeSelectorMap` | url/path, `--login` | `selector-map-*.json`, uyarılar | düşük |
| `generate` | `generateTests`/`correctArtifacts` + `writeArtifacts` | story, design, selectors | yazılan dosyalar | **orta** |
| `verify` | `verifyTypeScript` | dosya kapsamı | ok? + tsc hataları | düşük (salt-okuma) |
| `run` | `runFeature` | feature başlığı | passed/failed | orta (tarayıcı açar) |
| `analyze` | `extractFailures` + `analyzeFailures` | rapor yolu | kök neden + öneri | düşük |

Tool şemaları zaten eldeki `interface`'lerden türetilebilir (`TestDesign`, `SelectorMap`,
`GeneratedArtifacts`, `VerifyResult`, `RunResult`, `FailureAnalysis`).

## 6. RunState (yeni — hafıza)

Pipeline'da yok olan parça. Tek bir run boyunca tutulur (JSON olarak
`reports/agent-run-<slug>.json`):

- `goal`, `story`
- `designPath`, `approvedScenarios[]` — insan onayından sonra
- `selectorMapPath`, `verifiedSelectors[]`
- `artifacts[]` — yazılan dosyalar
- `attempts[]` — her generate/verify/run turunun sonucu (flaky tespiti için geçmiş)
- `failures[]` — analyze çıktısı, kategorize (regression | selector-drift | timing | ...)
- `openDecisions[]` — insana bekleyen kapılar

Bu state sayesinde agent: "selector zaten doğrulandı, tekrar inspect etme",
"bu senaryo 2. kez timing'den düştü → flaky, regression değil" gibi **çıkarımlar** yapar.

## 7. Policy — insan onay kapıları (felsefenin kalbi)

Otonomluğu riske göre kademelendiririz. `policy.ts` her tool çağrısını sınıflar:

| Karar | Davranış | Neden |
|---|---|---|
| design çıktısını "kapsam" kabul etmek | **İNSANA SOR** | "what to test" yargısı insanda kalır |
| selector haritasını kullanmak | OTOMATİK | düşük risk, doğrulanmış DOM |
| kod üretmek / selector drift'i onarmak | OTOMATİK | tsc + run ile zaten doğrulanır |
| flaky senaryoyu yeniden denemek (≤N) | OTOMATİK | zamanlama gürültüsü |
| bir senaryoyu "geçti" ilan etmek | OTOMATİK ama raporla | tsc+yeşil kanıt var |
| **gerçek regresyonu kapatmak / yoksaymak** | **İNSANA SOR** | yüksek risk, üründe bug olabilir |
| story ↔ app çelişkisi (app o davranışı yapmıyor) | **İNSANA SOR** | README: "passing test for behaviour your app does not have" yasağı |

Böylece agent otonom **yürütür**, ama README'deki üç sınırı (review'suz ship etmez, olmayan
davranışa yeşil uydurmaz, yeşili insan sahiplenir) policy seviyesinde **zorunlu** kılar.

## 8. Self-healing döngüsü (en değerli kazanım)

`analyze` artık çıkmaz sokak değil — kök nedene göre **geri besler**:

```
run → kırmızı → analyze → kategori?
   ├─ selector-drift  → inspect (sadece kırılan sayfa) → generate (sadece o selector) → run
   ├─ timing/flaky    → run (retry ≤N, state'te say)
   ├─ test-bug        → generate (düzeltme) → verify → run
   └─ gerçek regression → DUR, insana bildir  (policy: ASK_HUMAN)
```

Mevcut `generate --fix`'in tsc döngüsünün, **runtime hatalarına** genişlemiş hali.

## 9. Dosya bazında değişim (niyet — kod yok)

- **YENİ** `src/agent/{orchestrator,tools,state,policy,prompts}.ts`
- **DEĞİŞİR** `src/cli/index.ts`: `case 'agent':` eklenir → orchestrator'ı başlatır.
  Diğer `case`'ler **dokunulmaz** (geri uyum + tek tek araç olarak hâlâ erişilebilir).
- **DEĞİŞİR** `package.json`: `"ai:agent": "ts-node src/cli/index.ts agent"` script'i.
- **DEĞİŞMEZ** tüm `src/ai/*` (saf fonksiyonlar, tool olarak sarılır).
- **OPSİYONEL** `src/web/server.ts`: agent run'ını + onay kapılarını UI'da göstermek
  (insan onayı için doğal yer; faz 3).

## 10. Fazlama

- **Faz 1 — Orchestrator iskeleti.** Tool sarmalayıcılar + döngü + RunState. Policy hep
  "ASK_HUMAN" (yani agent her adımı önerir, insan onaylar). En güvenli başlangıç.
- **Faz 2 — Self-healing.** `analyze → inspect/generate → run` geri beslemesi + flaky
  retry. Düşük riskli kapılar otomatiğe alınır.
- **Faz 3 — Web onay UI'ı.** Onay kapıları `web/server.ts` üzerinden; CI'da headless
  "öneri raporu" modu.

## 11. Riskler / açık sorular

- **Maliyet/döngü patlaması** — orchestrator turlarına üst sınır + bütçe (mevcut `MAX_ROUNDS=2`
  deseni gibi). Sonsuz onar-kır döngüsü engeli.
- **Felsefe gerginliği** — "otonom agent" ↔ "insan döngüde". Çözüm policy kapıları; ama
  varsayılan otonomluk seviyesi netleşmeli (öneri: Faz 1'de düşük, güvendikçe artır).
- **Flaky ↔ regression ayrımı** — yanlış sınıflama gerçek bug'ı gizleyebilir. Çözüm:
  şüpheli durumda her zaman ASK_HUMAN'a düş (güvenli taraf).
- **CI'da insan yok** — CI modunda kapılar "onay" yerine "rapor + non-blocking" olmalı.

---

### Özet
Yeni motor değil, **var olan parçaların üstüne bir orkestrasyon + hafıza + policy katmanı**.
Mevcut `generate --fix` döngüsü konseptin kanıtı; agent onu tüm pipeline'a ve runtime
hatalarına genişletir. Felsefe `policy.ts` ile korunur: otonom yürütme, kritik yargı insanda.
