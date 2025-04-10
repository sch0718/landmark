package com.landmark.commons.model;

import java.io.Serializable;
import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.MappedSuperclass;

import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
/**
 * 등록/수정 정보를 자동으로 업데이트 할 수 있도록 구현.
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Getter
@Setter
@ToString
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public class AuditEntity implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
	 * 등록 사용자 ID
	 */
	@CreatedBy
	@Column(name = "created_by", updatable = false)
	private String createdBy;

    /**
	 * 등록 일시
	 */
	@CreatedDate
	@Column(name = "created_at", nullable = false, updatable = false)
	private LocalDateTime createdAt;

    /**
	 * 최종 수정 사용자 ID
	 */
	@LastModifiedBy
	@Column(name = "last_modified_by")
	private String lastModifiedBy;

    /**
	 * 최종 수정 일시
	 */
	@LastModifiedDate
	@Column(name = "updated_at")
	private LocalDateTime updatedAt;
}
