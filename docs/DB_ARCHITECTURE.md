# Landmark 데이터베이스 아키텍처

이 문서는 Landmark 프로젝트의 데이터베이스 구조를 설명합니다. 마이크로서비스 아키텍처를 기반으로 각 서비스는 자체 데이터베이스를 사용하지만, 여기서는 전체적인 엔티티 관계를 중심으로 설명합니다.

## 엔티티 관계 다이어그램

## 테이블 정의

### USER (사용자)

사용자의 기본 정보를 저장하는 테이블입니다.

| 컬럼명           | 데이터 타입      | 설명                                    | 제약 조건                          |
|-----------------|-----------------|----------------------------------------|----------------------------------|
| id              | VARCHAR(36)     | 사용자 식별자 (UUID)                     | Primary Key                      |
| email           | VARCHAR(100)    | 이메일 주소 (기본 사용자 ID)              | Unique, Not Null                |
| username        | VARCHAR(50)     | 사용자 이름                             | Not Null                        |
| password        | VARCHAR(100)    | 암호화된 비밀번호 (SSO 사용자는 NULL 가능)  | Nullable                         |
| profile_image_url | VARCHAR(255) | 프로필 이미지 URL                        | Nullable                         |
| status          | VARCHAR(20)     | 사용자 상태 (ACTIVE, INACTIVE, DORMANT)  | Not Null, Default 'ACTIVE'      |
| last_login      | TIMESTAMP       | 마지막 로그인 시간                        | Nullable                         |
| dormant_date    | TIMESTAMP       | 휴면 상태로 전환된 시간                    | Nullable                         |
| is_deleted      | BOOLEAN         | 논리적 삭제 여부                          | Not Null, Default FALSE         |
| deleted_at      | TIMESTAMP       | 논리적 삭제 시간                          | Nullable                         |
| created_by      | VARCHAR(36)     | 생성자 ID                               | Not Null (시스템ID 기본값)         |
| updated_by      | VARCHAR(36)     | 수정자 ID                               | Not Null (시스템ID 기본값)         |
| created_at      | TIMESTAMP       | 생성 시간                                | Not Null                        |
| updated_at      | TIMESTAMP       | 수정 시간                                | Not Null                        |

### USER_OAUTH (사용자 SSO 연결)

SSO 연결 정보를 저장하는 테이블입니다.

| 컬럼명             | 데이터 타입      | 설명                                   | 제약 조건                         |
|-------------------|-----------------|----------------------------------------|----------------------------------|
| id                | VARCHAR(36)     | 식별자 (UUID)                           | Primary Key                     |
| user_id           | VARCHAR(36)     | 사용자 ID (USER 테이블 참조)             | Foreign Key, Not Null          |
| provider          | VARCHAR(20)     | SSO 제공자 (GOOGLE, NAVER, KAKAO, GITHUB) | Not Null                     |
| provider_id       | VARCHAR(100)    | SSO 제공자에서의 사용자 ID                | Not Null                       |
| provider_username | VARCHAR(100)    | SSO 제공자에서의 사용자 이름              | Nullable                        |
| provider_email    | VARCHAR(100)    | SSO 제공자에서의 이메일                  | Nullable                        |
| access_token      | VARCHAR(255)    | 암호화된 액세스 토큰                      | Nullable                        |
| refresh_token     | VARCHAR(255)    | 암호화된 리프레시 토큰                    | Nullable                        |
| token_expires_at  | TIMESTAMP       | 토큰 만료 시간                           | Nullable                        |
| last_used_at      | TIMESTAMP       | 마지막으로 이용한 시간                    | Not Null                       |
| is_deleted        | BOOLEAN         | 논리적 삭제 여부                         | Not Null, Default FALSE        |
| deleted_at        | TIMESTAMP       | 논리적 삭제 시간                         | Nullable                        |
| created_by        | VARCHAR(36)     | 생성자 ID                               | Not Null (시스템ID 기본값)       |
| updated_by        | VARCHAR(36)     | 수정자 ID                               | Not Null (시스템ID 기본값)       |
| created_at        | TIMESTAMP       | 생성 시간                                | Not Null                       |
| updated_at        | TIMESTAMP       | 수정 시간                                | Not Null                       |

### ROLE (역할)

