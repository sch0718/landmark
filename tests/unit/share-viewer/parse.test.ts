import { describe, expect, it } from 'vitest';
import type { ShareDoc } from 'src/schema/share';
import { parseShareDoc, readShareDoc } from 'src/share-viewer/parse';
import { makeShareV2Doc } from '../helpers/share-v2-doc';

function validDoc(): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '정자역 카페',
    createdAt: '2026-10-11T03:00:00.000Z',
    labels: [{ id: 'l1', name: '카페', color: 'orange', order: 0 }],
    places: [
      {
        id: 'p1',
        name: '서혜커피',
        address: '경기 성남시 분당구 정자동 1',
        lng: 127.1,
        lat: 37.36,
        labelIds: ['l1'],
        memo: '크로플',
        naverSid: '123',
      },
    ],
  };
}

describe('parseShareDoc', () => {
  it('정상 doc은 통과한다', () => {
    expect(parseShareDoc(validDoc())).toEqual(validDoc());
  });

  it('memo·naverSid가 없어도 통과한다', () => {
    const doc = validDoc();
    const { id, name, address, lng, lat, labelIds } = doc.places[0]!;
    doc.places = [{ id, name, address, lng, lat, labelIds }];
    expect(parseShareDoc(doc)).not.toBeNull();
  });

  it('kakaoId·googleId가 있으면 그대로 남는다', () => {
    const doc = validDoc();
    doc.places[0]!.kakaoId = '2345678';
    doc.places[0]!.googleId = '0x1a2b:0x3c4d';
    expect(parseShareDoc(doc)).toEqual(doc);
  });

  it('kakaoId·googleId가 없으면 키가 생기지 않는다', () => {
    const parsed = parseShareDoc(validDoc())!;
    expect('kakaoId' in parsed.places[0]!).toBe(false);
    expect('googleId' in parsed.places[0]!).toBe(false);
  });

  it.each(['kakaoId', 'googleId'])('%s가 문자열이 아니면 null', (key) => {
    for (const bad of [123, null, {}]) {
      const doc = validDoc();
      (doc.places[0] as unknown as Record<string, unknown>)[key] = bad;
      expect(parseShareDoc(doc)).toBeNull();
    }
  });

  it('JSON을 거친 값도 통과한다', () => {
    expect(parseShareDoc(JSON.parse(JSON.stringify(validDoc())))).not.toBeNull();
  });

  it.each([
    ['format이 다르다', { format: 'other' }],
    ['version이 2인데 trips가 없다', { version: 2 }],
    ['version이 3이다', { version: 3 }],
    ['places가 배열이 아니다', { places: 'x' }],
    ['title이 문자열이 아니다', { title: 1 }],
    ['createdAt이 없다', { createdAt: undefined }],
    ['labels가 배열이 아니다', { labels: null }],
  ])('%s → null', (_name, patch) => {
    expect(parseShareDoc({ ...validDoc(), ...patch })).toBeNull();
  });

  it('lat이 문자열이면 null', () => {
    const doc = validDoc();
    (doc.places[0] as unknown as { lat: unknown }).lat = '37.36';
    expect(parseShareDoc(doc)).toBeNull();
  });

  it('lng가 유한하지 않으면 null', () => {
    const doc = validDoc();
    doc.places[0]!.lng = Number.NaN;
    expect(parseShareDoc(doc)).toBeNull();
  });

  it("라벨 color가 'black'이면 null", () => {
    const doc = validDoc();
    (doc.labels[0] as unknown as { color: string }).color = 'black';
    expect(parseShareDoc(doc)).toBeNull();
  });

  it('labelIds에 문자열이 아닌 값이 있으면 null', () => {
    const doc = validDoc();
    (doc.places[0] as unknown as { labelIds: unknown[] }).labelIds = [1];
    expect(parseShareDoc(doc)).toBeNull();
  });

  it('memo가 문자열이 아니면 null', () => {
    const doc = validDoc();
    (doc.places[0] as unknown as { memo: unknown }).memo = 3;
    expect(parseShareDoc(doc)).toBeNull();
  });

  it.each([null, undefined, 'x', 1, []])('객체가 아닌 %s → null', (v) => {
    expect(parseShareDoc(v)).toBeNull();
  });
});

describe('readShareDoc', () => {
  function docWithBlock(text: string | null): Document {
    const d = document.implementation.createHTMLDocument('x');
    if (text !== null) {
      const s = d.createElement('script');
      s.type = 'application/json';
      s.id = 'tripmap-share';
      s.textContent = text;
      d.body.append(s);
    }
    return d;
  }

  it('데이터 블록을 읽어 검사한다', () => {
    expect(readShareDoc(docWithBlock(JSON.stringify(validDoc())))).toEqual(validDoc());
  });

  it('블록이 없으면 null', () => {
    expect(readShareDoc(docWithBlock(null))).toBeNull();
  });

  it('JSON이 깨졌으면 null', () => {
    expect(readShareDoc(docWithBlock('{"format":'))).toBeNull();
  });

  it('형식이 맞지 않으면 null', () => {
    expect(readShareDoc(docWithBlock('{"format":"x"}'))).toBeNull();
  });
});

