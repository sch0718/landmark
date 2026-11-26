import { randomId, randomToken } from 'src/lib/random';

/** 소유권 토큰은 URL 질의·보관함·백업에 넣지 않는다. */
export const newLiveToken = randomToken;
export const newLiveId = (): string => randomId(10);
export const newDayId = (): string => randomId(8);
