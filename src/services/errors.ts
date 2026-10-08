import { Schema } from 'effect';
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
