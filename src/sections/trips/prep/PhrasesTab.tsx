import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { checkTripSize } from 'src/domain/trips/bookings';
import {
  phraseLangs,
  phraseSituations,
  prepCountMessage,
  putPhrase,
  removePhrase,
  type PhraseInput,
} from 'src/domain/trips/prep';
import { googleTranslateUrl, pickVoice, speak } from 'src/lib/speak';
import { PHRASES_MAX, type Phrase, type Trip } from 'src/schema/trip';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { PhraseSheet } from './PhraseSheet';
import { PrepChip } from './PrepChip';
import { prepActionError } from './PrepSheet';
import { SITUATION_LABELS, languageLabel, languageName } from './prep-labels';

const translateLabel = '구글 번역에서 듣기';
const transmission = '문장이 Google로 전송돼요';
const iconSize = { width: 44, height: 44 };
const textSx = { whiteSpace: 'pre-line', overflowWrap: 'anywhere' };
type Voice = ReturnType<typeof pickVoice>;

function PhraseRow({
  phrase,
  voice,
  menuOpen,
  onMenu,
}: {
  phrase: Phrase;
  voice: Voice | undefined;
  menuOpen: boolean;
  onMenu: (anchor: HTMLElement) => void;
}) {
  const [failedText, setFailedText] = useState<string | null>(null);
  const playback = useRef(0);
  const failed = failedText === phrase.text;

  async function play(rate: number) {
    if (!voice) return;
    const attempt = ++playback.current;
    setFailedText(null);
    try {
      await speak(phrase.text, voice.voice, rate);
    } catch {
      if (attempt === playback.current) setFailedText(phrase.text);
    }
  }

  return (
    <Stack component="li" sx={{ p: 1.5, gap: 0.5 }}>
      <Stack
        direction="row"
        sx={{ gap: 1, alignItems: 'start', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Box sx={{ flex: '1 1 12rem', minWidth: 0, ...textSx }}>
          <Typography sx={{ fontWeight: 800 }}>{phrase.ko}</Typography>
          <Typography lang={phrase.lang}>{phrase.text}</Typography>
          {phrase.reading && (
            <Typography variant="body2" color="text.secondary">
              {phrase.reading}
            </Typography>
          )}
          {phrase.note && <Typography variant="body2">{phrase.note}</Typography>}
        </Box>
        <Stack direction="row" sx={{ alignItems: 'center', ml: 'auto' }}>
          {voice && (
            <>
              <IconButton
                aria-label={`${phrase.ko} 듣기`}
                onClick={() => void play(1)}
                sx={iconSize}
              >
                <span aria-hidden="true">▶</span>
              </IconButton>
              {voice.online && (
                <Typography variant="caption" color="text.secondary">
                  온라인 음성
                </Typography>
              )}
              <IconButton
                aria-label={`${phrase.ko} 느리게 듣기`}
                onClick={() => void play(0.6)}
                sx={iconSize}
              >
                <span aria-hidden="true">🐢</span>
              </IconButton>
            </>
          )}
          <IconButton
            aria-label={`${phrase.ko} 메뉴`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => onMenu(event.currentTarget)}
            sx={iconSize}
          >
            <span aria-hidden="true">⋯</span>
          </IconButton>
        </Stack>
      </Stack>
      {(voice === null || failed) && (
        <Box>
          <Typography
            role={failed ? 'status' : undefined}
            variant="body2"
            color={failed ? 'error' : 'text.secondary'}
          >
            {failed
              ? '소리를 내지 못했어요'
              : `이 기기에서 ${languageName(phrase.lang.split('-')[0] ?? phrase.lang)} 음성을 쓸 수 없어요`}
          </Typography>
          <Button
            href={googleTranslateUrl(phrase.text, phrase.lang)}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ minHeight: 44 }}
          >
            {translateLabel}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {transmission}
          </Typography>
        </Box>
      )}
    </Stack>
  );
}

