export const paths = {
  library: '/',
  map: '/map',
  place: (id: string) => `/place/${id}`,
  labels: '/labels',
  settings: '/settings',
  help: '/help',
  helpPage: (id: string) => `/help/${id}`,
  /** 설정을 열면서 옛 여행 가져오기 대화상자를 바로 연다. */
  settingsImport: '/settings?import=1',
  /** 받은 공유 파일 가져오기 진입. 들어오면 곧바로 `/`로 바꾸고 추가 흐름을 연다. */
  importShare: '/import',
  meetings: '/meetings',
  meeting: (id: string) => `/meetings/${id}`,
  meet: '/meet',
  meetOnline: (id: string) => `/meet/${id}`,
  trips: '/trips',
  tripLive: (id: string) => `/trips/live/${id}`,
  trip: (id: string) => `/trips/${id}`,
  /** 여행 당일 모드: 오늘 Day의 다음 장소·남은 일정. */
  tripToday: (id: string) => `/trips/${id}/today`,
  legacyTrip: (id: string) => `/t/${id}`,
};
