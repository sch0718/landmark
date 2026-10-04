import { dirname, resolve } from 'node:path';
import { ApplyEditError, applyEdit } from '../apply-edit';
import { SourceValidationError } from '../collect';
import { createNodeFs } from '../fs-port';
import { createShellGitPort } from '../git-port';

const [yamlPath, editPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!yamlPath || !editPath) {
  console.error('사용법: yarn apply-edit <trips/파일.yaml> <파일.tripedit.json>');
  process.exit(1);
}

try {
  const { appliedDates } = await applyEdit(yamlPath, editPath, {
    fs: createNodeFs(),
    git: createShellGitPort(dirname(resolve(yamlPath))),
    log: (line) => console.log(line),
  });
  if (appliedDates.length === 0) {
    console.log('반영한 날이 없습니다.');
  } else {
    console.log(`반영한 날: ${appliedDates.join(', ')}`);
    console.log(`이제 \`yarn collect ${yamlPath}\`를 실행하세요`);
  }
} catch (e) {
  if (e instanceof ApplyEditError) {
    console.error(`[${e.code}] ${e.message}`);
    for (const d of e.details) console.error(`  - ${d}`);
  } else if (e instanceof SourceValidationError) {
    console.error(e.message);
  } else {
    console.error(e instanceof Error ? e.message : String(e));
  }
  process.exit(1);
}
