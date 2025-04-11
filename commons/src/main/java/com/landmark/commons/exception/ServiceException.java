package com.landmark.commons.exception;

import lombok.Getter;
import lombok.ToString;

/**
 * 모든 서비스에서 사용할 수 있는 기본 예외 클래스
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Getter
@ToString(callSuper = true)
public class ServiceException extends BaseException {
    
    private static final long serialVersionUID = 1L;

    private final ServiceErrorCode errorCode;
    
    /**
     * 서비스 에러 코드로 예외를 생성합니다.
     * 
     * @param errorCode 서비스 에러 코드
     */
    public ServiceException(ServiceErrorCode errorCode) {
        super(errorCode.getStatus(), errorCode.getMessage());
        this.errorCode = errorCode;
    }
    
    /**
     * 사용자 정의 메시지와 서비스 에러 코드로 예외를 생성합니다.
     * 
     * @param errorCode 서비스 에러 코드
     * @param message 사용자 정의 메시지
     */
    public ServiceException(ServiceErrorCode errorCode, String message) {
        super(errorCode.getStatus(), message);
        this.errorCode = errorCode;
    }
    
    /**
     * 원인 예외와 함께 서비스 에러 코드로 예외를 생성합니다.
     * 
     * @param errorCode 서비스 에러 코드
     * @param cause 원인 예외
     */
    public ServiceException(ServiceErrorCode errorCode, Throwable cause) {
        super(errorCode.getStatus(), errorCode.getMessage(), cause);
        this.errorCode = errorCode;
    }
    
    /**
     * 사용자 정의 메시지, 서비스 에러 코드, 원인 예외로 예외를 생성합니다.
     * 
     * @param errorCode 서비스 에러 코드
     * @param message 사용자 정의 메시지
     * @param cause 원인 예외
     */
    public ServiceException(ServiceErrorCode errorCode, String message, Throwable cause) {
        super(errorCode.getStatus(), message, cause);
        this.errorCode = errorCode;
    }
} 