export function PhrasesTab({
  trip,
  requestVoices,
}: {
  trip: Trip;
  requestVoices: () => Promise<SpeechSynthesisVoice[]>;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>();
  const [selectedLang, setLang] = useState('');
  const [selectedSituation, setSituation] = useState<Phrase['situation'] | null>(null);
  const [editor, setEditor] = useState<PhraseInput | null>(null);
  const [large, setLarge] = useState<Phrase | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const { run } = useTripUndo(trip.id, checkTripSize);
  const phrases = trip.phrases?.value ?? [];
  const langs = phraseLangs(phrases);
  const lang = langs.includes(selectedLang) ? selectedLang : (langs[0] ?? '');
  const situations = phraseSituations(phrases, lang);
  const situation =
    selectedSituation && situations.includes(selectedSituation) ? selectedSituation : null;
  const voice = voices === undefined ? undefined : pickVoice(voices, lang);
  const active = phrases.find(({ id }) => id === menu?.id);
  const full = phrases.length >= PHRASES_MAX;

  useEffect(() => {
    let active = true;
    void requestVoices().then((list) => {
      if (active) setVoices(list);
    });
    return () => {
      active = false;
    };
  }, [requestVoices]);
  // 화면을 떠나면 읽던 문장을 멈춘다(긴 문장이 다른 화면에서 이어지지 않게).
  useEffect(() => () => globalThis.speechSynthesis?.cancel(), []);

  async function copy(phrase: Phrase) {
    try {
      await navigator.clipboard.writeText(phrase.text);
      toast('문장을 복사했어요');
    } catch {
      toast.error('문장을 복사하지 못했어요');
    }
  }

  async function remove(phrase: Phrase) {
    const result = await run(
      (lib, ctx) => removePhrase(lib, trip.id, phrase.id, ctx),
      '문장을 지웠어요',
    );
    if (!result.ok) toast.error(prepActionError(result.error, '문장을 지우지 못했어요'));
  }

  return (
    <Stack sx={{ gap: 1.5 }}>
      {langs.length > 0 && (
        <>
          <Stack role="group" aria-label="언어" direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {langs.map((value) => (
              <PrepChip
                key={value}
                label={languageLabel(value)}
                selected={value === lang}
                onClick={() => {
                  setLang(value);
                  setSituation(null);
                }}
              />
            ))}
          </Stack>
          <Stack role="group" aria-label="상황" direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <PrepChip
              label="전체"
              selected={situation === null}
              onClick={() => setSituation(null)}
            />
            {situations.map((value) => (
              <PrepChip
                key={value}
                label={SITUATION_LABELS[value]}
                selected={value === situation}
                onClick={() => setSituation(value)}
              />
            ))}
          </Stack>
        </>
      )}
      {phrases.length === 0 && (
        <Typography color="text.secondary">아직 적은 문장이 없어요</Typography>
      )}
      {situations
        .filter((value) => situation === null || value === situation)
        .map((value) => (
          <Box key={value}>
            <Typography component="h2" sx={{ mb: 0.5, fontWeight: 800 }}>
              <span aria-hidden="true">── </span>
              {SITUATION_LABELS[value]}
              <span aria-hidden="true"> ──</span>
            </Typography>
            <Box
              component="ul"
              sx={{
                m: 0,
                p: 0,
                listStyle: 'none',
                border: '1px solid var(--tm-border)',
                borderRadius: 'var(--tm-radius-md)',
                bgcolor: 'var(--tm-bg-raised)',
                '& > li + li': { borderTop: '1px solid var(--tm-border)' },
              }}
            >
              {phrases
                .filter((phrase) => phrase.lang === lang && phrase.situation === value)
                .map((phrase) => (
                  <PhraseRow
                    key={phrase.id}
                    phrase={phrase}
                    voice={voice}
                    menuOpen={active?.id === phrase.id}
                    onMenu={(anchor) => setMenu({ anchor, id: phrase.id })}
                  />
                ))}
            </Box>
          </Box>
        ))}
      <Button
        variant="contained"
        disabled={full}
        onClick={() =>
          setEditor({
            situation: situation ?? 'greet',
            lang,
            ko: '',
            text: '',
            reading: '',
            note: '',
          })
        }
        sx={{ minHeight: 44, alignSelf: { sm: 'end' } }}
      >
        ＋ 문장 더하기
      </Button>
      {full && <Typography variant="body2">{prepCountMessage('phrases')}</Typography>}
      {active && (
        <Menu
          open
          anchorEl={menu?.anchor}
          onClose={() => setMenu(null)}
          sx={{ '& .MuiMenuItem-root': { minHeight: 44 } }}
        >
          <MenuItem
            onClick={() => {
              setMenu(null);
              setLarge(active);
            }}
          >
            크게 보기
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              void copy(active);
            }}
          >
            복사
          </MenuItem>
          <MenuItem
            component="a"
            href={googleTranslateUrl(active.text, active.lang)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenu(null)}
          >
            <Box>
              {translateLabel}
              <Typography component="span" display="block" variant="caption" color="text.secondary">
                {transmission}
              </Typography>
            </Box>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              setEditor(active);
            }}
          >
            고치기
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              void remove(active);
            }}
          >
            지우기
          </MenuItem>
        </Menu>
      )}
      {large && (
        <Dialog
          open
          fullScreen
          slotProps={{ paper: { 'aria-label': '문장 크게 보기' } }}
          onClose={() => setLarge(null)}
        >
          <Button onClick={() => setLarge(null)} sx={{ minHeight: 44, m: 2, alignSelf: 'end' }}>
            닫기
          </Button>
          <Typography
            lang={large.lang}
            sx={{ ...textSx, fontSize: 'clamp(28px, 8vw, 56px)', m: 'auto', p: 3 }}
          >
            {large.text}
          </Typography>
        </Dialog>
      )}
      {editor && (
        <PhraseSheet
          initial={editor}
          phrases={phrases}
          langs={langs}
          onClose={() => setEditor(null)}
          onSave={async (input) => {
            const result = await run(
              (lib, ctx) => putPhrase(lib, trip.id, input, ctx),
              editor.id ? '문장을 고쳤어요' : '문장을 더했어요',
            );
            if (result.ok) {
              setLang(input.lang);
              if (situation !== null) setSituation(input.situation);
            }
            return result;
          }}
        />
      )}
    </Stack>
  );
}
