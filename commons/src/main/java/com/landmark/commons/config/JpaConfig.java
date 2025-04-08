package com.landmark.commons.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

/**
 * JPA 관련 설정을 담당하는 설정 클래스입니다.
 * JPA Auditing 기능을 활성화하여 엔티티의 생성자, 수정자, 생성 시간, 수정 시간 등을
 * 자동으로 관리합니다.
 * 
 * @author 신춘호 (sch0718@naver.com)
 * @version 1.0.0
 * @since 2025-04-07
 */
@Configuration
@EnableJpaAuditing
public class JpaConfig {

    /**
     * 현재 인증된 사용자의 ID를 Auditor로 제공하는 빈을 등록합니다.
     * Spring Security의 SecurityContextHolder를 통해 현재 인증된 사용자 정보를 가져옵니다.
     * 인증된 사용자가 없는 경우 "system"을 기본값으로 사용합니다.
     *
     * @return 현재 사용자 ID를 제공하는 AuditorAware 구현체
     */
    @Bean
    public AuditorAware<String> auditorProvider() {
        return () -> {
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            
            if (authentication == null || !authentication.isAuthenticated()) {
                return Optional.of("system");
            }
            
            return Optional.of(authentication.getName());
        };
    }
} 