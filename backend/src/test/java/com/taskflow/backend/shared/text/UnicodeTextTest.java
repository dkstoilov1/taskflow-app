package com.taskflow.backend.shared.text;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests JavaScript-compatible whitespace trimming and Unicode counting.
 */
class UnicodeTextTest {
    @Test
    void trimsEcmaWhitespaceWithoutChangingInternalWhitespace() {
        assertThat(UnicodeText.trim("\uFEFF\u00A0  title \t\n")).isEqualTo("title");
        assertThat(UnicodeText.trim("  keep  inner  ")).isEqualTo("keep  inner");
        assertThat(UnicodeText.trim(null)).isNull();
    }

    @Test
    void countsSupplementaryCharactersAsOneCodePoint() {
        assertThat(UnicodeText.codePointLength("A\uD83D\uDE80B")).isEqualTo(3);
    }
}
