package com.landmark.commons.model.entity.common;

import java.time.LocalDateTime;

/**
 * 등록/수정 정보를 자동으로 업데이트 할 수 있도록 구현.
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-10
 */
public interface Auditable {

    /**
     * 등록 사용자 ID를 반환합니다.
     * 
     * @return 등록 사용자 ID
     */
    String getCreatedBy();

    /**
     * 등록 사용자 ID를 설정합니다.
     * 
     * @param createdBy 등록 사용자 ID
     */
    void setCreatedBy(String createdBy);

    /**
     * 등록 일시를 반환합니다.
     * 
     * @return 등록 일시
     */
    LocalDateTime getCreatedAt();

    /**
     * 등록 일시를 설정합니다.
     * 
     * @param createdAt 등록 일시
     */
    void setCreatedAt(LocalDateTime createdAt);

    /**
     * 최종 수정 사용자 ID를 반환합니다.
     * 
     * @return 최종 수정 사용자 ID
     */
    String getUpdatedBy();

    /**
     * 최종 수정 사용자 ID를 설정합니다.
     * 
     * @param updatedBy 최종 수정 사용자 ID
     */
    void setUpdatedBy(String updatedBy);

    /**
     * 최종 수정 일시를 반환합니다.
     * 
     * @return 최종 수정 일시
     */ 
    LocalDateTime getUpdatedAt();

    /**
     * 최종 수정 일시를 설정합니다.
     * 
     * @param updatedAt 최종 수정 일시
     */
    void setUpdatedAt(LocalDateTime updatedAt);
}
