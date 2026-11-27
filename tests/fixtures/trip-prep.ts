import type { Booking, Phrase, PrepNote } from 'src/schema/trip';

export const booking: Booking = {
  id: 'book0001',
  kind: 'ticket',
  title: '입장권',
  need: 'required',
  status: 'booked',
  date: '2026-12-31',
  placeId: null,
  links: [{ label: '예매처', url: 'https://example.com/tickets' }],
  bookBy: '2026-11-27',
  at: '2026-12-31T09:00',
  freeCancelUntil: '2026-12-30T18:00',
  code: 'ZZCODE123',
  price: { amount: 25, currency: 'EUR' },
  bookedVia: '공식 사이트',
  note: '',
};

export const prepNote: PrepNote = {
  id: 'note0001',
  topic: 'power',
  region: '스페인',
  text: '숙소에 콘센트 규격 문의',
  sources: ['https://example.com/power'],
  checkedOn: '2026-11-27',
  unsure: true,
};

export const phrase: Phrase = {
  id: 'word0001',
  situation: 'greet',
  ko: '안녕하세요',
  text: 'Hola',
  lang: 'es-ES',
  reading: '올라',
  note: '',
};
