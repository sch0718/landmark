package com.landmark.commons.exception;

import org.springframework.stereotype.Component;

import io.micrometer.tracing.Tracer;

/**
 * 트레이스 ID와 스팬 ID를 관리하는 클래스
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-10
 */
@Component
public class TraceContext {

    private static Tracer tracer;

    /**
     * Tracer 빈을 주입받습니다.
     * 
     * @param tracer Tracer 빈
     */
    public TraceContext(Tracer tracer) {
        TraceContext.tracer = tracer;
    }

    /**
     * 현재 트레이스 ID를 반환합니다.
     * 
     * @return 현재 트레이스 ID
     */
    public static String getCurrentTraceId() {
        if (tracer != null && tracer.currentSpan() != null) {
            return tracer.currentSpan().context().traceId();
        }
        return "unknown";
    }

    /**
     * 현재 스팬 ID를 반환합니다.
     * 
     * @return 현재 스팬 ID
     */
    public static String getCurrentSpanId() {
        if (tracer != null && tracer.currentSpan() != null) {
            return tracer.currentSpan().context().spanId();
        }
        return "unknown";
    }
}
