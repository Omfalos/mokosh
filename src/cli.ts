#!/usr/bin/env node
/** CLI binary entry point: invokes the runner and exits with code 1 on unhandled errors. */
import { run } from "./cli/runner";

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
