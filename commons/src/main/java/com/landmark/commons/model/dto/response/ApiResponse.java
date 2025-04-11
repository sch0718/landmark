package com.landmark.commons.model.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.HttpStatus;

import com.landmark.commons.exception.ServiceErrorCode;

import java.time.LocalDateTime;

/**
 * API 응답을 위한 공통 응답 클래스입니다.
 * 모든 API 응답의 일관성을 유지하기 위해 사용됩니다.
 *
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0-SNAPSHOT
 * @since 2024-04-07
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiResponse<T> {

    /**
     * 응답 결과 성공 여부
     */
    private boolean success;
    
    /**
     * 응답 코드
     */
    private int code;
    
    /**
     * 응답 메시지
     */
    private String message;
    
    /**
     * 응답 데이터
     */
    private T data;
    
    /**
     * 응답 시간
     */
    private LocalDateTime timestamp;

    /**
     * 트레이스 ID
     */
    private String traceId;

    /**
     * 성공 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param data 응답 데이터
     * @param traceId 트레이스 ID
     * @return 성공 응답 객체
     */
    public static <T> ApiResponse<T> success(T data, String traceId) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(HttpStatus.OK.value())
                .message("요청이 성공적으로 처리되었습니다.")
                .data(data)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 성공 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param data 응답 데이터
     * @param message 응답 메시지
     * @param traceId 트레이스 ID
     * @return 성공 응답 객체
     */
    public static <T> ApiResponse<T> success(T data, String message, String traceId) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(HttpStatus.OK.value())
                .message(message)
                .data(data)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 성공 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param data 응답 데이터
     * @param httpStatus HTTP 상태 코드
     * @param message 응답 메시지
     * @param traceId 트레이스 ID
     * @return 성공 응답 객체
     */
    public static <T> ApiResponse<T> success(T data, HttpStatus httpStatus, String message, String traceId) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(httpStatus.value())
                .message(message)
                .data(data)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 성공 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param message 응답 메시지
     * @param traceId 트레이스 ID
     * @return 성공 응답 객체
     */
    public static <T> ApiResponse<T> success(String message, String traceId) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(HttpStatus.OK.value())
                .message(message)
                .data(null)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 성공 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param httpStatus HTTP 상태 코드
     * @param message 응답 메시지
     * @param traceId 트레이스 ID
     * @return 성공 응답 객체
     */
    public static <T> ApiResponse<T> success(HttpStatus httpStatus, String message, String traceId) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(httpStatus.value())
                .message(message)
                .data(null)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 실패 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param errorCode 서비스별 오류 코드
     * @param traceId 트레이스 ID
     * @return 실패 응답 객체
     */
    public static <T> ApiResponse<T> error(ServiceErrorCode errorCode, String traceId) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(errorCode.getStatus().value())
                .message(errorCode.getMessage())
                .data(null)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 실패 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param errorCode 일반 오류 코드
     * @param data 응답 데이터
     * @param traceId 트레이스 ID
     * @return 실패 응답 객체
     */
    public static <T> ApiResponse<T> error(ServiceErrorCode errorCode, T data, String traceId) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(errorCode.getStatus().value())
                .message(errorCode.getMessage())
                .data(data)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 실패 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param httpStatus HTTP 상태 코드
     * @param message 오류 메시지
     * @param data 응답 데이터
     * @param traceId 트레이스 ID
     * @return 실패 응답 객체
     */
    public static <T> ApiResponse<T> error(HttpStatus httpStatus, String message, T data, String traceId) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(httpStatus.value())
                .message(message)
                .data(data)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }

    /**
     * 실패 응답을 생성합니다.
     *
     * @param <T> 응답 데이터 타입
     * @param httpStatus HTTP 상태 코드
     * @param message 오류 메시지
     * @param traceId 트레이스 ID
     * @return 실패 응답 객체
     */
    public static <T> ApiResponse<T> error(HttpStatus httpStatus, String message, String traceId) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(httpStatus.value())
                .message(message)
                .data(null)
                .timestamp(LocalDateTime.now())
                .traceId(traceId)
                .build();
    }
    
} 