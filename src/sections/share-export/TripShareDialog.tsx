import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { visibleCandidates, visibleStops } from 'src/domain/trips/query';
import { renderTripShareHtml } from 'src/sections/share-export/make-share-html';
import { ShareFileDialog, type ShareFileOptions } from 'src/sections/share-export/ShareFileDialog';
import { useTripLegs, type TripLegs } from 'src/sections/share-export/use-trip-legs';
import { queriedLabel } from 'src/sections/trips/planner/format';
import { libraryAtom } from 'src/stores/library-state';

const NOTHING_TO_SHARE = '일정에 넣은 장소가 없어요';

type Props = { open: boolean; onClose(): void; tripId: string };

/** 경로 상태 한 줄(스펙 §3.2). 구간이 없으면 null. */
function legStatus(legs: TripLegs): string | null {
  if (legs.total === 0) return null;
  if (legs.answered < legs.total) {
    return `이동 경로를 받는 중이에요 (${legs.answered}/${legs.total})`;
  }
  if (legs.estimated > 0) return `${legs.estimated}구간은 경로를 받지 못해 어림값으로 들어가요`;
  // `queriedLabel`은 `10월 16일 조회`(계획 화면과 같은 날짜 규칙).
  if (legs.oldestQueriedAt !== null) {
    return `이동 시간은 ${queriedLabel(legs.oldestQueriedAt)} 기준이에요`;
  }
  return null;
}

/** 줄이는 방법: 켜진 체크만 말한다(스펙 §3.2). */
function tooBigHint(includeMemo: boolean, candidates: number | null): string {
  const candidateBox = `'후보 ${candidates}곳도 넣기'`;
  if (includeMemo && candidates !== null) {
    return `'메모 포함'이나 ${candidateBox}를 끄고 다시 해 주세요`;
  }
  if (includeMemo) return "'메모 포함'을 끄고 다시 해 주세요";
  if (candidates !== null) return `${candidateBox}를 끄고 다시 해 주세요`;
  return '일정을 나눠 보내 주세요';
}

/**
 * 여행 하나를 일정 공유 파일(v2)로 만드는 창(스펙 §3.2). 몸통은 장소 `내보내기`와 같은 `ShareFileDialog`이고,
 * 이 창은 대상 문구·`후보 <C>곳도 넣기` 체크·경로 상태 줄과 v2 문서 만들기를 넘긴다. 열려 있는 동안 여행의
 * 모든 구간을 묻는다(`useTripLegs`). 받는 중에도 저장할 수 있고, 그때 답이 없는 구간은 어림값으로 들어간다.
 */
export function TripShareDialog({ open, onClose, tripId }: Props) {
  const library = useAtomValue(libraryAtom);
  const legs = useTripLegs(tripId, open);
  const [includeCandidates, setIncludeCandidates] = useState(true);

  // 열릴 때 후보 체크를 켬으로 초기화한다(렌더 중 상태 갱신).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIncludeCandidates(true);
  }

  const found = library.trips[tripId];
  const trip = found !== undefined && found.deletedAt === null ? found : null;
  const title = trip?.title.value ?? '';
  const dayCount = trip?.days.length ?? 0;
  const stopCount =
    trip === null ? 0 : trip.days.reduce((n, day) => n + visibleStops(library, day).length, 0);
  const candidateCount = trip === null ? 0 : visibleCandidates(library, trip).length;
  const withCandidates = includeCandidates && candidateCount > 0;
  const status = legStatus(legs);

  const summary = (
    <>
      <Box component="span" sx={{ display: 'block' }}>
        {`‘${title}’ 일정을 HTML 파일 하나로 만들어요`}
      </Box>
      <Box component="span" sx={{ display: 'block' }}>
        {`Day ${dayCount}개 · 일정 ${stopCount}곳${withCandidates ? ` · 후보 ${candidateCount}곳` : ''}`}
      </Box>
    </>
  );

  return (
    <ShareFileDialog
      open={open}
      onClose={onClose}
      heading="일정 공유"
      summary={summary}
      defaultTitle={title}
      emptyMessage={stopCount === 0 && !withCandidates ? NOTHING_TO_SHARE : null}
      make={(template, opts: ShareFileOptions) =>
        renderTripShareHtml(template, library, tripId, legs.routeOf, {
          ...opts,
          includeCandidates: withCandidates,
        })
      }
      tooBigHint={(opts) => tooBigHint(opts.includeMemo, withCandidates ? candidateCount : null)}
    >
      {candidateCount > 0 && (
        <FormControlLabel
          control={
            <Checkbox
              checked={includeCandidates}
              onChange={(event) => setIncludeCandidates(event.target.checked)}
            />
          }
          label={`후보 ${candidateCount}곳도 넣기`}
          sx={{ minHeight: 44 }}
        />
      )}
      {status !== null && (
        <Typography role="status" variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
          {status}
        </Typography>
      )}
    </ShareFileDialog>
  );
}
