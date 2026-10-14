import Box from '@mui/material/Box';
import { visuallyHidden } from '@mui/utils';

/**
 * 계획 화면의 `h1`은 여행 제목 하나다(스펙 §4). 보이는 제목은 후보 칸(`CandidatePanel`)의 머리에 있어서,
 * 후보 칸이 그려지지 않으면(중간 폭에서 접었거나, 좁은 화면 일정 시트가 접혔거나 Day 탭이면) 여행 제목을
 * 눈에만 숨긴 `h1`로 대신한다. `candidatesShown`은 지금 후보 칸이 그려지는가다(그려지면 아무것도 그리지 않는다).
 */
export function TripTitleHeading({
  title,
  candidatesShown,
}: {
  title: string;
  candidatesShown: boolean;
}) {
  if (candidatesShown) return null;
  return (
    <Box component="h1" sx={visuallyHidden}>
      {title}
    </Box>
  );
}
