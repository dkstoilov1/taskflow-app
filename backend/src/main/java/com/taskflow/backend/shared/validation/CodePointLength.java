package com.taskflow.backend.shared.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Validates a text value's length using Unicode code points.
 */
@Documented
@Constraint(validatedBy = CodePointLengthValidator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT, ElementType.ANNOTATION_TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface CodePointLength {

    /**
     * Returns the validation message template.
     *
     * @return the message template
     */
    String message() default "must contain at most {max} Unicode code points";

    /**
     * Returns the validation groups.
     *
     * @return validation groups
     */
    Class<?>[] groups() default {};

    /**
     * Returns the validation payload types.
     *
     * @return validation payload types
     */
    Class<? extends Payload>[] payload() default {};

    /**
     * Returns the maximum permitted number of code points.
     *
     * @return the inclusive maximum
     */
    int max();

    /**
     * Indicates whether leading and trailing ECMAScript whitespace is excluded from the count.
     *
     * @return true to trim before counting
     */
    boolean trim() default false;
}
