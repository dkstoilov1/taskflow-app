package com.taskflow.backend.shared.validation;

import com.taskflow.backend.shared.text.UnicodeText;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Applies {@link CodePointLength} to string values.
 */
public final class CodePointLengthValidator implements ConstraintValidator<CodePointLength, String> {

    private int maximum;
    private boolean trim;

    /**
     * Initializes the validator with the annotation's inclusive maximum.
     *
     * @param constraintAnnotation the constraint configuration
     */
    @Override
    public void initialize(CodePointLength constraintAnnotation) {
        maximum = constraintAnnotation.max();
        trim = constraintAnnotation.trim();
    }

    /**
     * Accepts null values and checks non-null values by Unicode code point count.
     *
     * @param value text being validated
     * @param context validation context supplied by Bean Validation
     * @return {@code true} when the value is null or within the configured maximum
     */
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        String measuredValue = trim ? UnicodeText.trim(value) : value;
        return UnicodeText.codePointLength(measuredValue) <= maximum;
    }
}
