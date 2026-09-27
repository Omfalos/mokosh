/** Registry of all on-demand coverage runners, tried against every scan root in detection order.
 *  Multiple runners may `detect(dir) === true` for the same root (e.g. a polyglot package) — all
 *  matching runners run and their maps merge. */
import type { CoverageRunner } from "../types";
import { goCoverageRunner } from "./go";
import { jsCoverageRunner } from "./js";
import { gradleCoverageRunner } from "./jvm-gradle";
import { sbtCoverageRunner } from "./jvm-sbt";
import { pythonCoverageRunner } from "./python";

export const COVERAGE_RUNNERS: readonly CoverageRunner[] = [
  jsCoverageRunner,
  pythonCoverageRunner,
  goCoverageRunner,
  gradleCoverageRunner,
  sbtCoverageRunner,
];
