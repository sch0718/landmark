package com.landmark.commons.model;

import java.io.Serializable;

import org.springframework.data.domain.Persistable;

import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

import jakarta.persistence.MappedSuperclass;


/**
 * 모든 Entity가 상속받을 기본 엔티티의 추상 클래스입니다.
 * 기본적인 감사(Audit) 정보를 포함합니다.
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Getter
@Setter
@ToString
@MappedSuperclass
public abstract class AbstractBaseEntity<ID extends Serializable> extends AuditEntity implements Persistable<ID> {
    
    private static final long serialVersionUID = 1L;

    /**
     * 엔티티가 새로 생성된 것인지 여부를 반환합니다.
     * ID가 null이면 새로 생성된 것으로 간주합니다.
     * 
     * @return ID가 null이면 true, 아니면 false
     */
    @Override
    public boolean isNew() {
        return null == getId();
    }

    /**
     * ID를 반환합니다. 하위 클래스에서 구현해야 합니다.
     * 
     * @return 엔티티의 ID
     */
    @Override
    public abstract ID getId();
}
