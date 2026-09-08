import { describe, expect, test } from "vitest";
import type { DuplicateGroup } from "../graph/duplication/shingle";
import { applyDupQuery, matchDupGroup, sortLimitDupGroups } from "./dup-filter";
import { parseDupQuery } from "./dup-parser";

/** Minimal DuplicateGroup factory — only the fields the matcher reads. */
function group(over: Partial<DuplicateGroup> & { files: string[] }): DuplicateGroup {
  const { files, ...rest } = over;
  return {
    occurrences: files.map((file, i) => ({ file, startLine: 1 + i * 10, endLine: 8 + i * 10 })),
    lines: 8,
    tokens: 40,
    ...rest,
  };
}

const q = (s: string) => parseDupQuery(s);

describe("matchDupGroup", { tags: ["matchDupGroup", "dup-filter"] }, () => {
  test("empty query matches everything", () => {
    expect(matchDupGroup(group({ files: ["a.ts"] }), {})).toBe(true);
  });

  describe("path", () => {
    const g = group({ files: ["src/api/user.ts", "src/api/order.ts"] });
    test("matches when at least one occurrence is under the path", () => {
      expect(matchDupGroup(g, q("path:src/api"))).toBe(true);
      expect(matchDupGroup(g, q("path:src/db"))).toBe(false);
    });
    test("negated: matches when no occurrence is under the path", () => {
      expect(matchDupGroup(g, q("path:!db"))).toBe(true);
      expect(matchDupGroup(g, q("path:!api"))).toBe(false);
    });
  });

  describe("allPaths", () => {
    const g = group({ files: ["src/api/user.ts", "src/db/user.ts"] });
    test("matches only when every occurrence is under the path", () => {
      expect(
        matchDupGroup(group({ files: ["src/api/a.ts", "src/api/b.ts"] }), q("allPaths:src/api")),
      ).toBe(true);
      expect(matchDupGroup(g, q("allPaths:src/api"))).toBe(false);
    });
  });

  describe("family / type", () => {
    test("family exact match with negation", () => {
      expect(matchDupGroup(group({ files: ["a.ts"], family: "js" }), q("family:js"))).toBe(true);
      expect(matchDupGroup(group({ files: ["a.ts"], family: "js" }), q("family:!markdown"))).toBe(
        true,
      );
      expect(
        matchDupGroup(group({ files: ["a.ts"], family: "markdown" }), q("family:!markdown")),
      ).toBe(false);
    });
    test("type: every occurrence must resolve to that FileType", () => {
      const g = group({ files: ["a.ts", "b.ts"] });
      expect(matchDupGroup(g, q("type:typescript"))).toBe(true);
      expect(matchDupGroup(group({ files: ["a.ts", "b.py"] }), q("type:typescript"))).toBe(false);
      expect(matchDupGroup(g, q("type:!python"))).toBe(true);
    });
  });

  describe("kind / defKind", () => {
    test("kind defaults to block when unset", () => {
      expect(matchDupGroup(group({ files: ["a.ts"] }), q("kind:block"))).toBe(true);
      expect(matchDupGroup(group({ files: ["a.ts"] }), q("kind:definition"))).toBe(false);
    });
    test("defKind exact match", () => {
      const g = group({ files: ["a.ts"], kind: "definition", defKind: "interface" });
      expect(matchDupGroup(g, q("defKind:interface"))).toBe(true);
      expect(matchDupGroup(g, q("defKind:type"))).toBe(false);
    });
  });

  describe("numeric gates", () => {
    test("minLines / maxLines", () => {
      const g = group({ files: ["a.ts"], lines: 30 });
      expect(matchDupGroup(g, q("minLines:20"))).toBe(true);
      expect(matchDupGroup(g, q("minLines:40"))).toBe(false);
      expect(matchDupGroup(g, q("maxLines:25"))).toBe(false);
    });
    test("score falls back to lines when absent", () => {
      expect(matchDupGroup(group({ files: ["a.ts"], lines: 30 }), q("minScore:25"))).toBe(true);
      expect(matchDupGroup(group({ files: ["a.ts"], lines: 30, score: 4 }), q("minScore:25"))).toBe(
        false,
      );
    });
    test("minOccurrences", () => {
      expect(matchDupGroup(group({ files: ["a.ts", "b.ts"] }), q("minOccurrences:3"))).toBe(false);
      expect(matchDupGroup(group({ files: ["a.ts", "b.ts", "c.ts"] }), q("minOccurrences:3"))).toBe(
        true,
      );
    });
  });

  describe("crossFile", () => {
    test("true requires >=2 distinct files, false requires all in one", () => {
      const same = group({ files: ["a.ts", "a.ts"] });
      const across = group({ files: ["a.ts", "b.ts"] });
      expect(matchDupGroup(across, q("crossFile:true"))).toBe(true);
      expect(matchDupGroup(same, q("crossFile:true"))).toBe(false);
      expect(matchDupGroup(same, q("crossFile:false"))).toBe(true);
    });
  });

  describe("signal", () => {
    const g = group({ files: ["a.ts"], signals: ["test", "same-file"] });
    test("positive entries are OR-matched", () => {
      expect(matchDupGroup(g, q("signal:test"))).toBe(true);
      expect(matchDupGroup(g, q("signal:generated"))).toBe(false);
    });
    test("negated entries are mandatory exclusions", () => {
      expect(matchDupGroup(g, q("signal:!same-file"))).toBe(false);
      expect(matchDupGroup(g, q("signal:test,signal:!generated"))).toBe(true);
    });
  });

  test("AND across keys", () => {
    const g = group({ files: ["src/api/user.ts", "src/api/order.ts"], family: "js", lines: 30 });
    expect(matchDupGroup(g, q("path:src/api,family:js,minLines:20"))).toBe(true);
    expect(matchDupGroup(g, q("path:src/api,family:js,minLines:40"))).toBe(false);
  });
});

