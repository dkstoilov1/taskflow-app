package com.taskflow.backend.config;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;

/**
 * Configures strict JSON input semantics for textual API fields.
 */
@Configuration(proxyBeanMethods = false)
public class TaskJsonConfiguration {

    /**
     * Rejects numeric and boolean values instead of coercing them into JSON strings.
     *
     * @return the Jackson mapper customization used by Spring MVC
     */
    @Bean
    public JsonMapperBuilderCustomizer strictTextCoercion() {
        return builder -> builder.withCoercionConfig(String.class, coercion -> {
            coercion.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail);
            coercion.setCoercion(CoercionInputShape.Float, CoercionAction.Fail);
            coercion.setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail);
        });
    }
}
