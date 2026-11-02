package com.taskflow.backend.task.service;

import com.taskflow.backend.shared.api.ApiException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses the TaskFlow strong version ETag required by task mutations.
 */
public final class IfMatchVersion {

    private static final Pattern STRONG_VERSION = Pattern.compile("^\"(0|[1-9][0-9]*)\"$");

    private IfMatchVersion() {
    }

    /**
     * Parses a quoted decimal task version or raises the contract-specific precondition error.
     *
     * @param header raw If-Match header, possibly absent
     * @return parsed non-negative task version
     * @throws ApiException with 428 when absent or 400 when malformed/out of range
     */
    public static int parse(String header) {
        if (header == null) {
            throw ApiException.missingPrecondition();
        }
        Matcher matcher = STRONG_VERSION.matcher(header);
        if (!matcher.matches()) {
            throw ApiException.invalidIfMatch();
        }
        try {
            return Integer.parseInt(matcher.group(1));
        } catch (NumberFormatException exception) {
            throw ApiException.invalidIfMatch();
        }
    }
}
