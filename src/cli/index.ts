import * as fs from 'fs';
import * as path from 'path';
import { generateTests, writeArtifacts } from '../ai/testGenerator';
import { extractFailures, analyzeFailures, writeAnalysisReport } from '../ai/failureAnalyzer';

const USAGE = `
AI QA Agent CLI

Kullanim:
  npm run ai:generate -- <user-story.txt | "user story metni">
      User story'den feature + step definition + page object uretir.

  npm run ai:analyze [-- <rapor-yolu>]
      Cucumber JSON raporundaki hatalari analiz eder.
      Varsayilan rapor: reports/cucumber-report.json
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'generate': {
      const input = rest.join(' ').trim();
      if (!input) {
        console.error('Hata: user story dosyasi veya metni verin.\n' + USAGE);
        process.exit(1);
      }
      const story = fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : input;

      console.log('User story isleniyor, test artifactlari uretiliyor...');
      const artifacts = await generateTests(story);
      const written = writeArtifacts(artifacts);

      console.log('\nOlusturulan dosyalar:');
      for (const f of written) console.log(`  - ${f}`);
      console.log(`\nNotlar:\n${artifacts.notes}`);
      console.log('\nCalistirmak icin: npm test');
      break;
    }

    case 'analyze': {
      const reportPath = rest[0] ?? path.join('reports', 'cucumber-report.json');
      if (!fs.existsSync(reportPath)) {
        console.error(`Hata: rapor bulunamadi: ${reportPath}. Once "npm test" calistirin.`);
        process.exit(1);
      }

      const failures = extractFailures(reportPath);
      if (failures.length === 0) {
        console.log('Basarisiz senaryo yok - analiz gerekmiyor. ✅');
        return;
      }

      console.log(`${failures.length} basarisiz senaryo analiz ediliyor...`);
      const result = await analyzeFailures(failures);
      const reportFile = writeAnalysisReport(result);

      console.log(`\nOzet: ${result.summary}\n`);
      for (const a of result.analyses) {
        console.log(`  [${a.category}] ${a.scenario}`);
        console.log(`     Neden : ${a.rootCause}`);
        console.log(`     Cozum : ${a.suggestedFix}\n`);
      }
      console.log(`Detayli rapor: ${reportFile}`);
      break;
    }

    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  console.error('Hata:', err.message ?? err);
  process.exit(1);
});
