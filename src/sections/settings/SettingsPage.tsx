import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MonitorIcon, MoonIcon, SunIcon } from 'src/components/icons';
import { liveLabels, livePlaces } from 'src/domain/library/query';
import { useDocumentTitle } from 'src/lib/use-document-title';
import type { Prefs } from 'src/schema/prefs';
import { ResetHelpButton } from 'src/sections/help/ResetHelpButton';
import { paths } from 'src/routes/paths';
import { BackupSection } from 'src/sections/backup/BackupSection';
import { RestoreDialogHost } from 'src/sections/backup/RestoreDialogHost';
import { AboutSection } from 'src/sections/settings/AboutSection';
import { LegacyImportDialog } from 'src/sections/settings/LegacyImportDialog';
import { OptionGroup, type Option } from 'src/sections/settings/OptionGroup';
import { SentLinksSection } from 'src/sections/settings/SentLinksSection';
import { ThemePicker } from 'src/sections/settings/ThemePicker';
import { persistState } from 'src/lib/storage-persist';
import { persistStateAtom } from 'src/stores/backup-state';
import { libraryAtom } from 'src/stores/library-state';
import { prefsAtom, setPrefsAtom } from 'src/stores/prefs-state';

const MODES: ReadonlyArray<Option<Prefs['mode']>> = [
  { value: 'system', label: '시스템', Icon: MonitorIcon },
  { value: 'light', label: '라이트', Icon: SunIcon },
  { value: 'dark', label: '다크', Icon: MoonIcon },
];

const VIEWS: ReadonlyArray<Option<Prefs['libraryView']>> = [
  { value: 'bento', label: '벤토' },
  { value: 'cards', label: '카드' },
  { value: 'tiles', label: '타일' },
  { value: 'list', label: '목록' },
];

/** 쿼리로 대화상자를 바로 여는 키(보관함 빈 화면의 "옛 여행 가져오기"). */
const IMPORT_PARAM = 'import';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography component="h2" sx={{ fontSize: 15, fontWeight: 800 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** 직렬화 길이 × 2바이트(UTF-16)로 어림한 사용 용량, KB. */
const approxKb = (library: unknown): number =>
  Math.max(1, Math.round((JSON.stringify(library).length * 2) / 1024));

/** 설정(스펙 §4.7): 테마·모드·보관함 보기·백업·보낸 짧은 링크·옛 여행 가져오기·데이터 정보·앱 정보(저작권·라이선스·후원). */
export function SettingsPage() {
  useDocumentTitle('설정');
  const prefs = useAtomValue(prefsAtom);
  const setPrefs = useSetAtom(setPrefsAtom);
  const library = useAtomValue(libraryAtom);
  const [persist, setPersist] = useAtom(persistStateAtom);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(() => searchParams.has(IMPORT_PARAM));
  const [restoreOpen, setRestoreOpen] = useState(false);

  // 쿼리로 들어왔으면 대화상자는 이미 열렸으니 주소에서 지운다(새로고침해도 다시 열리지 않게).
  useEffect(() => {
    if (!searchParams.has(IMPORT_PARAM)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(IMPORT_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // 저장 보호 상태는 열 때 한 번 읽는다(백업을 받으면 요청 결과로 갱신된다).
  useEffect(() => {
    let live = true;
    void persistState().then((state) => {
      if (live) setPersist(state);
    });
    return () => {
      live = false;
    };
  }, [setPersist]);

  const info = useMemo(
    () =>
      `장소 ${livePlaces(library).length}곳 · 라벨 ${liveLabels(library).length}개 · 사용 용량 약 ${approxKb(library).toLocaleString('ko-KR')} KB`,
    [library],
  );
  const persistNote =
    persist === 'persisted'
      ? ' · 저장 보호 켜짐'
      : persist === 'not-persisted'
        ? ' · 저장 보호 꺼짐'
        : '';

  return (
    <Box
      sx={{
        maxWidth: 640,
        mx: 'auto',
        px: 2,
        py: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Box component="h1" sx={{ m: 0, fontSize: 20, fontWeight: 800 }}>
        설정
      </Box>

      <Section title="테마">
        <ThemePicker value={prefs.theme} onChange={(theme) => setPrefs({ ...prefs, theme })} />
      </Section>
      <Section title="모드">
        <OptionGroup
          label="모드"
          value={prefs.mode}
          options={MODES}
          onChange={(mode) => setPrefs({ ...prefs, mode })}
        />
      </Section>
      <Section title="보관함 보기">
        <OptionGroup
          label="보관함 보기"
          value={prefs.libraryView}
          options={VIEWS}
          onChange={(libraryView) => setPrefs({ ...prefs, libraryView })}
        />
      </Section>
      <Section title="백업">
        <BackupSection onRestore={() => setRestoreOpen(true)} />
      </Section>
      <SentLinksSection />
      <Section title="가져오기">
        <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
          예전 여행 데이터의 장소와 라벨을 보관함으로 가져와요.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button variant="outlined" onClick={() => setImportOpen(true)} sx={{ minHeight: 44 }}>
            옛 여행 가져오기
          </Button>
          <Button
            variant="outlined"
            onClick={() => void navigate(paths.importShare)}
            sx={{ minHeight: 44 }}
          >
            공유 파일 가져오기
          </Button>
        </Box>
      </Section>
      <Section title="도움말">
        <Typography variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
          메뉴별 사용법을 그림으로 볼 수 있어요
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button component={Link} to={paths.help} variant="outlined" sx={{ minHeight: 44 }}>
            도움말 보기
          </Button>
          <ResetHelpButton />
        </Box>
      </Section>
      <Section title="데이터 정보">
        <Typography variant="body2">{`${info}${persistNote}`}</Typography>
      </Section>
      <Section title="이 앱에 대해">
        <AboutSection />
      </Section>

      <LegacyImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => setImportOpen(false)}
      />
      <RestoreDialogHost open={restoreOpen} onClose={() => setRestoreOpen(false)} mode="normal" />
    </Box>
  );
}
