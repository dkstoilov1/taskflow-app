package com.taskflow.backend.shared.text;

/**
 * Unicode helpers aligned with JavaScript string trimming and code-point counting.
 */
public final class UnicodeText {

    private UnicodeText() {
    }

    /**
     * Trims the ECMAScript whitespace code points used by the TaskFlow client.
     *
     * @param value text to trim, or {@code null}
     * @return the trimmed text, or {@code null} when the input is {@code null}
     */
    public static String trim(String value) {
        if (value == null) {
            return null;
        }
        int start = 0;
        int end = value.length();
        while (start < end && isEcmaScriptWhitespace(value.codePointAt(start))) {
            start += Character.charCount(value.codePointAt(start));
        }
        while (end > start && isEcmaScriptWhitespace(value.codePointBefore(end))) {
            end -= Character.charCount(value.codePointBefore(end));
        }
        return value.substring(start, end);
    }

    /**
     * Counts Unicode code points rather than UTF-16 code units.
     *
     * @param value non-null text to count
     * @return the number of Unicode code points in the text
     */
    public static int codePointLength(String value) {
        return value.codePointCount(0, value.length());
    }

    private static boolean isEcmaScriptWhitespace(int codePoint) {
        return codePoint == 0x0009
                || codePoint == 0x000A
                || codePoint == 0x000B
                || codePoint == 0x000C
                || codePoint == 0x000D
                || codePoint == 0x0020
                || codePoint == 0x00A0
                || codePoint == 0xFEFF
                || codePoint == 0x2028
                || codePoint == 0x2029
                || Character.getType(codePoint) == Character.SPACE_SEPARATOR;
    }
}
