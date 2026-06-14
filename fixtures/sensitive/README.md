# Hassas Test Verisi (PII)

Bu dizin TCKN, kredi kartı, IBAN, telefon gibi **hassas/gizli** test verisi içindir.

## Kurallar

1. **Repoya girmez.** `.gitignore` bu dizindeki `*.json` dosyalarını yok sayar; yalnızca `*.example.json` ve bu `README.md` commit'lenir. Gerçek dosyanız (`customers.json` vb.) yalnızca yerel makinede / güvenli secret yönetiminde durur.
2. **LLM okuyamaz.** `.claude/settings.json` içindeki `permissions.deny` kuralı Claude Code'un (kod ajanının) bu dizini `Read` etmesini engeller.
3. **LLM'e gönderilmez.** Uygulama bu verileri yalnızca `loadSensitive()` ile okur. Okunan tüm değerler otomatik olarak maskeleme denylist'ine eklenir; `ai:generate` ve `ai:analyze` LLM'e veri yollamadan önce hem desen tabanlı (TCKN/kart/IBAN/e-posta/telefon) hem değer tabanlı maskeleme uygular (`src/ai/redact.ts`).

## Kullanım

```ts
import { loadSensitive } from '../fixtures/data';

const customers = loadSensitive<Record<string, Customer>>('customers');
// fixtures/sensitive/customers.json okunur ve degerleri denylist'e eklenir
```

Yeni bir hassas set eklerken `customers.example.json` gibi bir şablon (sahte değerlerle) commit'leyin; gerçek dosyayı commit'lemeyin.
