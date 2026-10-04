import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import type { ReconcileReport } from 'src/domain/reconcile';

type Props = {
  report: ReconcileReport;
  /** 그 날짜의 override가 미해결 원본 변경인가(묶음의 주 날짜). */
  isUnresolved: (date: string) => boolean;
  dayLabel: (date: string) => string;
  canKeepMine: (dates: string[]) => boolean;
  onRevert: (dates: string[]) => void;
  onKeepMine: (dates: string[]) => void;
};

/** 정리 결과와 미해결 원본 변경 배너(§5.5). 0건인 줄은 생략한다. */
export function ReconcileBanner({
  report,
  isUnresolved,
  dayLabel,
  canKeepMine,
  onRevert,
  onKeepMine,
}: Props) {
  const notices: string[] = [];
  if (report.removedStops.length > 0) {
    notices.push(`원본에서 사라진 장소 ${report.removedStops.length}곳을 일정에서 뺐어요`);
  }
  if (report.orphanPlaceKeys.length > 0) {
    notices.push(
      `사라진 장소의 메모 ${report.orphanPlaceKeys.length}건을 보관 중이에요 — 내보내기에 포함돼요`,
    );
  }
  if (report.hiddenEditDates.length > 0) {
    notices.push(`여행 기간에서 빠진 날짜의 편집 ${report.hiddenEditDates.length}건이 있어요`);
  }

  if (notices.length === 0 && report.unresolvedGroups.length === 0) return null;

  return (
    <Stack spacing={0.5} sx={{ px: 1, py: 0.5 }}>
      {report.unresolvedGroups.map((group) => {
        const primary = group.filter(isUnresolved);
        const main = primary.length > 0 ? primary : group;
        const related = group.filter((d) => !main.includes(d));
        const text =
          `${main.map(dayLabel).join(', ')} 원본이 바뀌었어요` +
          (related.length > 0 ? `(관련: ${related.map(dayLabel).join(', ')})` : '');
        return (
          <Alert
            key={group.join(',')}
            severity="warning"
            action={
              <Stack direction="row" spacing={0.5}>
                <Button color="inherit" size="small" onClick={() => onRevert(group)}>
                  원본 보기
                </Button>
                {canKeepMine(group) && (
                  <Button color="inherit" size="small" onClick={() => onKeepMine(group)}>
                    내 편집 유지
                  </Button>
                )}
              </Stack>
            }
          >
            {text}
          </Alert>
        );
      })}
      {notices.map((line) => (
        <Alert key={line} severity="info">
          {line}
        </Alert>
      ))}
    </Stack>
  );
}
