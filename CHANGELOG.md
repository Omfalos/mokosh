## [0.5.0](https://github.com/Omfalos/mokosh/compare/v0.4.4...v0.5.0) (2026-09-02)

### Features

* add JVM language support (Java, Kotlin, Scala, Groovy) ([#9](https://github.com/Omfalos/mokosh/issues/9)) ([7a81f14](https://github.com/Omfalos/mokosh/commit/7a81f1406c2cd6d45414a6752f5dde61aa627a6a))
* **jvm:** complexity Java + call edges, annotation categories, JUnit/ScalaTest tag strategies ([c0fb73d](https://github.com/Omfalos/mokosh/commit/c0fb73dfa62a28dc8b5c15a84861b9992190b9ad))
* **jvm:** gradle/sbt workspace detectors + cross-package edge tagging ([d4b5e55](https://github.com/Omfalos/mokosh/commit/d4b5e558bbb86db372a5ffa391f12ea0e15731a4))
* **jvm:** resolve Gradle/sbt dependency versions for JVM imports ([9e5ec52](https://github.com/Omfalos/mokosh/commit/9e5ec520ce34616c7699e62a8f184dc2ba8f2b52))

## [0.4.4](https://github.com/Omfalos/mokosh/compare/v0.4.3...v0.4.4) (2026-08-25)

### Features

* **cli:** add --base flag for CI-friendly affected-test selection ([966b1e8](https://github.com/Omfalos/mokosh/commit/966b1e868d8e47918033fe81ebddb3bb739f1040))
* **example:** add runnable multi-framework e2e-demo + CI smoke job ([f3492f5](https://github.com/Omfalos/mokosh/commit/f3492f5101fc3cd611ea0034b410003fca44c643))

### Bug Fixes

* **classify:** reset registries on each applyConfig call, not just accumulate ([#6](https://github.com/Omfalos/mokosh/issues/6)) ([d936226](https://github.com/Omfalos/mokosh/commit/d93622663d4ab279377c80e32deba2ffbb92a576))
* **mcp:** clear_cache now drops loaded config, not just the graph ([cb15bb2](https://github.com/Omfalos/mokosh/commit/cb15bb27ba0b1612ea3b717bfb4cc248b4813c02))
* **mcp:** respect configured ignoreDirs/extensions in find_unused ([7fbc62e](https://github.com/Omfalos/mokosh/commit/7fbc62e5fd91acb2759dc06e7f5e87e081ff1f5b))
* **mcp:** scope getChangedFiles to rootDir for correct multi-worktree sessions ([#7](https://github.com/Omfalos/mokosh/issues/7)) ([7443505](https://github.com/Omfalos/mokosh/commit/74435052329d8f086dfc7d2d228ebf9d2701f444))

## [0.4.3](https://github.com/Omfalos/mokosh/compare/v0.4.2...v0.4.3) (2026-08-20)

### Features

* **mcp:** add find_risk_hotspots tool ([5a0be86](https://github.com/Omfalos/mokosh/commit/5a0be8611ef667c6ace7b82ec1c08688c2bec29f))

## [0.4.2](https://github.com/Omfalos/mokosh/compare/v0.4.1...v0.4.2) (2026-08-20)

### Bug Fixes

* **graph:** clamp non-positive maxThreads to 1 instead of failing pool construction ([d01757e](https://github.com/Omfalos/mokosh/commit/d01757eb17d0f04fded73521ddc3809fab3ca4ed))

### Performance Improvements

* **mcp:** seed session cache from CLI disk cache, add SessionState regression test ([009f703](https://github.com/Omfalos/mokosh/commit/009f7032ce2e9ceed967e4e799e22a1de18d3651))
* **mcp:** serialize tool responses compact instead of pretty-printed ([de05b05](https://github.com/Omfalos/mokosh/commit/de05b053238dff4005b394a73e848c766840e750))
* **mcp:** trim verbose tool descriptions in ListTools schema ([ec923c5](https://github.com/Omfalos/mokosh/commit/ec923c577d6d28305bade4d9305a212f46c6f543))

## [0.4.1](https://github.com/Omfalos/mokosh/compare/v0.4.0...v0.4.1) (2026-08-13)

### Performance Improvements

* **duplication:** persist find_duplicates token cache to disk ([0c59fab](https://github.com/Omfalos/mokosh/commit/0c59fabb12f59b1934a1ac7f4e2019c83470c3e9))
* **enrichment:** fuse five post-build passes into a single graph scan ([80f7144](https://github.com/Omfalos/mokosh/commit/80f7144b752426749221a27d67c5d47084652189))

## [0.4.0](https://github.com/Omfalos/mokosh/compare/v0.3.3...v0.4.0) (2026-08-11)

### Bug Fixes

* **duplication:** find_duplicates timeouts on large repos ([27950e7](https://github.com/Omfalos/mokosh/commit/27950e7c8d7374114da18c3c0dc3f04c05020db3))

## [0.3.3](https://github.com/Omfalos/mokosh/compare/v0.3.2...v0.3.3) (2026-08-11)

### Bug Fixes

* **duplication:** bound find_duplicates scan time on large repos ([2cb5adb](https://github.com/Omfalos/mokosh/commit/2cb5adb245af9e46dcd511438e1cad8489f59eee))

## [0.3.2](https://github.com/Omfalos/mokosh/compare/v0.3.1...v0.3.2) (2026-08-11)

### Features

* **duplication:** reduce noise in cross-language duplicate detection ([3161137](https://github.com/Omfalos/mokosh/commit/316113753f79dc6304f860fa3498a1975e4735f2))

## [0.3.1](https://github.com/Omfalos/mokosh/compare/v0.3.0...v0.3.1) (2026-08-06)

### Features

* **mcp:** add find_duplicates tool for cross-language duplicate detection ([22a4c5e](https://github.com/Omfalos/mokosh/commit/22a4c5e20e105084e3be8f693c9ab270d116ef1c))
* **mcp:** add list_tags tool and reuse cache in find_unused ([08355e6](https://github.com/Omfalos/mokosh/commit/08355e685512ed6435cdae86dc85758eb32579a5))

### Bug Fixes

* **lint:** resolve all biome noNonNullAssertion warnings ([5c4df7f](https://github.com/Omfalos/mokosh/commit/5c4df7f7f7535d3a0208df4f844fc9a11d67dd47))

## [0.3.0](https://github.com/Omfalos/mokosh/compare/v0.2.0...v0.3.0) (2026-08-05)

### Features

* **parser:** extend complexity, call edges, and exports to Go/Python/LiveScript ([632c3fb](https://github.com/Omfalos/mokosh/commit/632c3fb2a5082794d9173cb470895236f2bcb099))

## [0.2.0](https://github.com/Omfalos/mokosh/compare/v0.1.11...v0.2.0) (2026-07-30)

### Features

* **parser:** extract exports and tags from SCSS/Less declarations ([23286d3](https://github.com/Omfalos/mokosh/commit/23286d309665640c143349d4170a920442a14d81))
* **parser:** extract exports from Lua and CoffeeScript modules ([1d4e343](https://github.com/Omfalos/mokosh/commit/1d4e343d6768e40f8a424a6c022511f32a94be3f))

## [0.1.11](https://github.com/Omfalos/mokosh/compare/v0.1.10...v0.1.11) (2026-07-29)

### Bug Fixes

* **deps:** update dependencies to patch known vulnerabilities ([687354d](https://github.com/Omfalos/mokosh/commit/687354dc7dba38ce98e1c2c70334a35ffa8a1987))

## [0.1.10](https://github.com/Omfalos/mokosh/compare/v0.1.9...v0.1.10) (2026-07-29)

### Features

* **mcp:** add find_symbol tool with CLI parity ([448df4d](https://github.com/Omfalos/mokosh/commit/448df4d6708438a9de22400420a902fdc3c7c98f))
* **mcp:** add withMeta option to get_dependencies/get_dependents/get_affected ([7550fb9](https://github.com/Omfalos/mokosh/commit/7550fb94dde568634e4c2922749b3ebd2873a88b))

## [0.1.9](https://github.com/Omfalos/mokosh/compare/v0.1.8...v0.1.9) (2026-07-16)

### Features

* added path alias support ([b568062](https://github.com/Omfalos/mokosh/commit/b5680623da6a40a41ace617284eae5a3e33ff42a))

## [0.1.8](https://github.com/Omfalos/mokosh/compare/v0.1.7...v0.1.8) (2026-07-15)

### Bug Fixes

* **deps:** update dependencies and fix js-yaml v5 ESM import break ([131972d](https://github.com/Omfalos/mokosh/commit/131972d3a975d5b88bf2bfbce4882f4a341f88be))
* **git:** batch git log calls to fix gitStats MCP timeout on large repos ([7f06dd1](https://github.com/Omfalos/mokosh/commit/7f06dd1aee1ea195208928fe4bdc7feca6ae15d4))

## [0.1.7](https://github.com/Omfalos/mokosh/compare/v0.1.6...v0.1.7) (2026-07-14)

### Features

* **query:** add complexity, commit, and doc-staleness filters with sort direction and OR-groups ([bb9a4c9](https://github.com/Omfalos/mokosh/commit/bb9a4c97d3cbe23ea0263cff4425edf4fb7e2714))

### Bug Fixes

* **git:** use execFileSync instead of execSync to prevent shell injection ([96e550b](https://github.com/Omfalos/mokosh/commit/96e550bef614a2c8223c2d190149559f207aa579))

## [0.1.6](https://github.com/Omfalos/mokosh/compare/v0.1.5...v0.1.6) (2026-07-14)

### Features

* **config:** add parallelParsing option to disable/tune the worker pool ([dcf6f3e](https://github.com/Omfalos/mokosh/commit/dcf6f3e2df119dad42143a308f9b49194d800594))
* **graph:** add markdown parsing and doc-drift detection ([68d3357](https://github.com/Omfalos/mokosh/commit/68d33574a60023c356dfdea4ec606604c442e20b))

## [0.1.5](https://github.com/Omfalos/mokosh/compare/v0.1.4...v0.1.5) (2026-07-13)

### Features

* **cli:** add --init-config command to scaffold a starter mokosh.config.js ([b045a01](https://github.com/Omfalos/mokosh/commit/b045a0172179243d9407d5bb9bb3797ffd6d091b))
* **cli:** add --init-skill command to scaffold a bundled Claude Code skill ([2ad2b21](https://github.com/Omfalos/mokosh/commit/2ad2b210e13f6ae0451019e15d6f204e675d0a06))
* **cli:** add CLI parity commands for full MCP fallback coverage ([518da9c](https://github.com/Omfalos/mokosh/commit/518da9c4d6d781fe539481e970507756ec7b89fc))

### Bug Fixes

* **graph:** tag library imports by resolved isExternal, not specifier syntax ([bd2a8e0](https://github.com/Omfalos/mokosh/commit/bd2a8e034796088e7b79ef2c01fe10e225d095e6))

## [0.1.4](https://github.com/Omfalos/mokosh/compare/v0.1.3...v0.1.4) (2026-07-10)

### Bug Fixes

* **ci:** use Node 24 in publish workflow instead of npm self-upgrade ([cfb84b5](https://github.com/Omfalos/mokosh/commit/cfb84b528ee3c7dcfdd958a6592faa1c980a564c))
* **style:** resolve ESM load crash and bare-specifier resolution for style files ([1ad1fc4](https://github.com/Omfalos/mokosh/commit/1ad1fc4c206ebc0b4fa9b213916b56225999e9fd))

## [0.1.3](https://github.com/Omfalos/mokosh/compare/v0.1.2...v0.1.3) (2026-07-09)

### Bug Fixes

* **ci:** trying to resolve issue with release and publish scripts ([e123e62](https://github.com/Omfalos/mokosh/commit/e123e62615f94baee1b1b09abf9e5899db8c1a55))
* **ci:** trying to resolve issue with release and publish scripts - missing file ([2eb626a](https://github.com/Omfalos/mokosh/commit/2eb626a8670d2fd2ff6190288519eed6e1d6b0ee))

## [0.1.2](https://github.com/Omfalos/mokosh/compare/v0.1.1...v0.1.2) (2026-07-09)

### Bug Fixes

* move runtime parser deps out of devDependencies ([e725bfd](https://github.com/Omfalos/mokosh/commit/e725bfdbef7e08940abc0a97e340bdfaf9b6dfd8))

## [0.1.1](https://github.com/Omfalos/mokosh/compare/v0.1.0...v0.1.1) (2026-07-09)

### Bug Fixes

* **ci:** push annotated release tag so gh release create succeeds ([92c6228](https://github.com/Omfalos/mokosh/commit/92c622895c01f6745ae0ffec74a6cd3780d26014))

## 0.1.0 (2026-07-09)

### Features

* add cli commands ([1285287](https://github.com/Omfalos/mokosh/commit/1285287f175e0e00a22eaec7600ba4f972172ae6))
* add complexity tool to mcp ([7e8e5c8](https://github.com/Omfalos/mokosh/commit/7e8e5c8e502d0878f651d9f74352fc141df880e3))
* adde missing files ([01d95a9](https://github.com/Omfalos/mokosh/commit/01d95a96a6dacea11c3a9d455ea7b21783e12b55))
* added go to supported languages ([d8230b0](https://github.com/Omfalos/mokosh/commit/d8230b0791e37f3edcc2a1a4da1e69ab10259af6))
* added python back with new lib ([293cbeb](https://github.com/Omfalos/mokosh/commit/293cbeb532374329f7eb6c9903a940ebbfdc192e))
* added tags applier to mokosh ([8ee9a4f](https://github.com/Omfalos/mokosh/commit/8ee9a4f3e018c3a7e22e04773a07f49e090917ac))
* improve symbol traversal ([2e627a7](https://github.com/Omfalos/mokosh/commit/2e627a76061ba45d13126d5b29d106aff7d27fa7))
* **new-graphs:** added new tools ([dba581f](https://github.com/Omfalos/mokosh/commit/dba581fba06340ac0bf246e17bbc61efb101ea8e))

### Bug Fixes

* improving readability and lib state ([be1bc2f](https://github.com/Omfalos/mokosh/commit/be1bc2fc9384547359a72e1fc0babf000f93b89a))
* add support for multiple fameworks ([f8a73f2](https://github.com/Omfalos/mokosh/commit/f8a73f26a95275d21b7617d4ec5783d094a74705))
* bug with the root folder leak when analyzing the entry file ([84e3330](https://github.com/Omfalos/mokosh/commit/84e33302ce71278ba9fc7a45aa6a7a9b29a551d8))
* files I have forgoten to commit ([d1e64a4](https://github.com/Omfalos/mokosh/commit/d1e64a48df716556c323dad78c3e298fe7901667))
* fixed small issues ([9567755](https://github.com/Omfalos/mokosh/commit/9567755815328f10bad3b20ac21f139547134ccc))
* fixed we issues ([cf46dc7](https://github.com/Omfalos/mokosh/commit/cf46dc7333d0325e3eb291016bdc7cee3b051e76))
* issues created by last code changes ([174cc9c](https://github.com/Omfalos/mokosh/commit/174cc9c84c87ecde973565c62a84a40718ca1346))
* setup library and fix errors ([c665a7c](https://github.com/Omfalos/mokosh/commit/c665a7c5a2c24b814d8936ad2bb20fc9c89b9565))
* some of existing bugs ([1deeecf](https://github.com/Omfalos/mokosh/commit/1deeecf0c3998fe1d808db6771f2840024e8f832))
