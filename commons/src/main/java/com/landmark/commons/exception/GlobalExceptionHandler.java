package com.landmark.commons.exception;

import com.landmark.commons.model.dto.response.ApiResponse;

import lombok.extern.slf4j.Slf4j;

import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.HashMap;
import java.util.Map;

/**
 * 모든 마이크로서비스에서 공통으로 발생하는 예외를 처리하는 핸들러입니다.
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    /**
     * 커스텀 기본 예외 처리
     */
    @ExceptionHandler(BaseException.class)
    public ResponseEntity<ApiResponse<Object>> handleBaseException(BaseException ex) {
        log.error("BaseException: {}, TraceId: {}", ex.getMessage(), ex.getTraceId());
        return ResponseEntity
            .status(ex.getStatus())
            .body(ApiResponse.error(ex.getStatus(), ex.getMessage(), ex.getTraceId()));
    }

    /**
     * 유효성 검사 예외 처리
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Map<String, String>>> handleValidationExceptions(
            MethodArgumentNotValidException ex) {
        
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error -> 
            errors.put(error.getField(), error.getDefaultMessage())
        );

        String traceId = TraceContext.getCurrentTraceId();
        
        log.error("Validation error: {}, TraceId: {}", errors, traceId);
        
        return new ResponseEntity<>(
            ApiResponse.error(CommonErrorCode.INVALID_REQUEST, errors, traceId), CommonErrorCode.INVALID_REQUEST.getStatus());
    }
    
    /**
     * 바인딩 예외 처리
     */
    @ExceptionHandler(BindException.class)
    public ResponseEntity<ApiResponse<Map<String, String>>> handleBindExceptions(
            BindException ex) {
        
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error -> 
            errors.put(error.getField(), error.getDefaultMessage())
        );

        String traceId = TraceContext.getCurrentTraceId();
        
        log.error("Binding error: {}, TraceId: {}", errors, traceId);
        
        return new ResponseEntity<>(
            ApiResponse.error(CommonErrorCode.INVALID_REQUEST, errors, traceId), CommonErrorCode.INVALID_REQUEST.getStatus());
    }
    
    /**
     * 메서드 인자 타입 불일치 예외 처리
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<Object>> handleTypeMismatch(
            MethodArgumentTypeMismatchException ex) {
        
        String error = String.format("%s 파라미터는 %s 타입이어야 합니다", 
                ex.getName(), ex.getRequiredType().getSimpleName());

        String traceId = TraceContext.getCurrentTraceId();
                
        log.error("Type mismatch: {}, TraceId: {}", error, traceId);
        
        return new ResponseEntity<>(
                ApiResponse.error(CommonErrorCode.INVALID_REQUEST, error, traceId), CommonErrorCode.INVALID_REQUEST.getStatus());
    }
    
    /**
     * 기타 모든 예외 처리
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Object>> handleAllExceptions(Exception ex) {
        String traceId = TraceContext.getCurrentTraceId();
        
        log.error("Unhandled exception: {}, TraceId: {}", ex.getMessage(), traceId);
        
        return new ResponseEntity<>(
                ApiResponse.error(CommonErrorCode.INTERNAL_SERVER_ERROR, traceId), CommonErrorCode.INTERNAL_SERVER_ERROR.getStatus());
    }
} 