import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useAtom } from 'jotai';
import type { TripData } from 'src/schema/trip-data';
import { dayName } from 'src/sections/itinerary/store/format';
import { selectedDayAtom } from 'src/stores/ui-store';

/** 전체 / Day 1 / Day 2 / … */
export function DayTabs({ trip }: { trip: TripData }) {
  const [day, setDay] = useAtom(selectedDayAtom);
  return (
    <Tabs
      value={day}
      onChange={(_e, value: string) => setDay(value)}
      variant="scrollable"
      scrollButtons="auto"
      aria-label="Day 선택"
    >
      <Tab value="all" label="전체" />
      {trip.days.map((d) => (
        <Tab key={d.date} value={d.date} label={dayName(trip, d.date)} />
      ))}
    </Tabs>
  );
}
