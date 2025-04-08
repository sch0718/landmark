package com.landmark.commons.exception;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.ToString;
import org.springframework.http.HttpStatus;

/**
 * 모든 서비스에서 공통으로 사용할 수 있는 에러 코드
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Getter
@AllArgsConstructor
@ToString(includeFieldNames = true)
public enum CommonErrorCode implements ServiceErrorCode {
    
    // 일반 오류
    INTERNAL_SERVER_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "C001", "서버 내부 오류가 발생했습니다."),
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "C002", "잘못된 요청입니다."),
    INVALID_PARAMETER(HttpStatus.BAD_REQUEST, "C003", "잘못된 파라미터입니다."),
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND, "C004", "요청한 리소스를 찾을 수 없습니다."),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "C005", "지원하지 않는 HTTP 메서드입니다."),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "C006", "지원하지 않는 미디어 타입입니다."),
    
    // 인증/인가 관련 오류
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "C101", "인증이 필요합니다."),
    ACCESS_DENIED(HttpStatus.FORBIDDEN, "C102", "접근 권한이 없습니다."),
    INVALID_TOKEN(HttpStatus.UNAUTHORIZED, "C103", "유효하지 않은 토큰입니다."),
    EXPIRED_TOKEN(HttpStatus.UNAUTHORIZED, "C104", "만료된 토큰입니다."),
    
    // 데이터 처리 관련 오류
    DUPLICATE_RESOURCE(HttpStatus.CONFLICT, "C201", "이미 존재하는 리소스입니다."),
    DATA_INTEGRITY_VIOLATION(HttpStatus.CONFLICT, "C202", "데이터 무결성 위반이 발생했습니다."),
    
    // 통신 관련 오류
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "C301", "서비스를 사용할 수 없습니다."),
    EXTERNAL_SERVICE_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "C302", "외부 서비스 오류가 발생했습니다."),
    TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "C303", "서비스 요청 시간이 초과되었습니다.");
    
    private final HttpStatus status;
    private final String code;
    private final String message;
} 