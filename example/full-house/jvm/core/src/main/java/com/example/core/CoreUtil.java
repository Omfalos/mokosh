package com.example.core;

/** Shared helper living in a separate Gradle module (":core"). */
// @tag core
public final class CoreUtil {
    private CoreUtil() {}

    public static String shout(String value) {
        return value.toUpperCase() + "!";
    }
}
