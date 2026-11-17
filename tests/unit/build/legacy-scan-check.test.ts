import { describe, expect, it } from 'vitest';
// @ts-expect-error -- Node 스크립트(.mjs)라 타입 선언이 없다.
import { compareWithBaseline, flattenFindings } from '../../../scripts/legacy-scan-check.mjs';

const scan = {
  guides: [
    {
      guideId: 'js',
      rules: [
        {
          ruleId: 'js/copying-array-methods',
          findings: [
            { file: 'a.ts', line: 3, lineContent: '  [...x].sort()', message: 'm' },
            { file: 'a.ts', line: 9, lineContent: '[...x].sort()', message: 'm' },
          ],
        },
      ],
    },
  ],
};

describe('legacy-scan 검토 목록 비교', () => {
  it('줄 번호가 아니라 규칙·파일·줄 내용으로 맞추고, 같은 줄이 둘이면 개수로 센다', () => {
    const findings = flattenFindings(scan);
    const baseline = [
      { rule: 'js/copying-array-methods', file: 'a.ts', lineContent: '[...x].sort()' },
    ];
    const { fresh, gone } = compareWithBaseline(findings, baseline);
    expect(fresh).toHaveLength(1);
    expect(gone).toHaveLength(0);
  });

  it('더는 나오지 않는 검토 항목을 알려 준다', () => {
    const baseline = [{ rule: 'js/copying-array-methods', file: 'b.ts', lineContent: 'old' }];
    const { fresh, gone } = compareWithBaseline(flattenFindings(scan), baseline);
    expect(fresh).toHaveLength(2);
    expect(gone).toEqual(baseline);
  });
});
