import { describe, expect, test } from "vitest";
import { parseSbtBuild } from "./sbt";

describe("sbt dependency reader", { tags: ["lockfile", "jvm", "sbt"] }, () => {
  test("parseSbtBuild handles %% and % operator forms", () => {
    const sbt = `
libraryDependencies ++= Seq(
  "org.typelevel" %% "cats-core" % "2.10.0",
  "org.scalatest" %% "scalatest" % "3.2.17" % Test
)
libraryDependencies += "com.squareup.okhttp3" % "okhttp" % "4.12.0"
`;
    const deps = parseSbtBuild(sbt);
    expect(deps["org.typelevel"]).toBe("2.10.0");
    expect(deps["org.scalatest"]).toBe("3.2.17");
    expect(deps["com.squareup.okhttp3"]).toBe("4.12.0");
  });
});
