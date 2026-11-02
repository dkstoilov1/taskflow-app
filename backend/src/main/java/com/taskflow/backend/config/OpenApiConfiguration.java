package com.taskflow.backend.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Describes the TaskFlow API for generated OpenAPI and Swagger UI documents.
 */
@Configuration
public class OpenApiConfiguration {

    /**
     * Provides the public API title, version, and purpose.
     *
     * @return TaskFlow OpenAPI document metadata
     */
    @Bean
    public OpenAPI taskFlowOpenApi() {
        return new OpenAPI().info(new Info()
                .title("TaskFlow API")
                .version("1.0.0")
                .description("Local single-user task management API. See docs/api.md for the canonical contract."));
    }
}
