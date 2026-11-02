package com.taskflow.backend.task.service;

import com.taskflow.backend.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Tests strict parsing of strong version entity tags.
 */
class IfMatchVersionTest {
    @Test
    void parsesQuotedDecimalVersions() {
        assertThat(IfMatchVersion.parse("\"0\"")).isZero();
        assertThat(IfMatchVersion.parse("\"42\"")).isEqualTo(42L);
    }

    @Test
    void rejectsMissingAndMalformedTagsWithContractStatuses() {
        assertStatus(null, HttpStatus.PRECONDITION_REQUIRED);
        assertStatus("W/\"1\"", HttpStatus.BAD_REQUEST);
        assertStatus("*", HttpStatus.BAD_REQUEST);
        assertStatus("\"01\"", HttpStatus.BAD_REQUEST);
        assertStatus("\"2147483648\"", HttpStatus.BAD_REQUEST);
    }

    private void assertStatus(String header, HttpStatus status) {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> IfMatchVersion.parse(header))
                .isInstanceOf(ApiException.class)
                .extracting("status").isEqualTo(status);
    }
}
