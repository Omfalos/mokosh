import type { CommandContext } from "./types";

export async function run(ctx: CommandContext): Promise<void> {
  const { graph } = ctx;
  const cycles = graph.findCycles();
  if (cycles.length > 0) {
    process.stderr.write(`Found ${cycles.length} cycle(s):\n`);
    for (const cycle of cycles) {
      process.stderr.write(`  ${cycle.join(" → ")}\n`);
    }
    process.exit(1);
  }
  console.log("No cycles detected.");
}
