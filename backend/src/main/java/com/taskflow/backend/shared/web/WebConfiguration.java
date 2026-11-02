package com.taskflow.backend.shared.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers local-origin protection for state-changing HTTP operations.
 */
@Configuration
public class WebConfiguration implements WebMvcConfigurer {

    private final OriginProtectionInterceptor originProtectionInterceptor;

    /**
     * Creates MVC configuration with the local-origin guard.
     *
     * @param originProtectionInterceptor state-changing request guard
     */
    public WebConfiguration(OriginProtectionInterceptor originProtectionInterceptor) {
        this.originProtectionInterceptor = originProtectionInterceptor;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(originProtectionInterceptor);
    }
}
