package com.landmark.commons.model;

import java.time.LocalDateTime;

/**
 * 소프트 삭제가 가능한 엔티티가 구현해야 하는 인터페이스입니다.
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
public interface SoftDeletable {
    
    /**
     * 엔티티의 삭제 여부를 반환합니다.
     * 
     * @return 삭제되었으면 true, 아니면 false
     */
    boolean isDeleted();
    
    /**
     * 엔티티의 삭제 여부를 설정합니다.
     * 
     * @param deleted 삭제 여부
     */
    void setDeleted(boolean deleted);
    
    /**
     * 엔티티가 삭제된 시간을 반환합니다.
     * 
     * @return 삭제 시간, 삭제되지 않았으면 null
     */
    LocalDateTime getDeletedAt();
    
    /**
     * 엔티티가 삭제된 시간을 설정합니다.
     * 
     * @param deletedAt 삭제 시간
     */
    void setDeletedAt(LocalDateTime deletedAt);
} 