import type { StructuredTag } from "../types";

export interface TestNodeIdentifier {
  isTestNode(node: { category: string; tags: StructuredTag[] }): boolean;
}

export class DefaultTestNodeIdentifier implements TestNodeIdentifier {
  public isTestNode(node: { category: string; tags: StructuredTag[] }): boolean {
    return node.category === "test" || node.tags.some((t) => t.name === "test");
  }
}
