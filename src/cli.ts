#!/usr/bin/env node
import { run } from "./cli/runner";

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
