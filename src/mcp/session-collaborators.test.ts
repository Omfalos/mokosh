import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MokoshConfig } from "../config";
import { Graph } from "../index";
import {
  duplicationTokenCachePath,
  graphCachePath,
  loadDiskGraphSeed,
  resolveDuplicationResultCachePath,
  workspaceCacheDir,
} from "./cache-paths";
import { ChangeImpactCaches } from "./change-impact-caches";
import { DuplicationCaches } from "./duplication-caches";
import { RootWatcher } from "./root-watcher";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-collab-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("ChangeImpactCaches", () => {
  test("builds once per key and reuses the cached entry", () => {
    const caches = new ChangeImpactCaches();
    const build = vi.fn(() => new Graph(new Map()));
    const first = caches.getOrBuild("/r", build);
    expect(caches.getOrBuild("/r", build)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test("clearFor drops the root key and every `root::…` key but leaves other roots alone", () => {
    const caches = new ChangeImpactCaches();
    const build = () => new Graph(new Map());
    for (const key of ["/r", "/r::pkg", "/r::__flat__", "/other", "/rx"])
      caches.getOrBuild(key, build);
    caches.clearFor("/r");
    const rebuild = vi.fn(build);
    for (const key of ["/r", "/r::pkg", "/r::__flat__"]) caches.getOrBuild(key, rebuild);
    expect(rebuild).toHaveBeenCalledTimes(3);
    caches.getOrBuild("/other", rebuild);
    caches.getOrBuild("/rx", rebuild);
    expect(rebuild).toHaveBeenCalledTimes(3);
  });
});

describe("RootWatcher", () => {
  test("dirty flag is off by default and clearDirty is idempotent", () => {
    const watcher = new RootWatcher();
    expect(watcher.isDirty("/r")).toBe(false);
    watcher.clearDirty("/r");
    expect(watcher.isDirty("/r")).toBe(false);
  });

  test("start on a missing directory degrades silently and calling twice is a no-op", () => {
    const watcher = new RootWatcher();
    const missing = path.join(tmp, "nope");
    expect(() => {
      watcher.start(missing);
      watcher.start(missing);
    }).not.toThrow();
    expect(watcher.isDirty(missing)).toBe(false);
  });
});

describe("cache-paths", () => {
  const cfg = (cachePath: string): MokoshConfig => ({ cachePath }) as MokoshConfig;

  test("defaults live under <root>/mokosh-cache", () => {
    expect(graphCachePath("/r", undefined)).toBe(path.join("/r", "mokosh-cache", "graph.json"));
    expect(workspaceCacheDir("/r", undefined)).toBe(path.join("/r", "mokosh-cache"));
    expect(duplicationTokenCachePath("/r")).toContain(path.join("/r", "mokosh-cache"));
  });

  test("a cachePath override is honoured by the graph, workspace and result-cache paths", () => {
    const config = cfg("custom/dir/graph.json");
    expect(graphCachePath("/r", config)).toBe(path.resolve("/r", "custom/dir/graph.json"));
    expect(workspaceCacheDir("/r", config)).toBe(path.resolve("/r", "custom/dir"));
    expect(resolveDuplicationResultCachePath("/r", config)).toBe(
      path.join(path.resolve("/r", "custom/dir"), "duplication-result.json"),
    );
  });

  test("per-package result caches get distinct, stable slugged files", () => {
    const a = resolveDuplicationResultCachePath("/r", undefined, "@org/a");
    const b = resolveDuplicationResultCachePath("/r", undefined, "@org/b");
    expect(a).not.toBe(b);
    expect(a).toBe(resolveDuplicationResultCachePath("/r", undefined, "@org/a"));
    expect(path.basename(a)).toMatch(/^duplication-result-[0-9a-f]{8}\.json$/);
  });

  test("loadDiskGraphSeed returns null for a missing file and for malformed JSON", () => {
    expect(loadDiskGraphSeed(path.join(tmp, "missing.json"))).toBeNull();
    const bad = path.join(tmp, "bad.json");
    fs.writeFileSync(bad, "{not json");
    expect(loadDiskGraphSeed(bad)).toBeNull();
  });
});

describe("DuplicationCaches", () => {
  test("getTokenCache returns the same instance until dropped", () => {
    const caches = new DuplicationCaches(() => undefined);
    const first = caches.getTokenCache(tmp);
    expect(caches.getTokenCache(tmp)).toBe(first);
    caches.drop(tmp);
    expect(caches.getTokenCache(tmp)).not.toBe(first);
  });

  test("flush persists the token cache to disk and is a no-op for an unknown root", () => {
    const caches = new DuplicationCaches(() => undefined);
    expect(() => caches.flush(tmp)).not.toThrow();
    expect(fs.existsSync(duplicationTokenCachePath(tmp))).toBe(false);
    caches.getTokenCache(tmp).set("a.ts", {
      mtime: 1,
      size: 1,
      ignoreLiterals: true,
      generated: false,
      tokens: [],
    });
    caches.flush(tmp);
    expect(fs.existsSync(duplicationTokenCachePath(tmp))).toBe(true);
  });

  test("resultCachePath reads config through the injected lookup", () => {
    const caches = new DuplicationCaches(() => ({ cachePath: "x/graph.json" }) as MokoshConfig);
    expect(caches.resultCachePath("/r")).toBe(
      path.join(path.resolve("/r", "x"), "duplication-result.json"),
    );
  });
});