describe('parseShareDoc v2', () => {
  const clone = () =>
    JSON.parse(JSON.stringify(makeShareV2Doc())) as ReturnType<typeof makeShareV2Doc>;
  const mutate = (fn: (doc: ReturnType<typeof makeShareV2Doc>) => void) => {
    const doc = clone();
    fn(doc);
    return parseShareDoc(doc);
  };

  it('정상 v2 문서는 같은 값으로 읽힌다', () => {
    expect(parseShareDoc(makeShareV2Doc())).toEqual(makeShareV2Doc());
  });

  it('JSON을 거쳐도 읽힌다', () => {
    expect(parseShareDoc(clone())).toEqual(makeShareV2Doc());
  });

  it('review·note·kakaoId가 남는다', () => {
    const doc = makeShareV2Doc();
    doc.places[0]!.review = '맛있어요';
    doc.places[0]!.kakaoId = 'k1';
    expect(parseShareDoc(doc)).toEqual(doc);
  });

  it('모르는 필드는 읽은 값에 남기지 않는다', () => {
    const doc = clone() as unknown as Record<string, unknown>;
    doc.extra = 1;
    (doc.trips as Record<string, unknown>[])[0]!.extra = 2;
    expect(parseShareDoc(doc)).toEqual(makeShareV2Doc());
  });

  it('stayMin이 문자열이면 null', () => {
    expect(
      mutate((d) => {
        (d.trips[0]!.days[0]!.stops[0] as unknown as { stayMin: unknown }).stayMin = '60';
      }),
    ).toBeNull();
  });

  it.each([
    [
      'stayMin이 소수',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.days[0]!.stops[0]!.stayMin = 1.5;
      },
    ],
    [
      'stayMin이 1441',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.days[0]!.stops[0]!.stayMin = 1441;
      },
    ],
    [
      'stayMin이 음수',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.days[0]!.stops[0]!.stayMin = -1;
      },
    ],
    [
      'fixedTime 형식이 틀림',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.days[0]!.stops[1]!.fixedTime = '24:00';
      },
    ],
    [
      'note가 501자',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.days[0]!.stops[1]!.note = 'a'.repeat(501);
      },
    ],
    [
      'review가 141자',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.places[0]!.review = 'a'.repeat(141);
      },
    ],
    [
      'startTime 형식이 틀림',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.days[0]!.startTime = '9:00';
      },
    ],
    [
      'startDate가 달력에 없음',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.startDate = '2026-02-30';
      },
    ],
    [
      'createdAt이 ISO가 아님',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.createdAt = '2026-10-16';
      },
    ],
    [
      '장소 lng가 범위 밖',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.places[0]!.lng = 200;
      },
    ],
    [
      'legModes 값이 틀림',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.legModes as Record<string, string>)[`${d.places[2]!.id}>${d.places[3]!.id}`] =
          'bike';
      },
    ],
    [
      'leg mode가 틀림',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.days[0]!.legs[0] as unknown as { mode: string }).mode = 'bus';
      },
    ],
    [
      'leg status가 틀림',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.days[0]!.legs[0] as unknown as { status: string }).status = 'x';
      },
    ],
    [
      'leg durationS가 문자열',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.days[0]!.legs[0] as unknown as { durationS: unknown }).durationS = '1';
      },
    ],
    [
      'leg tollFare가 undefined',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.days[0]!.legs[0] as unknown as { tollFare: unknown }).tollFare = undefined;
      },
    ],
    [
      'path 점이 세 값',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.days[0]!.legs[0]!.path as unknown[]).push([1, 2, 3]);
      },
    ],
    [
      'path 점이 NaN',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips[0]!.days[0]!.legs[0]!.path.push([Number.NaN, 37]);
      },
    ],
    [
      'stops가 배열이 아님',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.days[0] as unknown as { stops: unknown }).stops = {};
      },
    ],
    [
      'lodgingId가 undefined',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.days[1] as unknown as { lodgingId: unknown }).lodgingId = undefined;
      },
    ],
    [
      'candidateIds에 숫자',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        (d.trips[0]!.candidateIds as unknown[]).push(1);
      },
    ],
    [
      'trips가 2개',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips.push(d.trips[0]!);
      },
    ],
    [
      'trips가 비어 있음',
      (d: ReturnType<typeof makeShareV2Doc>) => {
        d.trips = [];
      },
    ],
  ])('%s → null', (_name, fn) => {
    expect(mutate(fn)).toBeNull();
  });

  it('관계 검사에 실패하면 null(구간 개수가 맞지 않음)', () => {
    expect(
      mutate((d) => {
        d.trips[0]!.days[0]!.legs.pop();
      }),
    ).toBeNull();
  });

  it('어디에도 쓰이지 않는 장소가 있으면 null', () => {
    expect(
      mutate((d) => {
        d.places.push({ ...d.places[0]!, id: 'orphan0001' });
      }),
    ).toBeNull();
  });

  it('장소가 0곳이면 null', () => {
    expect(
      mutate((d) => {
        d.places = [];
      }),
    ).toBeNull();
  });

  it('version 3은 null', () => {
    expect(
      mutate((d) => {
        (d as unknown as { version: number }).version = 3;
      }),
    ).toBeNull();
  });

  it('readShareDoc도 v2를 읽는다', () => {
    const d = document.implementation.createHTMLDocument('x');
    const s = d.createElement('script');
    s.id = 'tripmap-share';
    s.textContent = JSON.stringify(makeShareV2Doc());
    d.body.append(s);
    expect(readShareDoc(d)).toEqual(makeShareV2Doc());
  });
});
