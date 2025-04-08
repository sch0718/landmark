package com.landmark.commons.config;

import com.landmark.commons.dto.ResponseDTO;
import com.landmark.commons.exception.BaseException;
import com.landmark.commons.exception.ResourceNotFoundException;

import lombok.extern.slf4j.Slf4j;

import org.springframework.http.HttpStatus;
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
        log.error("BaseException: {}", ex.getMessage());
        return new ResponseEntity<>(
            ApiResponse.error(ex.getStatus(), ex.getMessage()), ex);
    }
    
    /**
     * 리소스를 찾을 수 없을 때 예외 처리
     */
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiResponse<Object>> handleResourceNotFoundException(ServiceException ex) {
        log.error("ServiceException: {}", ex.getMessage());
        return new ResponseEntity<>(
            ApiResponse.error(ex.getErrorCode(), ex.getMessage()), ex);
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
        
        log.error("Validation error: {}", errors);
        
        return new ResponseEntity<>(
            ApiResponse.error("유효성 검사에 실패했습니다.").data(errors), HttpStatus.BAD_REQUEST);
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
        
        log.error("Binding error: {}", errors);
        
        return new ResponseEntity<>(
            ApiResponse.error("데이터 바인딩에 실패했습니다.").data(errors), HttpStatus.BAD_REQUEST);
    }
    
    /**
     * 메서드 인자 타입 불일치 예외 처리
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<Object>> handleTypeMismatch(
            MethodArgumentTypeMismatchException ex) {
        
        String error = String.format("%s 파라미터는 %s 타입이어야 합니다", 
                ex.getName(), ex.getRequiredType().getSimpleName());
        
        log.error("Type mismatch: {}", error);
        
        return new ResponseEntity<>(
                ApiResponse.error(error), HttpStatus.BAD_REQUEST);
    }
    
    /**
     * 기타 모든 예외 처리
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Object>> handleAllExceptions(Exception ex) {
        log.error("Unhandled exception", ex);
        
        return new ResponseEntity<>(
                ApiResponse.error("서버 내부 오류가 발생했습니다."), HttpStatus.INTERNAL_SERVER_ERROR);
    }
} 