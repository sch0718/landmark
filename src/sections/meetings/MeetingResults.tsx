import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { HUBS, type Hub } from 'src/domain/meeting/hubs';
import { fitMeetingText } from 'src/domain/meeting/limits';
import { preselectHubs, rankRows, transitDeparture } from 'src/domain/meeting/rank';
import {
  addCandidate,
  decide,
  removeCandidate,
  toggleLike,
  updateMeeting,
} from 'src/domain/meeting/ops';
import { finalFromMeeting, inviteFromMeeting } from 'src/domain/meeting/link';
import { localDate } from 'src/lib/local-date';
import { LIBRARY_LIMITS, type Library } from 'src/schema/library';
import type { Candidate, Meeting } from 'src/schema/meeting';
import { useLibraryAction } from 'src/stores/library-state';
import { HubResults } from './HubResults';
import { NearbyPlaces } from './NearbyPlaces';
import { CandidateTally } from './CandidateTally';
import { shareMeetingDoc } from './share-link';
import { useMeetingCompute } from './use-meeting-compute';

/** 찾기·후보·집계는 같은 약속 연산으로 저장하고 계산값은 화면에만 둔다. */
export function MeetingResults({
  meeting,
  library,
  onHubsChange,
}: {
  meeting: Meeting;
  library: Library;
  onHubsChange?(hubs: Hub[]): void;
}) {
  const { run } = useLibraryAction();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [findSeq, setFindSeq] = useState(0);
  const [condition, setCondition] = useState<string | null>(null);
  const conditionKey = JSON.stringify({
    origins: meeting.participants.value.map((p) => [p.id, p.origin]),
    mode: meeting.mode.value,
    at: meeting.at.value,
  });
  const departureCondition = JSON.stringify([meeting.mode.value, meeting.at.value]);
  const [departureSnapshot, setDepartureSnapshot] = useState<{
    condition: string;
    value: string | null;
  }>({ condition: departureCondition, value: null });
  // 조건 변경은 이전 스냅숏을 버리고, 첫 후보 자동 계산 전에 두 훅의 입력을 맞춘다.
  if (departureSnapshot.condition !== departureCondition) {
    setDepartureSnapshot({ condition: departureCondition, value: null });
  } else if (
    departureSnapshot.value === null &&
    meeting.mode.value === 'transit' &&
    (meeting.at.value !== null || meeting.candidates.value.length > 0)
  ) {
    setDepartureSnapshot({
      condition: departureCondition,
      value: transitDeparture(meeting.at.value, new Date()),
    });
  }
  const departure = departureSnapshot.value;
  const args = {
    participants: meeting.participants.value,
    mode: meeting.mode.value,
    at: meeting.at.value,
    departure,
  };
  const hubCompute = useMeetingCompute({ ...args, targets: hubs });
  const candidateCompute = useMeetingCompute({ ...args, targets: meeting.candidates.value });
  const rankedHubIds = JSON.stringify(
    rankRows(
      hubs.map((h) => ({
        ...h,
        values: meeting.participants.value
          .filter((p) => p.origin !== null)
          .map((p) => hubCompute.times[h.id]?.[p.id] ?? null),
      })),
      meeting.rank.value,
    ).map((h) => h.id),
  );
  useEffect(() => {
    const ids = JSON.parse(rankedHubIds) as string[];
    onHubsChange?.(ids.map((id) => HUBS.find((h) => h.id === id)!));
  }, [rankedHubIds, onHubsChange]);
  const computeCandidates = candidateCompute.compute;
  const computeHubs = hubCompute.compute;
  const candidateFindSeq = useRef(0);
  const targetKey = JSON.stringify(meeting.candidates.value);
  useEffect(() => {
    const refresh = candidateFindSeq.current !== findSeq;
    candidateFindSeq.current = findSeq;
    if (meeting.candidates.value.length === 0) return;
    const controller = new AbortController();
    void computeCandidates({ refresh, signal: controller.signal });
    return () => controller.abort();
  }, [targetKey, meeting.candidates.value.length, computeCandidates, findSeq, departure]);
  useEffect(() => {
    if (findSeq === 0) return;
    void computeHubs({ refresh: true });
  }, [findSeq, computeHubs]);
  const stale = (condition !== null && condition !== conditionKey) || candidateCompute.stale;
  const eligible = meeting.participants.value.filter((p) => p.origin !== null);
  const find = () => {
    const next = preselectHubs(
      eligible.map((p) => [p.origin!.lng, p.origin!.lat]),
      HUBS,
    );
    setHubs(next);
    setDepartureSnapshot({
      condition: departureCondition,
      value:
        meeting.mode.value === 'transit' ? transitDeparture(meeting.at.value, new Date()) : null,
    });
    setCondition(conditionKey);
    setFindSeq((seq) => seq + 1);
  };
  const add = async (candidate: Omit<Candidate, 'id'>) => {
    const result = await run((lib, ctx) => addCandidate(lib, meeting.id, candidate, ctx));
    if (!result.ok) {
      const reason = (result.error as { reason?: string })?.reason;
      toast.error(
        reason === 'candidate-exists'
          ? '이미 담은 후보예요'
          : reason === 'candidates-full'
            ? '후보는 8곳까지 담을 수 있어요'
            : '후보를 담지 못했어요',
      );
    }
  };
  const host = meeting.participants.value[0];
  const pending = hubCompute.pending || candidateCompute.pending;
  const queried =
    [hubCompute.queriedAt, candidateCompute.queriedAt]
      .filter((at) => at !== null)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return (
    <Box sx={{ mt: 2 }}>
      <Button
        variant="contained"
        disabled={eligible.length < 2 || pending}
        sx={{ minHeight: 44 }}
        onClick={find}
      >
        중간 지점 찾기
      </Button>
      {eligible.length < 2 && <p>출발지가 있는 참석자가 2명 이상이어야 해요</p>}
      {stale && <Box role="status">조건이 바뀌었어요 — 다시 찾기</Box>}
      {pending && (
        <Box role="status">
          조회 중 {hubCompute.progress.done + candidateCompute.progress.done}/
          {hubCompute.progress.total + candidateCompute.progress.total}
        </Box>
      )}
      {queried && meeting.mode.value === 'transit' && departure && (
        <p>
          대중교통: {departure.slice(5).replace('T', ' ')} 출발 기준, 조회 {localDate(queried)}
        </p>
      )}
      {queried && meeting.mode.value === 'car' && (
        <p>자동차: 조회 시점 실시간 교통 기준, 조회 {localDate(queried)}</p>
      )}
      {hubs.length > 0 && (
        <HubResults
          hubs={hubs}
          participants={meeting.participants.value}
          times={hubCompute.times}
          errors={hubCompute.errors}
          rank={meeting.rank.value}
          unit={hubCompute.unit}
          onRank={(rank) => void run((lib, ctx) => updateMeeting(lib, meeting.id, { rank }, ctx))}
          onRetry={(cid, pid) => void hubCompute.retry(cid, pid)}
          onAdd={(hub) =>
            void add({
              kind: 'hub',
              name: fitMeetingText(hub.name, LIBRARY_LIMITS.meetingTitleChars),
              lng: hub.lng,
              lat: hub.lat,
              hubId: hub.id,
            })
          }
          renderNearby={(hub) => (
            <NearbyPlaces hub={hub} library={library} onAdd={(candidate) => void add(candidate)} />
          )}
        />
      )}
      <CandidateTally
        meeting={meeting}
        times={candidateCompute.times}
        errors={candidateCompute.errors}
        unit={candidateCompute.unit}
        onLike={(cid) => {
          if (host) void run((lib, ctx) => toggleLike(lib, meeting.id, host.id, cid, ctx));
        }}
        onRemove={(cid) => void run((lib, ctx) => removeCandidate(lib, meeting.id, cid, ctx))}
        onDecide={(cid) => void run((lib, ctx) => decide(lib, meeting.id, cid, ctx))}
        onRetry={(cid, pid) => void candidateCompute.retry(cid, pid)}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          disabled={meeting.candidates.value.length === 0 || pending}
          onClick={() =>
            void shareMeetingDoc(
              inviteFromMeeting(
                meeting,
                candidateCompute.times,
                candidateCompute.unit,
                new Date().toISOString(),
              ),
              meeting.title.value,
            )
          }
          sx={{ minHeight: 44 }}
        >
          후보 링크 보내기
        </Button>
        {meeting.decided.value !== null && (
          <Button
            variant="contained"
            onClick={() => {
              const doc = finalFromMeeting(meeting);
              if (doc) void shareMeetingDoc(doc, meeting.title.value);
            }}
            sx={{ minHeight: 44 }}
          >
            확정 링크 보내기
          </Button>
        )}
      </Box>
    </Box>
  );
}
