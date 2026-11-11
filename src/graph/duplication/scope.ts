import type { DuplicateCluster } from "./clusters";
import type { FindDuplicatesOptions } from "./types";

/** `scope: "tests"` keeps a test cluster only if it clears one of these bars — the point is to
 *  surface shared setup / mocks / assertions worth extracting, not the `render(<X/>);
 *  expect(…).toMatchSnapshot()` skeleton every component test repeats. */
const TEST_SUBSTANTIVE_BLOCKS = 3;
const TEST_SUBSTANTIVE_MAX_FILES = 6;
const TEST_SUBSTANTIVE_TOKENS = 120;

/**
 * @description Whether a cluster's shared test code is substantial enough to be worth surfacing
 *   under `scope: "tests"` — several distinct shared blocks between a small set of files (shared
 *   setup, mocks and assertions copied between two real test suites), or one large shared block.
 *   A cluster that's just one small block repeated across many files is the
 *   `render(<X/>); expect(…).toMatchSnapshot()` skeleton and stays hidden.
 * @param cluster - A built {@link DuplicateCluster}.
 * @returns `true` when the cluster clears one of the substantive-test bars.
 */
function isSubstantiveTestCluster(cluster: DuplicateCluster): boolean {
  const maxTokens = Math.max(0, ...cluster.groups.map((group) => group.tokens));
  if (maxTokens >= TEST_SUBSTANTIVE_TOKENS) return true;
  return (
    cluster.groups.length >= TEST_SUBSTANTIVE_BLOCKS &&
    cluster.files.length <= TEST_SUBSTANTIVE_MAX_FILES
  );
}

/**
 * @description Applies the `scope` option to one cluster. A cluster "involves tests" when any of
 *   its groups carries the `"test"` signal (every group in a cluster shares the same file set, so
 *   this is all-or-nothing per cluster).
 * @param cluster - A built {@link DuplicateCluster}.
 * @param scope - `"src"` drops test clusters, `"tests"` keeps only substantive ones, `"all"`
 *   keeps every cluster.
 * @returns `true` if the cluster should appear in the result under `scope`.
 */
export function clusterInScope(
  cluster: DuplicateCluster,
  scope: NonNullable<FindDuplicatesOptions["scope"]>,
): boolean {
  if (scope === "all") return true;
  const involvesTests = cluster.groups.some((group) => group.signals?.includes("test"));
  return scope === "tests" ? involvesTests && isSubstantiveTestCluster(cluster) : !involvesTests;
}
