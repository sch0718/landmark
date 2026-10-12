export const paths = {
  library: '/',
  map: '/map',
  place: (id: string) => `/place/${id}`,
  labels: '/labels',
  settings: '/settings',
  /** 설정을 열면서 옛 여행 가져오기 대화상자를 바로 연다. */
  settingsImport: '/settings?import=1',
  trips: '/trips',
  trip: (id: string) => `/trips/${id}`,
  legacyTrip: (id: string) => `/t/${id}`,
};
