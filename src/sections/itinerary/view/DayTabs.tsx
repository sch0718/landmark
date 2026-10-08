import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import dayjs from 'dayjs';
import 'dayjs/locale/ko';
import { useAtom, useSetAtom } from 'jotai';
import type { TripData } from 'src/schema/legacy/trip-data';
import { dayName } from 'src/sections/itinerary/store/format';
import { itineraryEditingAtom } from 'src/sections/views/store/view-session';
import { selectedDayAtom } from 'src/stores/ui-store';

/** 전체 / Day 1 / Day 2 / … */
export function DayTabs({ trip }: { trip: TripData }) {
  const [day, setDay] = useAtom(selectedDayAtom);
  const setEditing = useSetAtom(itineraryEditingAtom);
  return (
    <Tabs
      value={day}
      onChange={(_e, value: string) => {
        if (value !== day) setEditing(false);
        setDay(value);
      }}
      variant="scrollable"
      scrollButtons="auto"
      aria-label="Day 선택"
    >
      <Tab value="all" label="전체" />
      {trip.days.map((d) => (
        <Tab
          key={d.date}
          value={d.date}
          aria-label={dayName(trip, d.date)}
          label={
            <Box>
              <Typography variant="caption">
                {dayjs(d.date).locale('ko').format('MM.DD ddd')}
              </Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                {dayName(trip, d.date)}
              </Typography>
            </Box>
          }
        />
      ))}
    </Tabs>
  );
}
