package com.landmark.commons.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.HttpStatus;

import com.landmark.commons.exception.CommonErrorCode;

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
     * 성공 응답을 생성합니다.
     *
     * @param data 응답 데이터
     * @param <T> 데이터 타입
     * @return ApiResponse 객체
     */
    public static <T> ApiResponse<T> success(T data) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(HttpStatus.OK.value())
                .message("요청이 성공적으로 처리되었습니다.")
                .data(data)
                .timestamp(LocalDateTime.now())
                .build();
    }

    /**
     * 성공 응답을 생성합니다.
     *
     * @param message 응답 메시지
     * @param data 응답 데이터
     * @param <T> 데이터 타입
     * @return ApiResponse 객체
     */
    public static <T> ApiResponse<T> success(String message, T data) {
        return ApiResponse.<T>builder()
                .success(true)
                .code(HttpStatus.OK.value())
                .message(message)
                .data(data)
                .timestamp(LocalDateTime.now())
                .build();
    }

    /**
     * 에러 응답을 생성합니다.
     *
     * @param code 에러 코드
     * @param message 에러 메시지
     * @param <T> 데이터 타입
     * @return ApiResponse 객체
     */
    public static <T> ApiResponse<T> error(int code, String message) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(code)
                .message(message)
                .data(null)
                .timestamp(LocalDateTime.now())
                .build();
    }

    /**
     * 에러 응답을 생성합니다.
     *
     * @param httpStatus HttpStatus 객체
     * @param message 에러 메시지
     * @param <T> 데이터 타입
     * @return ApiResponse 객체
     */
    public static <T> ApiResponse<T> error(HttpStatus httpStatus, String message) {
        return error(httpStatus.value(), message);
    }

    /**
     * 공통 에러 코드를 사용하여 에러 응답을 생성합니다.
     *
     * @param errorCode 공통 에러 코드
     * @param <T> 데이터 타입
     * @return ApiResponse 객체
     */
    public static <T> ApiResponse<T> error(CommonErrorCode errorCode) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(Integer.parseInt(errorCode.getCode()))
                .message(errorCode.getMessage())
                .timestamp(LocalDateTime.now())
                .build();
    }

    /**
     * 공통 에러 코드와 사용자 정의 메시지를 사용하여 에러 응답을 생성합니다.
     *
     * @param errorCode 공통 에러 코드
     * @param message 사용자 정의 메시지
     * @param <T> 데이터 타입
     * @return ApiResponse 객체
     */
    public static <T> ApiResponse<T> error(CommonErrorCode errorCode, String message) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(Integer.parseInt(errorCode.getCode()))
                .message(message)
                .timestamp(LocalDateTime.now())
                .build();
    }
} 