export const paths = {
  library: '/',
  map: '/map',
  place: (id: string) => `/place/${id}`,
  labels: '/labels',
  settings: '/settings',
  trips: '/trips',
  legacyTrip: (id: string) => `/t/${id}`,
};
