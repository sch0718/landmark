export const paths = {
  library: '/',
  map: '/map',
  place: (id: string) => `/place/${id}`,
  labels: '/labels',
  settings: '/settings',
  /** 설정을 열면서 옛 여행 가져오기 대화상자를 바로 연다. */
  settingsImport: '/settings?import=1',
  /** 받은 공유 파일 가져오기 진입. 들어오면 곧바로 `/`로 바꾸고 추가 흐름을 연다. */
  importShare: '/import',
  trips: '/trips',
  trip: (id: string) => `/trips/${id}`,
  legacyTrip: (id: string) => `/t/${id}`,
};
