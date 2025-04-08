package com.landmark.commons.exception;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.ToString;
import org.springframework.http.HttpStatus;

/**
 * 공통으로 사용할 수 있는 예외의 기본 클래스
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Getter
@ToString(callSuper = true)
public class BaseException extends RuntimeException {
    
    private static final long serialVersionUID = 1L;
    
    private final HttpStatus status;

    /**
     * 상태 코드와 메시지를 받아서 예외를 생성합니다.
     * 
     * @param status 상태 코드
     * @param message 사용자 정의 메시지
     */
    public BaseException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    /**
     * 기본 상태 코드와 메시지를 받아서 예외를 생성합니다.
     */
    public BaseException() {
        this(HttpStatus.INTERNAL_SERVER_ERROR, "서버 오류가 발생했습니다");
    }
    
    /**
     * 상태 코드와 메시지, 원인 예외를 받아서 예외를 생성합니다.
     * 
     * @param status 상태 코드
     * @param message 사용자 정의 메시지
     * @param cause 원인 예외
     */
    public BaseException(HttpStatus status, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
    }
} 