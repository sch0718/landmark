package com.landmark.commons.model;

import javax.persistence.MappedSuperclass;
import javax.persistence.PreUpdate;

import java.time.LocalDateTime;

import javax.persistence.Column;

import org.springframework.format.annotation.DateTimeFormat;

import com.fasterxml.jackson.annotation.JsonFormat;

import lombok.Getter;
import lombok.Setter;

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
@MappedSuperclass
public class AbstractSoftDeletableBaseEntity extends AbstractBaseModel<String> implements SoftDeletable {
    
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

    @Override
    public boolean isDeleted() {
        return isDeleted;
    }

    @Override
    public void setDeleted(boolean deleted) {
        this.isDeleted = deleted;
    }

    @Override
    public LocalDateTime getDeletedAt() {
        return deletedAt;
    }

    @Override
    public void setDeletedAt(LocalDateTime deletedAt) {
        this.deletedAt = deletedAt;
    }
}
