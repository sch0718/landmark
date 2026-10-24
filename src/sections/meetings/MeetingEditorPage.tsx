import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { HelpButton } from 'src/components/HelpButton';
import { MapView } from 'src/components/map/MapView';
import type { Hub } from 'src/domain/meeting/hubs';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import type { Library } from 'src/schema/library';
import type { Meeting } from 'src/schema/meeting';
import { MeetingFormDialog } from 'src/sections/meetings/MeetingFormDialog';
import { MeetingResults } from 'src/sections/meetings/MeetingResults';
import { ParticipantList } from 'src/sections/meetings/ParticipantList';
import { meetingMapLayers } from 'src/sections/meetings/meeting-map-layers';
import { useMeeting } from 'src/sections/meetings/use-meeting';
import { useLayout } from 'src/sections/shell/use-layout';

const MODE_LABEL = { transit: '대중교통', car: '자동차', straight: '직선거리' };

function Editor({ meeting, library }: { meeting: Meeting; library: Library }) {
  const compact = useLayout() === 'compact';
  const [editing, setEditing] = useState(false);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const layers = useMemo(() => meetingMapLayers(meeting, hubs), [meeting, hubs]);
  const information = (
    <Box
      component="section"
      aria-label="약속 편집"
      sx={{
        p: 2,
        width: compact ? '100%' : 420,
        flex: compact ? '1 0 auto' : 'none',
        boxSizing: 'border-box',
        overflow: compact ? 'visible' : 'auto',
        bgcolor: 'var(--tm-bg-surface)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button component={Link} to={paths.meetings} sx={{ minHeight: 44 }}>
          ← 약속 목록
        </Button>
        <HelpButton page="meetings" />
      </Box>
      <Box component="h1" sx={{ m: 0, mt: 1, fontSize: 22, overflowWrap: 'anywhere' }}>
        {meeting.title.value}
      </Box>
      <Box sx={{ my: 1, color: 'var(--tm-text-secondary)' }}>
        {meeting.at.value === null
          ? '일시 미정'
          : `${meeting.at.value.date.replaceAll('-', '.')} ${meeting.at.value.time}`}{' '}
        · {MODE_LABEL[meeting.mode.value]}
      </Box>
      <Button onClick={() => setEditing(true)} sx={{ minHeight: 44 }}>
        기본 정보 고치기
      </Button>
      <ParticipantList meeting={meeting} />
      <MeetingResults meeting={meeting} library={library} onHubsChange={setHubs} />
    </Box>
  );
  const map = (
    <Box
      component="section"
      aria-label="약속 지도"
      sx={{
        position: 'relative',
        minWidth: 0,
        flex: compact ? 'none' : 1,
        height: compact ? 280 : '100%',
        bgcolor: 'var(--tm-bg-raised)',
      }}
    >
      <MapView
        markers={layers.markers}
        polylines={layers.polylines}
        onMarkerClick={() => {}}
        onUnavailable={setUnavailable}
        fitKey={`${meeting.id}:${JSON.stringify(layers.markers.map((marker) => [marker.id, marker.lng, marker.lat]))}`}
      />
      {unavailable !== null && (
        <Box
          role="status"
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            p: 3,
          }}
        >
          {unavailable}
        </Box>
      )}
    </Box>
  );
  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: compact ? 'column' : 'row',
        overflow: compact ? 'auto' : 'hidden',
      }}
    >
      {compact ? (
        <>
          {map}
          {information}
        </>
      ) : (
        <>
          {information}
          {map}
        </>
      )}
      <MeetingFormDialog
        open={editing}
        mode="edit"
        meetingId={meeting.id}
        initial={{ title: meeting.title.value, at: meeting.at.value, mode: meeting.mode.value }}
        onClose={() => setEditing(false)}
      />
    </Box>
  );
}

/** 약속은 경로 단위로 지연 로딩하며 첫 로딩에서 역 데이터와 링크 코드를 분리한다. */
export function MeetingEditorPage() {
  const { id = '' } = useParams();
  const { library, meeting } = useMeeting(id);
  useDocumentTitle(meeting?.title.value ?? null);
  if (meeting === null)
    return (
      <Box role="alert" sx={{ px: 3, py: 6, textAlign: 'center' }}>
        <Box component="h1" sx={{ fontSize: 20 }}>
          약속을 찾지 못했어요
        </Box>
        <Button component={Link} to={paths.meetings} variant="contained" sx={{ minHeight: 44 }}>
          약속 목록으로
        </Button>
      </Box>
    );
  return <Editor key={meeting.id} meeting={meeting} library={library} />;
}
