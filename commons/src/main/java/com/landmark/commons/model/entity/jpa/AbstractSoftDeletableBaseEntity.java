package com.landmark.commons.model.entity.jpa;

import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PreUpdate;

import java.io.Serializable;
import java.time.LocalDateTime;

import com.landmark.commons.model.entity.common.SoftDeletable;

import jakarta.persistence.Column;

import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
/**
 * 소프트 삭제 가능한 Entity의 추상 클래스입니다.
 * 삭제 여부와 삭제 시간 정보를 관리합니다.
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Getter
@Setter
@ToString
@MappedSuperclass
public abstract class AbstractSoftDeletableBaseEntity<ID extends Serializable> extends AbstractBaseEntity<ID> implements SoftDeletable {
    
    private static final long serialVersionUID = 1L;

    /**
     * 삭제 여부
     */
    @Column(name = "is_deleted")
    private boolean isDeleted;

    /**
     * 삭제 일시
     */
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;
    
    /**
     * 엔티티가 업데이트되기 전에 호출되는 메서드입니다.
     * isDeleted가 true로 설정되었으나 deletedAt이 null인 경우
     * 현재 시간으로 deletedAt을 설정합니다.
     */
    @PreUpdate
    protected void onUpdate() {
        if (isDeleted && deletedAt == null) {
            deletedAt = LocalDateTime.now();
        }
    }
}
