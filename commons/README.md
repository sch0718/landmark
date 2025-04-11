# 공통 모듈

## 개요
이 공통 모듈은 랜드마크 프로젝트의 여러 마이크로서비스에서 재사용할 수 있는 클래스들을 제공합니다. 주요 구성 요소로는 엔티티 정의, DTO, 예외 처리, 구성 등이 포함됩니다.

## 패키지 구성
```
com.landmark.commons/
├── config/     - 공통 구성 클래스
├── exception/  - 예외 및 에러 코드 정의
└── model/      - 도메인 모델 클래스
    ├── dto/    - 데이터 전송 객체
    │   └── response/ - API 응답 래퍼 클래스
    └── entity/ - 엔티티 클래스
        ├── common/ - 공통 인터페이스 
        ├── jpa/    - JPA 구현체
        ├── mongodb/- MongoDB 구현체(향후 구현)
        └── redis/  - Redis 구현체(향후 구현)
```

## Entity

### 주요 특징
1. **관심사 분리**
   - 인터페이스와 구현체를 명확하게 분리
   - 공통 기능(감사, 소프트 삭제)을 인터페이스로 정의하여 재사용성 증대
2. **체계적인 계층 구조**
   - 각 계층이 명확한 역할과 책임을 가짐
   - 상위 계층에서 공통 기능을 구현하여 코드 중복 최소화
3. **확장성이 고려된 패키지 구조**
   - 저장소 기술별로 분리된 패키지 구조
   - 새로운 기술 도입 시 기존 코드 영향 최소화
4. **JPA 구현체**
   - Spring Data JPA의 감사 기능 활용
   - UUID 기반 ID 전략으로 마이크로서비스에 적합한 설계
   - 소프트 삭제 지원

### 엔티티 패키지 구조
```
entity/
 ├── common/             - 공통 인터페이스
 │   ├── Auditable.java  - 감사 정보 인터페이스 (생성/수정 일시, 사용자)
 │   └── SoftDeletable.java - 소프트 삭제 인터페이스
 ├── jpa/                - JPA 구현체
 │   ├── AuditEntity.java - 감사 정보 구현체
 │   ├── AbstractBaseEntity.java - 기본 엔티티 추상 클래스
 │   ├── AbstractSoftDeletableBaseEntity.java - 소프트 삭제 기능 추상 클래스
 │   └── BaseEntity.java - UUID 기반 최종 엔티티 구현체
 ├── mongodb/            - MongoDB 구현체 (향후 구현 예정)
 └── redis/              - Redis 구현체 (향후 구현 예정)
```

### 상속 구조
```
 Auditable 인터페이스  <───  SoftDeletable 인터페이스
       │                       │
       ▼                       │
   AuditEntity                 │
       │                       │
       ▼                       │
AbstractBaseEntity             │
       │                       │
       ▼                       ▼
AbstractSoftDeletableBaseEntity
       │
       ▼
   BaseEntity (UUID 기반)
```

## Exception

### 주요 특징
1. **계층화된 예외 구조**
   - `BaseException`: 모든 커스텀 예외의 부모 클래스
   - `ServiceException`: 서비스 특화 에러 코드를 포함하는 예외 클래스
2. **분산 추적을 위한 TraceId 통합**
   - 모든 예외는 자동으로 현재 요청의 TraceId를 포함
   - 마이크로서비스 간 요청 추적 용이
   - 로깅 및 디버깅에 활용 가능
3. **표준화된 에러 코드**
   - 모든 서비스가 공통으로 사용할 수 있는 `CommonErrorCode` 제공
   - 서비스별 에러 코드를 위한 `ServiceErrorCode` 인터페이스 제공
4. **중앙화된 예외 처리**
   - `GlobalExceptionHandler`를 통한 일관된 예외 처리
   - 모든 예외를 `ApiResponse` 형식으로 통일

### 예외 패키지 구조
```
exception/
 ├── BaseException.java            - 기본 예외 클래스
 ├── ServiceException.java         - 서비스 특화 예외 클래스
 ├── ServiceErrorCode.java         - 서비스 에러 코드 인터페이스
 ├── CommonErrorCode.java          - 공통 에러 코드 열거형
 ├── GlobalExceptionHandler.java   - 전역 예외 처리기
 └── TraceContext.java             - 트레이스 ID 관리 클래스
```

### 트레이스 ID (TraceId)
분산 시스템에서 요청 추적을 위한 핵심 요소:

1. **자동 생성 및 전파**
   - Spring Cloud Sleuth/Micrometer Tracing을 통해 자동 생성
   - 서비스 간 호출 시 HTTP 헤더를 통해 전파
   - `TraceContext` 클래스로 트레이스 ID에 손쉬운 접근 제공

2. **예외 및 응답 통합**
   - 모든 `BaseException`은 트레이스 ID를 포함
   - 모든 `ApiResponse`는 트레이스 ID 필드 포함
   - 로그 메시지에 트레이스 ID 자동 포함

3. **장애 추적 활용**
   - 동일 트레이스 ID로 여러 서비스의 로그 연결 가능
   - 분산 트레이싱 시스템(Zipkin)과 연동
   - 복잡한 오류 상황에서 문제 발생 흐름 추적 용이

4. **사용 예시**
   ```java
   // 예외 발생 시 트레이스 ID 자동 포함
   throw new ServiceException(MyErrorCode.RESOURCE_NOT_FOUND);
   
   // 로그에 트레이스 ID 포함
   log.error("오류 발생: {}, TraceId: {}", errorMessage, TraceContext.getCurrentTraceId());
   
   // API 응답에 트레이스 ID 포함
   return ApiResponse.success(data, TraceContext.getCurrentTraceId());
   ```

## DTO

### 응답 래퍼
- **ApiResponse**: 모든 API 응답에 대한 일관된 형식 제공
  - 성공/실패 여부
  - 응답 코드
  - 메시지
  - 응답 데이터
  - 타임스탬프
  - 트레이스 ID (분산 추적용)

### 주요 기능
- 성공 응답 생성을 위한 다양한 정적 팩토리 메서드
- 에러 응답 생성을 위한 다양한 정적 팩토리 메서드
- 서비스 에러 코드와 통합

## 향후 계획
- MongoDB, Redis 등을 위한 엔티티 구현체 개발
- 공통 유틸리티 기능 추가
- 보안 관련 공통 컴포넌트 추가
- 검증 및 직렬화를 위한 공통 기능 추가