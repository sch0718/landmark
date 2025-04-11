package com.landmark.commons.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import feign.RequestInterceptor;
import com.landmark.commons.exception.TraceContext;

/**
 * Feign 설정 클래스
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-10
 */
@Configuration
public class FeignConfig {
    
    /**
     * 트레이스 ID를 헤더에 추가하는 RequestInterceptor 빈을 생성합니다.
     * 
     * @return 트레이스 ID를 헤더에 추가하는 RequestInterceptor
     */
    @Bean
    public RequestInterceptor tracingRequestInterceptor() {
        return requestTemplate -> {
            String traceId = TraceContext.getCurrentTraceId();
            if (!"unknown".equals(traceId)) {
                requestTemplate.header("X-Trace-Id", traceId);
            }
        };
    }
}