시스템의 역할(권한)을 정의하는 테이블입니다.

| 컬럼명           | 데이터 타입      | 설명                                   | 제약 조건                        |
|-----------------|-----------------|----------------------------------------|--------------------------------|
| id              | VARCHAR(36)     | 역할 식별자 (UUID)                      | Primary Key                    |
| name            | VARCHAR(50)     | 역할 이름 (ADMIN, USER, MANAGER 등)     | Unique, Not Null              |
| description     | VARCHAR(255)    | 역할 설명                               | Nullable                       |
| is_deleted      | BOOLEAN         | 논리적 삭제 여부                         | Not Null, Default FALSE       |
| deleted_at      | TIMESTAMP       | 논리적 삭제 시간                         | Nullable                       |
| created_by      | VARCHAR(36)     | 생성자 ID                               | Not Null (시스템ID 기본값)      |
| updated_by      | VARCHAR(36)     | 수정자 ID                               | Not Null (시스템ID 기본값)      |
| created_at      | TIMESTAMP       | 생성 시간                               | Not Null                      |
| updated_at      | TIMESTAMP       | 수정 시간                               | Not Null                      |

### USER_ROLE (사용자-역할 매핑)

사용자와 역할의 다대다 관계를 위한 중간 테이블입니다.

| 컬럼명           | 데이터 타입      | 설명                                   | 제약 조건                        |
|-----------------|-----------------|----------------------------------------|--------------------------------|
| id              | VARCHAR(36)     | 식별자 (UUID)                           | Primary Key                    |
| user_id         | VARCHAR(36)     | 사용자 ID (USER 테이블 참조)             | Foreign Key, Not Null         |
| role_id         | VARCHAR(36)     | 역할 ID (ROLE 테이블 참조)               | Foreign Key, Not Null         |
| is_deleted      | BOOLEAN         | 논리적 삭제 여부                         | Not Null, Default FALSE       |
| deleted_at      | TIMESTAMP       | 논리적 삭제 시간                         | Nullable                       |
| created_by      | VARCHAR(36)     | 생성자 ID                               | Not Null (시스템ID 기본값)      |
| updated_by      | VARCHAR(36)     | 수정자 ID                               | Not Null (시스템ID 기본값)      |
| created_at      | TIMESTAMP       | 생성 시간                               | Not Null                      |
| updated_at      | TIMESTAMP       | 수정 시간                               | Not Null                      |

## 인덱스 전략

### USER
- `email_idx`: `email` 컬럼에 대한 인덱스 (로그인 및 사용자 검색)
- `status_idx`: `status` 컬럼에 대한 인덱스 (상태별 사용자 조회)
- `is_deleted_idx`: `is_deleted` 컬럼에 대한 인덱스 (삭제 여부 필터링)

### USER_OAUTH
- `user_id_idx`: `user_id` 컬럼에 대한 인덱스 (사용자별 OAuth 연결 조회)
- `provider_provider_id_idx`: (`provider`, `provider_id`) 복합 인덱스 (OAuth 로그인 처리)
- `last_used_at_idx`: `last_used_at` 컬럼에 대한 인덱스 (최근 사용 순 정렬)

### USER_ROLE
- `user_id_idx`: `user_id` 컬럼에 대한 인덱스 (사용자별 역할 조회)
- `role_id_idx`: `role_id` 컬럼에 대한 인덱스 (역할별 사용자 조회)

## 제약 조건

### USER_OAUTH
- `uk_user_oauth_provider_provider_id`: (`provider`, `provider_id`) 조합에 대한 유니크 제약 조건

### USER_ROLE
- `uk_user_role_user_id_role_id`: (`user_id`, `role_id`) 조합에 대한 유니크 제약 조건

## 마이크로서비스 고려사항

이 설계는 마이크로서비스 아키텍처에 적합하도록 다음 요소를 고려하였습니다:

1. **이벤트 기반 데이터 동기화**: 사용자 정보 변경 시 이벤트를 발행하여 다른 서비스에 알림
2. **서비스 간 느슨한 결합**: API를 통한 데이터 접근으로 서비스 독립성 보장
3. **UUID 사용**: 분산 환경에서 ID 충돌 방지
4. **범용적인 데이터 타입**: 다양한 데이터베이스 호환성 보장