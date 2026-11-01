import { DEFAULT_APP_URL } from 'src/share-viewer/encode';
import { EXIT } from './errors';
import type { CommandName } from './output';

/** 옵션 검사와 도움말이 함께 쓰는 명령별 옵션 목록. */
export const commandOptions: Record<CommandName, readonly string[]> = {
  build: ['memo', 'no-routes', 'out'],
  send: ['no-memo', 'no-routes'],
  share: ['memo', 'no-routes'],
  whoami: [],
  unshare: ['list'],
};

const commands: Record<CommandName, { usage: string; description: string }> = {
  build: {
    usage: 'build <plan.json>',
    description: '서버·토큰 없이 보기·가져오기 링크와 요약을 만듭니다.',
  },
  send: { usage: 'send <plan.json>', description: '내 받은함에 일정을 보냅니다.' },
  share: { usage: 'share <plan.json>', description: '암호화한 짧은 링크 /s/<id>#k=를 만듭니다.' },
  whoami: {
    usage: 'whoami',
    description: '토큰의 연결 이름·범위·만료·로그인 공급자를 확인합니다.',
  },
  unshare: {
    usage: 'unshare <id>',
    description: '이 컴퓨터에 삭제 토큰을 보관한 짧은 링크를 지웁니다.',
  },
};
const listDescription = '고른 앱의 저장된 링크와 결과 모름 예약을 봅니다.';
const optionHelp: Record<string, [string, string]> = {
  memo: ['--memo', '장소 메모를 넣습니다(Day 메모는 늘 들어감).'],
  'no-memo': ['--no-memo', '장소 메모를 뺍니다(Day 메모는 늘 들어감).'],
  'no-routes': ['--no-routes', '길찾기 조회를 생략하고 직선 추정을 씁니다.'],
  out: ['--out <doc.json>', '만든 공유 문서를 파일로 저장합니다.'],
  list: ['--list', '저장된 링크와 결과 모름 예약을 봅니다.'],
};
const commonOptions: [string, string][] = [
  ['--app <주소>', '링크·요청에 쓸 앱 주소를 고릅니다.'],
  ['--json', '결과를 JSON으로 출력합니다.'],
  ['-h, --help', '도움말을 출력합니다(다른 인자보다 우선).'],
];

function row(label: string, description: string): string {
  const width = [...label].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
  return `  ${label}${' '.repeat(Math.max(2, 23 - width))}${description}`;
}

/** 끝에 개행을 붙인 전체 또는 명령별 사람용 도움말. */
export function helpText(command?: CommandName): string {
  const lines: string[] = [];
  if (command) {
    lines.push(`사용법: yarn trip ${commands[command].usage} [옵션]`);
    if (command === 'unshare') lines.push('        yarn trip unshare --list [옵션]');
    lines.push('', commands[command].description);
    if (command === 'unshare') lines.push(listDescription + ' (서버·토큰 불필요)');
    lines.push('', '명령별 옵션:');
    const options = commandOptions[command];
    lines.push(...(options.length ? options.map((key) => row(...optionHelp[key]!)) : ['  없음']));
  } else {
    lines.push(
      '사용법: yarn trip <명령> [옵션]',
      '        yarn --silent trip --schema',
      'JSON을 다른 도구에서 읽을 때는 yarn --silent를 쓰세요.',
      '',
      '명령:',
      ...Object.values(commands).map(({ usage, description }) => row(usage, description)),
      row('unshare --list', listDescription),
      row('', '(서버·토큰 불필요)'),
      '',
      '명령별 옵션:',
      ...(Object.keys(commandOptions) as CommandName[]).map((name) => {
        const options = commandOptions[name].map((key) => optionHelp[key]![0]);
        return row(name, options.length ? options.join(', ') : '없음');
      }),
      '',
      '옵션 설명:',
      ...Object.values(optionHelp).map(([label, description]) => row(label, description)),
    );
  }
  lines.push(
    '',
    '공통 옵션:',
    ...commonOptions.flatMap(([label, description]) => [
      row(label, description),
      ...(label.startsWith('--app')
        ? [row('', `기본값: LANDMARK_APP_URL → ${DEFAULT_APP_URL}`)]
        : []),
    ]),
  );
  if (!command) {
    lines.push(
      '',
      '계획 파일 형식:',
      row('--schema', '계획 파일 v1의 JSON Schema를 출력합니다.'),
      row('', '명령 없이 쓰며 --json만 함께 허용합니다.'),
      '',
      '메모 기본값: send는 넣고 --no-memo로 뺍니다.',
      '             build·share는 --memo를 쓸 때만 넣습니다.',
    );
  }
  lines.push(
    '',
    '끝 코드:',
    row(String(EXIT.ok), '성공'),
    row(String(EXIT.internal), '내부 오류'),
    row(String(EXIT.input), '입력 오류'),
    row(String(EXIT.lookup), '장소 조회 실패·후보 여럿'),
    row(String(EXIT.auth), '토큰·계정·권한'),
    row(String(EXIT.server), '서버 거절·장애'),
    '',
    '문서: docs/development.md의 「AI 에이전트 일정 보내기(yarn trip)」 절',
  );
  return lines.join('\n') + '\n';
}
