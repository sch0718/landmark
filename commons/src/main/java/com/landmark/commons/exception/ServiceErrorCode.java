package com.landmark.commons.exception;

import org.springframework.http.HttpStatus;

/**
 * 모든 서비스의 에러 코드를 정의하는 인터페이스
 * 모든 서비스별 에러 코드 열거형은 이 인터페이스를 구현해야 함
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
public interface ServiceErrorCode {
    
    /**
     * HTTP 상태 코드를 반환
     * 
     * @return HTTP 상태 코드
     */
    HttpStatus getStatus();
    
    /**
     * 에러 코드를 반환
     * 
     * @return 에러 코드 문자열
     */
    String getCode();
    
    /**
     * 에러 메시지를 반환
     * 
     * @return 에러 메시지
     */
    String getMessage();
} 