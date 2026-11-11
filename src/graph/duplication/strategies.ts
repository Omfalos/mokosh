import type { ScanCorpus } from "./corpus";
import { findJsxElementDuplicates } from "./jsx-elements";
import { findObjectLiteralDuplicates } from "./object-literals";
import type { DuplicateGroup } from "./shingle";
import { findStyleBlockDuplicates } from "./style-blocks";
import { findStyleVarDuplicates } from "./style-vars";
import { findExactDuplicateGroups } from "./suffix-duplicates";
import { findTypeDefDuplicates } from "./type-defs";

/** Matching knobs a strategy may consult — a narrow slice of `FindDuplicatesOptions`. */
export interface StrategyConfig {
  minLines: number;
  windowSize: number;
  maxPunctuationRatio: number;
}

/**
 * @description One duplicate-detection strategy. `findDuplicates` runs every registered strategy
 *   over the shared {@link ScanCorpus}; adding a new kind of duplicate means appending an entry to
 *   {@link DUPLICATE_STRATEGIES}, not editing the orchestrator (Open/Closed).
 */
export interface DuplicateStrategy {
  /** Stable identifier, for diagnostics. */
  readonly name: string;
  /**
   * @description Finds duplicate groups in the corpus. Returned groups need only carry the
   *   strategy's own fields (`family` included where it applies); the orchestrator attaches
   *   advisory signals afterwards.
   * @param corpus - Loaded, tokenized scan input.
   * @param config - Matching knobs.
   * @returns Raw duplicate groups.
   */
  run(corpus: ScanCorpus, config: StrategyConfig): DuplicateGroup[];
}

const withFamily = (groups: DuplicateGroup[], family: DuplicateGroup["family"]) =>
  groups.map((group) => ({ ...group, family }));

/** Structural rule-body comparator for CSS/Less/SCSS block duplicates. */
const styleBlocks: DuplicateStrategy = {
  name: "style-blocks",
  run: (corpus, { minLines }) => findStyleBlockDuplicates(corpus.structuralStyleFiles, minLines),
};

/** Token-stream suffix-array matcher, run per language family so matches never cross families. */
const tokenBlocks: DuplicateStrategy = {
  name: "token-blocks",
  run(corpus, { windowSize, minLines, maxPunctuationRatio }) {
    const groups: DuplicateGroup[] = [];
    for (const [family, fileTokens] of corpus.filesByFamily) {
      groups.push(
        ...withFamily(
          findExactDuplicateGroups(fileTokens, windowSize, minLines, maxPunctuationRatio),
          family,
        ),
      );
    }
    return groups;
  },
};

/** Declaration-level strategies — see docs/adr-018-per-language-definition-duplicates.md. */
const styleVars: DuplicateStrategy = {
  name: "style-vars",
  run: (corpus) => withFamily(findStyleVarDuplicates(corpus.structuralStyleFiles), "style"),
};

const typeDefs: DuplicateStrategy = {
  name: "type-defs",
  run: (corpus) => withFamily(findTypeDefDuplicates(corpus.jsLikeFiles), "js"),
};

const objectLiterals: DuplicateStrategy = {
  name: "object-literals",
  run: (corpus) => withFamily(findObjectLiteralDuplicates(corpus.jsLikeFiles), "js"),
};

const jsxElements: DuplicateStrategy = {
  name: "jsx-elements",
  run: (corpus) => withFamily(findJsxElementDuplicates(corpus.jsLikeFiles), "js"),
};

/** Registered strategies, in report order (the result sort is stable, so order is observable). */
export const DUPLICATE_STRATEGIES: readonly DuplicateStrategy[] = [
  styleBlocks,
  tokenBlocks,
  styleVars,
  typeDefs,
  objectLiterals,
  jsxElements,
];
