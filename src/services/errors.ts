import { Schema } from 'effect';
import type { ApiErrorCode } from 'src/server/http';
import { MutableArray } from 'src/schema/mutable';

// 스펙 §6.3. 화면에 보일 문구는 `userMessage`에 둔다(토스트·화면 공통).

const IssueSchema = Schema.Struct({ path: Schema.String, message: Schema.String });

/** localStorage를 쓸 수 없다. 메모리 저장으로 대체하고 배너를 띄운다. */
export class StorageUnavailable extends Schema.TaggedError<StorageUnavailable>()(
  'StorageUnavailable',
  {},
) {
  get userMessage(): string {
    return '이 브라우저에서는 저장할 수 없어요. 새로고침하면 사라져요';
  }
}

/** 쓰기 용량 초과. `bytes`는 쓰려던 문서의 직렬화 길이(`String.length`). */
export class StorageQuotaExceeded extends Schema.TaggedError<StorageQuotaExceeded>()(
  'StorageQuotaExceeded',
  { bytes: Schema.Number },
) {
  get userMessage(): string {
    return '저장 공간이 부족해 저장하지 못했어요';
  }
}

/** 저장된 문서가 스키마 검증에 실패했다. 원문은 `backupKey`에 백업돼 있다(`null`이면 백업이 없다). */
export class LibraryCorrupt extends Schema.TaggedError<LibraryCorrupt>()('LibraryCorrupt', {
  backupKey: Schema.NullOr(Schema.String),
  issues: MutableArray(IssueSchema),
}) {
  get userMessage(): string {
    return '데이터를 읽지 못했어요';
  }
}

/** `update` 결과가 스키마·불변식 검증에 실패했다(프로그램 오류). */
export class LibraryInvalid extends Schema.TaggedError<LibraryInvalid>()('LibraryInvalid', {
  issues: MutableArray(IssueSchema),
}) {
  get userMessage(): string {
    return '저장하지 못했어요(데이터 검증 실패)';
  }
}

/**
 * 되살리기 전 사본(손상이면 손상 백업)을 남기지 못해 보관함을 바꾸지 않았다(설계서 §5).
 * `changedSinceSaved`: 화면이 받아 둔 원문과 잠금 안에서 읽은 지금 원문이 달라 사본이 필요해졌다.
 * 손상 화면은 같은 판정으로 자기 문구를 쓴다.
 */
export class PreviousNotKept extends Schema.TaggedError<PreviousNotKept>()('PreviousNotKept', {
  changedSinceSaved: Schema.Boolean,
}) {
  get userMessage(): string {
    return this.changedSinceSaved
      ? "그사이 보관함이 바뀌었어요. '지금 보관함 먼저 받기'로 다시 받은 뒤 바꿔 주세요"
      : "저장 공간이 부족해 지금 보관함을 기기에 남겨 둘 수 없어요. 먼저 '지금 보관함 먼저 받기'로 파일을 받은 뒤 바꿔 주세요";
  }
}

/** 되돌릴 사본이 없거나 읽지 못했다. */
export class NoPrevious extends Schema.TaggedError<NoPrevious>()('NoPrevious', {}) {
  get userMessage(): string {
    return '되돌리지 못했어요';
  }
}

export class LegacyImportInvalid extends Schema.TaggedError<LegacyImportInvalid>()(
  'LegacyImportInvalid',
  { message: Schema.String },
) {
  get userMessage(): string {
    return this.message;
  }
}

export class LegacyImportStale extends Schema.TaggedError<LegacyImportStale>()(
  'LegacyImportStale',
  {},
) {
  get userMessage(): string {
    return '보관함이 바뀌어 미리보기를 다시 계산했어요';
  }
}

export class LabelNameTaken extends Schema.TaggedError<LabelNameTaken>()('LabelNameTaken', {
  name: Schema.String,
}) {
  get userMessage(): string {
    return '같은 이름의 라벨이 있어요';
  }
}

export const GEOLOCATION_ERROR_REASONS = [
  'denied',
  'unavailable',
  'timeout',
  'unsupported',
] as const;
export type GeolocationErrorReason = (typeof GEOLOCATION_ERROR_REASONS)[number];

/**
 * 내 위치를 얻지 못했다(스펙 §6). 값으로 받아 화면에 `userMessage`를 보이고, 앱 오류 보고자로는 보내지 않는다.
 * `denied` 권한 거부 / `unavailable` 위치를 못 얻음·좌표가 숫자가 아님 / `timeout` 브라우저 시한 초과 /
 * `unsupported` 위치 API가 없거나 보안 연결이 아님.
 */
export class GeolocationError extends Schema.TaggedError<GeolocationError>()('GeolocationError', {
  reason: Schema.Literals(GEOLOCATION_ERROR_REASONS),
}) {
  get userMessage(): string {
    switch (this.reason) {
      case 'denied':
        return '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요';
      case 'unavailable':
        return '지금은 위치를 알 수 없어요. 잠시 뒤 다시 해 주세요';
      case 'timeout':
        return '위치를 찾는 데 시간이 너무 오래 걸려요. 다시 해 주세요';
      case 'unsupported':
        return '이 브라우저에서는 위치를 쓸 수 없어요';
    }
  }
}

/** 내보내기 파일을 만들지 못했을 때 화면에 보이는 안내. */
export const SHARE_EXPORT_FAILED =
  '내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요';

