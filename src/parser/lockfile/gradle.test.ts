import { describe, expect, test } from "vitest";
import { parseGradleBuildScript, parseGradleLockfile, parseGradleVersionCatalog } from "./gradle";

describe("Gradle dependency readers", { tags: ["lockfile", "jvm", "gradle"] }, () => {
  test("parseGradleVersionCatalog resolves version.ref and shorthand strings", () => {
    const toml = `
[versions]
okhttp = "4.12.0"
retrofit = "2.9.0"

[libraries]
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }
okhttp-logging = { group = "com.squareup.okhttp3", name = "logging-interceptor", version = "4.11.0" }
retrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }
gson = "com.google.code.gson:gson:2.10.1"   # shorthand
`;
    const deps = parseGradleVersionCatalog(toml);
    // last artifact in a group wins
    expect(deps["com.squareup.okhttp3"]).toBe("4.11.0");
    expect(deps["com.squareup.retrofit2"]).toBe("2.9.0");
    expect(deps["com.google.code.gson"]).toBe("2.10.1");
  });

  test("parseGradleLockfile reads exact resolved versions", () => {
    const lock = `# Gradle generated
com.squareup.okhttp3:okhttp:4.12.0=compileClasspath,runtimeClasspath
org.jetbrains.kotlin:kotlin-stdlib:1.9.0=compileClasspath
empty=annotationProcessor
`;
    const deps = parseGradleLockfile(lock);
    expect(deps["com.squareup.okhttp3"]).toBe("4.12.0");
    expect(deps["org.jetbrains.kotlin"]).toBe("1.9.0");
    expect(Object.keys(deps)).toHaveLength(2);
  });

  test("parseGradleBuildScript extracts string-literal coordinates and skips placeholders", () => {
    const script = `
dependencies {
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation 'com.google.code.gson:gson:2.10.1'
  api group: 'org.apache.commons', name: 'commons-lang3', version: '3.14.0'
  implementation "org.example:lib:$libVersion"
}
`;
    const deps = parseGradleBuildScript(script);
    expect(deps["com.squareup.okhttp3"]).toBe("4.12.0");
    expect(deps["com.google.code.gson"]).toBe("2.10.1");
    expect(deps["org.apache.commons"]).toBe("3.14.0");
    expect(deps["org.example"]).toBeUndefined();
  });
});
