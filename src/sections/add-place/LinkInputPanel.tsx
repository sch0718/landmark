import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Effect, Result } from 'effect';
import { useSetAtom } from 'jotai';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { PlaceCandidate } from 'src/domain/library/add-place';
import { startEffect } from 'src/lib/effect/runtime';
import type { PlaceSource } from 'src/schema/library';
import type { ResolvedPlace } from 'src/server/resolve';
import { extractUrl } from 'src/sections/add-place/extract-url';
import { PlaceLookupError } from 'src/services/errors';
import { PlaceLookup } from 'src/services/place-lookup';
import { ReverseGeocoder } from 'src/services/reverse-geocoder';
import { addFlowAtom, type AddFlow } from 'src/stores/add-place';

const FIELD_SX = {
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
  minHeight: 88,
  p: 1.25,
  border: '1px solid var(--tm-border)',
  borderRadius: 'var(--tm-radius-md)',
  bgcolor: 'var(--tm-bg-raised)',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 16,
  lineHeight: 1.5,
  resize: 'vertical',
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
} as const;

/**
 * 링크 결과의 출처. 장소 ID가 없는 구글 링크(좌표만 있음)는 직접 찍은 핀처럼 다뤄
 * 중복을 판단하지 않는다(확인 카드의 출처 표시는 그래도 `구글`).
 */
function sourceOf(place: ResolvedPlace): PlaceSource {
  if (place.providerId === null) return { kind: 'pin' };
  switch (place.provider) {
    case 'naver':
      return { kind: 'naver', sid: place.providerId };
    case 'kakao':
      return { kind: 'kakao', kakaoId: place.providerId };
    case 'google':
      return { kind: 'google', googleId: place.providerId };
  }
}

/** 링크를 조회해 다음 단계를 정한다. 주소 없는 구글 결과는 주소 변환으로 채운다(못 찾으면 빈칸). */
const resolveLink = (url: string) =>
  Effect.gen(function* () {
    const lookup = yield* PlaceLookup;
    const result = yield* lookup.lookupLink(url);
    if (result.kind === 'folder') {
      return { step: 'folder', shareId: result.shareId } satisfies AddFlow;
    }
    let address = result.address;
    if (result.provider === 'google' && address === '') {
      const geocoder = yield* ReverseGeocoder;
      address = (yield* geocoder.reverse(result.lng, result.lat)) ?? '';
    }
    const candidate: PlaceCandidate = {
      source: sourceOf(result),
      name: result.name,
      address,
      lng: result.lng,
      lat: result.lat,
      category: result.category,
    };
    return { step: 'candidate', candidate } satisfies AddFlow;
  });

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; error: PlaceLookupError };

/** 다시 시도할 수 있는 오류와 핀으로 넘어갈 수 있는 오류(스펙 §5). */
const RETRY_CODES: readonly string[] = ['UPSTREAM_ERROR', 'TIMEOUT', 'OFFLINE'];
const PIN_CODES: readonly string[] = ['UPSTREAM_ERROR', 'TIMEOUT'];

/**
 * 링크 입력 창(스펙 §2.2·§5). 붙여 넣은 글에서 첫 링크를 뽑아 조회하고, 장소면 확인 카드로,
 * 폴더면 폴더 미리보기로 넘어간다. 조회 중에는 버튼을 막고, 창이 닫힌 뒤 온 결과는 버린다.
 */
export function LinkInputPanel({ hint }: { hint: 'place' | 'folder' }) {
  const setFlow = useSetAtom(addFlowAtom);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const guideId = useId();
  // 실행 번호. 새로 조회하거나 창이 닫히면 올려서 지난 조회의 결과가 끼어들지 않게 한다.
  const runSeq = useRef(0);
  useEffect(() => {
    const seq = runSeq;
    return () => {
      seq.current += 1;
    };
  }, []);

  const url = extractUrl(text);
  const loading = status.kind === 'loading';

  const submit = async () => {
    if (url === null || loading) return;
    const run = ++runSeq.current;
    setStatus({ kind: 'loading' });
    let result: Result.Result<AddFlow, PlaceLookupError>;
    try {
      result = await startEffect(Effect.result(resolveLink(url)));
    } catch (defect) {
      // 프로그램 오류. 화면에는 일시적인 실패로 보인다.
      console.error(defect);
      result = Result.fail(new PlaceLookupError({ code: 'UPSTREAM_ERROR' }));
    }
    if (runSeq.current !== run) return;
    if (Result.isSuccess(result)) {
      setFlow(result.success);
      return;
    }
    const error = result.failure;
    if (error.reason === 'no-location') {
      // 위치를 모르는 구글 링크: 아는 이름을 채운 채 바로 핀 모드로 간다.
      toast(error.userMessage);
      setFlow({ step: 'pin', name: error.placeName ?? '', start: null });
      return;
    }
    setStatus({ kind: 'error', error });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Enter는 확인, Shift+Enter는 줄바꿈. 한글 조합 중의 Enter는 글자를 확정하는 키라서 건너뛴다.
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  };

  const error = status.kind === 'error' ? status.error : null;
  return (
    <Box component="form" onSubmit={onSubmit} sx={{ p: 2 }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800, mb: 0.5 }}>
        {hint === 'folder' ? '네이버 폴더 가져오기' : '링크 붙여넣기'}
      </Typography>
      <Typography id={guideId} variant="body2" sx={{ mb: 1.5, color: 'var(--tm-text-secondary)' }}>
        {hint === 'folder' ? '네이버 공유 폴더 링크를 붙여 넣어 주세요' : '링크를 붙여 넣어 주세요'}
      </Typography>
      <Box
        component="textarea"
        aria-label="링크"
        aria-describedby={guideId}
        rows={3}
        autoComplete="off"
        placeholder="https://"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (status.kind === 'error') setStatus({ kind: 'idle' });
        }}
        onKeyDown={onKeyDown}
        sx={FIELD_SX}
      />
      {loading && (
        <Typography role="status" variant="body2" sx={{ mt: 1, color: 'var(--tm-text-secondary)' }}>
          장소를 찾는 중…
        </Typography>
      )}
      {error !== null && (
        <Box sx={{ mt: 1 }}>
          <Typography role="alert" variant="body2" color="error">
            {error.userMessage}
          </Typography>
          {(RETRY_CODES.includes(error.code) || PIN_CODES.includes(error.code)) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {RETRY_CODES.includes(error.code) && (
                <Button variant="outlined" onClick={() => void submit()} sx={{ minHeight: 44 }}>
                  다시 시도
                </Button>
              )}
              {PIN_CODES.includes(error.code) && (
                <Button
                  variant="outlined"
                  onClick={() => setFlow({ step: 'pin', name: '', start: null })}
                  sx={{ minHeight: 44 }}
                >
                  지도에서 핀으로 추가
                </Button>
              )}
            </Box>
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
        <Button onClick={() => setFlow({ step: 'closed' })} sx={{ minHeight: 44 }}>
          취소
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={url === null || loading}
          sx={{ minHeight: 44 }}
        >
          확인
        </Button>
      </Box>
    </Box>
  );
}
