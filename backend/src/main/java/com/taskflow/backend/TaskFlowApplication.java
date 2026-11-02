package com.taskflow.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Starts the local TaskFlow REST application.
 */
@SpringBootApplication
public class TaskFlowApplication {

    /**
     * Boots the Spring application using the active environment configuration.
     *
     * @param args command-line arguments passed to Spring Boot
     */
    public static void main(String[] args) {
        SpringApplication.run(TaskFlowApplication.class, args);
    }
}