/** 공유 HTML 틀을 받지 못했거나 틀이 올바르지 않다. `reason`은 진단용이고 화면에는 안내 문구만 보인다. */
export class ShareTemplateUnavailable extends Schema.TaggedError<ShareTemplateUnavailable>()(
  'ShareTemplateUnavailable',
  { reason: Schema.String },
) {
  get userMessage(): string {
    return SHARE_EXPORT_FAILED;
  }
}

/** 만든 공유 데이터가 스키마 검증에 실패했다(프로그램 오류). 사용자에게는 같은 안내를 보인다. */
export class ShareDocInvalid extends Schema.TaggedError<ShareDocInvalid>()('ShareDocInvalid', {
  message: Schema.String,
}) {
  get userMessage(): string {
    return SHARE_EXPORT_FAILED;
  }
}

const API_ERROR_CODES = [
  'UNSUPPORTED_LINK',
  'NOT_FOUND',
  'FORBIDDEN_ORIGIN',
  'TOO_MANY_PLACES',
  'UPSTREAM_ERROR',
  'TIMEOUT',
  'BAD_REQUEST',
  'NO_ROUTE',
] as const satisfies readonly ApiErrorCode[];
// 서버 코드가 늘면 여기서 컴파일 오류가 난다(위 목록에 더하고 `userMessage`도 고친다).
const _allCodesListed: [Exclude<ApiErrorCode, (typeof API_ERROR_CODES)[number]>] extends [never]
  ? true
  : never = true;
void _allCodesListed;

/** 서버 오류 코드와 앱 쪽 연결 실패(`OFFLINE`). */
export const PLACE_LOOKUP_ERROR_CODES = [...API_ERROR_CODES, 'OFFLINE'] as const;
export type PlaceLookupErrorCode = (typeof PLACE_LOOKUP_ERROR_CODES)[number];

/** 서버가 준 오류 코드가 맞는지. */
export const isApiErrorCode = (value: unknown): value is ApiErrorCode =>
  (API_ERROR_CODES as readonly unknown[]).includes(value);

// BAD_REQUEST·NO_ROUTE는 경로 조회 전용 코드라 장소 조회는 만들지 않는다. 오면 같은 안내를 보인다.
const UNAVAILABLE_MESSAGE = '지금은 장소 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요';

/**
 * 링크·폴더 조회 실패(스펙 §5). `reason: 'no-location'`은 구글 링크에 위치가 없을 때만 오고,
 * 이때 `placeName`에 장소 이름이 온다(`name`은 Error.name과 겹쳐서 쓰지 않는다).
 */
export class PlaceLookupError extends Schema.TaggedError<PlaceLookupError>()('PlaceLookupError', {
  code: Schema.Literals(PLACE_LOOKUP_ERROR_CODES),
  reason: Schema.optionalKey(Schema.Literal('no-location')),
  placeName: Schema.optionalKey(Schema.String),
}) {
  get userMessage(): string {
    switch (this.code) {
      case 'UNSUPPORTED_LINK':
        return '네이버·카카오·구글 지도의 장소 링크만 넣을 수 있어요';
      case 'NOT_FOUND':
        return this.reason === 'no-location'
          ? '위치를 알 수 없는 링크예요. 지도에서 위치를 맞춰 주세요'
          : '장소를 찾지 못했어요. 링크를 다시 확인해 주세요';
      case 'TOO_MANY_PLACES':
        return '장소가 너무 많은 폴더예요(최대 1,000곳)';
      case 'OFFLINE':
        return '인터넷 연결을 확인하고 다시 시도해 주세요';
      case 'FORBIDDEN_ORIGIN':
      case 'UPSTREAM_ERROR':
      case 'TIMEOUT':
      case 'BAD_REQUEST':
      case 'NO_ROUTE':
        return UNAVAILABLE_MESSAGE;
    }
  }
}

export const ROUTE_LOOKUP_ERROR_CODES = [
  'NO_ROUTE',
  'UPSTREAM_ERROR',
  'TIMEOUT',
  'OFFLINE',
  'BAD_REQUEST',
  'FORBIDDEN_ORIGIN',
] as const;
export type RouteLookupErrorCode = (typeof ROUTE_LOOKUP_ERROR_CODES)[number];

/**
 * 구간 경로 조회 실패(스펙 §4.2). 호출한 쪽은 실패한 구간을 직선 추정으로 채우고
 * `userMessage`를 구간 옆에 보인다. `seq`는 실패한 서버 요청의 순서 번호(`RouteAnswer.seq`와 같은 차례),
 * `fresh`는 그 요청이 `다시 계산`이었는가다(호출한 쪽의 `refresh`가 아니라 실제로 나간 요청의 종류).
 */
export class RouteLookupError extends Schema.TaggedError<RouteLookupError>()('RouteLookupError', {
  code: Schema.Literals(ROUTE_LOOKUP_ERROR_CODES),
  seq: Schema.Number,
  fresh: Schema.Boolean,
}) {
  get userMessage(): string {
    switch (this.code) {
      case 'NO_ROUTE':
        return '경로 없음 · 직선 추정';
      case 'OFFLINE':
        return '인터넷에 연결되지 않아 이동 시간은 어림값이에요';
      case 'UPSTREAM_ERROR':
      case 'TIMEOUT':
      case 'BAD_REQUEST':
      case 'FORBIDDEN_ORIGIN':
        return '경로를 못 가져왔어요';
    }
  }
}