describe("sortLimitDupGroups", { tags: ["sortLimitDupGroups", "dup-filter"] }, () => {
  const groups = [
    group({ files: ["a.ts", "b.ts"], lines: 10, score: 5 }),
    group({ files: ["c.ts", "d.ts", "e.ts"], lines: 30, score: 2 }),
    group({ files: ["f.ts", "g.ts"], lines: 20, score: 9 }),
  ];

  test("no sort -> input order preserved", () => {
    expect(sortLimitDupGroups(groups, {}).map((g) => g.lines)).toEqual([10, 30, 20]);
  });
  test("sort:lines desc (default dir)", () => {
    expect(sortLimitDupGroups(groups, q("sort:lines")).map((g) => g.lines)).toEqual([30, 20, 10]);
  });
  test("sort:score asc", () => {
    expect(sortLimitDupGroups(groups, q("sort:score,sortDir:asc")).map((g) => g.score)).toEqual([
      2, 5, 9,
    ]);
  });
  test("sort:occurrences desc", () => {
    expect(
      sortLimitDupGroups(groups, q("sort:occurrences")).map((g) => g.occurrences.length),
    ).toEqual([3, 2, 2]);
  });
  test("limit caps after sorting", () => {
    expect(sortLimitDupGroups(groups, q("sort:lines,limit:2")).map((g) => g.lines)).toEqual([
      30, 20,
    ]);
  });
});

describe("applyDupQuery", { tags: ["applyDupQuery", "dup-filter"] }, () => {
  test("filters then sorts then limits", () => {
    const groups = [
      group({ files: ["src/a.ts", "src/b.ts"], lines: 10 }),
      group({ files: ["test/a.ts", "test/b.ts"], lines: 40, signals: ["test"] }),
      group({ files: ["src/c.ts", "src/d.ts"], lines: 30 }),
      group({ files: ["src/e.ts", "src/f.ts"], lines: 20 }),
    ];
    const out = applyDupQuery(groups, q("signal:!test,sort:lines,limit:2"));
    expect(out.map((g) => g.lines)).toEqual([30, 20]);
  });
});
