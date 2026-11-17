import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';

// Modern Web Guidance `legacy-scan`으로 `src/`의 옛 웹 패턴을 찾고, 검토를 마친 목록(`legacy-scan-baseline.json`)에
// 없는 새 후보가 있으면 실패한다. `build:ci`에서 돌므로 GitHub CI와 Cloudflare Pages 배포가 모두 막힌다.
// 결과는 후보일 뿐이라 0건을 목표로 하지 않는다. 새 후보가 나오면 규칙의 keepWhen/dropWhen으로 확인해
// 고치거나, 고치지 않을 이유를 적어 목록에 더한다(CLAUDE.md 「웹 플랫폼 가이드」).

const BASELINE = 'legacy-scan-baseline.json';

/** 줄 번호는 위아래 코드가 바뀌면 움직이므로, 규칙·파일·줄 내용으로 같은 후보를 알아본다. */
export function findingKey({ rule, file, lineContent }) {
  return `${rule}\t${file}\t${lineContent.trim()}`;
}

/** 스캔 결과(JSON)를 후보 목록으로 편다. */
export function flattenFindings(scan) {
  return scan.guides.flatMap((guide) =>
    guide.rules.flatMap((rule) =>
      rule.findings.map((finding) => ({
        guide: guide.guideId,
        rule: rule.ruleId,
        file: finding.file,
        line: finding.line,
        lineContent: finding.lineContent,
        message: finding.message,
      })),
    ),
  );
}

/** 검토 목록에 없는 후보와, 더는 나오지 않는 검토 항목을 가른다. 같은 키가 여러 번이면 개수로 센다. */
export function compareWithBaseline(findings, baseline) {
  const remaining = new Map();
  for (const entry of baseline) {
    const key = findingKey(entry);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const fresh = [];
  for (const finding of findings) {
    const key = findingKey(finding);
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else fresh.push(finding);
  }
  const gone = baseline.filter((entry) => {
    const key = findingKey(entry);
    const left = remaining.get(key) ?? 0;
    if (left === 0) return false;
    remaining.set(key, left - 1);
    return true;
  });
  return { fresh, gone };
}

function runScan(ROOT) {
  const out = execFileSync(
    process.execPath,
    [
      `${ROOT}node_modules/modern-web-guidance/skills/modern-web-guidance/modern-web.mjs`,
      'legacy-scan',
      'src/',
      '--json',
    ],
    // 검색어·가이드 ID를 Google에 보내지 않는다.
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DISABLE_TELEMETRY: '1' },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return JSON.parse(out);
}

function main() {
  const ROOT = `${join(dirname(fileURLToPath(import.meta.url)), '..')}/`;
  const baseline = JSON.parse(readFileSync(`${ROOT}${BASELINE}`, 'utf8')).reviewed;
  const findings = flattenFindings(runScan(ROOT));
  const { fresh, gone } = compareWithBaseline(findings, baseline);
  for (const entry of gone) {
    console.log(
      `legacy-scan: 검토 목록의 후보가 더는 나오지 않아요(목록에서 빼도 돼요): ${entry.rule} ${entry.file}`,
    );
  }
  if (fresh.length === 0) {
    console.log(`legacy-scan: 새 후보 없음(후보 ${findings.length}건 모두 검토 목록에 있음)`);
    return;
  }
  console.error(`legacy-scan: 검토하지 않은 새 후보 ${fresh.length}건`);
  for (const f of fresh) {
    console.error(`  - [${f.rule}] src/${f.file}:${f.line}  ${f.lineContent.trim()}`);
    console.error(`    ${f.message.split('\n')[0]}`);
  }
  console.error(
    [
      '',
      '각 후보를 규칙의 keepWhen/dropWhen으로 확인하세요:',
      '  DISABLE_TELEMETRY=1 npx modern-web-guidance retrieve <guide>',
      `고칠 것은 고치고, 고치지 않을 것은 이유(reason)를 적어 ${BASELINE}의 reviewed에 더하세요.`,
    ].join('\n'),
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
