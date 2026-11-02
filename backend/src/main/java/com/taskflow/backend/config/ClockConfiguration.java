package com.taskflow.backend.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Provides an injectable UTC server clock for completion and calendar calculations.
 */
@Configuration(proxyBeanMethods = false)
public class ClockConfiguration {

    /**
     * Creates the UTC wall clock used by application services.
     *
     * @return system clock configured for UTC
     */
    @Bean
    public Clock taskFlowClock() {
        return Clock.systemUTC();
    }
}
