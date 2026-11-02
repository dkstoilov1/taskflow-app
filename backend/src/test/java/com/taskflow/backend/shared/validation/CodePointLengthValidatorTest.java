package com.taskflow.backend.shared.validation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Tests the custom Unicode code-point length constraint.
 */
@ExtendWith(MockitoExtension.class)
class CodePointLengthValidatorTest {
    @Mock
    private CodePointLength constraint;

    private CodePointLengthValidator validator;

    @BeforeEach
    void setUp() {
        when(constraint.max()).thenReturn(2);
        when(constraint.trim()).thenReturn(true);
        validator = new CodePointLengthValidator();
        validator.initialize(constraint);
    }

    @Test
    void acceptsNullAndTrimmedValuesWithinLimit() {
        assertThat(validator.isValid(null, null)).isTrue();
        assertThat(validator.isValid("  A🚀 ", null)).isTrue();
    }

    @Test
    void rejectsValuesThatExceedCodePointLimit() {
        assertThat(validator.isValid("A🚀B", null)).isFalse();
    }
}
