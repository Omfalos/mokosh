/** Strategy interface and default implementation for identifying test nodes in the graph. */
import type { StructuredTag } from "../types/node";

/**
 * @description Strategy interface for determining whether a graph node represents a test file.
 */
export interface TestNodeIdentifier {
  /**
   * @description Returns whether the given node should be treated as a test node.
   * @param {{ category: string; tags: StructuredTag[] }} node - A minimal node descriptor containing its category and structured tags.
   * @returns {boolean} `true` if the node is a test file.
   */
  isTestNode(node: { category: string; tags: StructuredTag[] }): boolean;
}

/**
 * @description Default implementation that identifies test nodes by `category === "test"`
 *   or the presence of a structured tag named `"test"`.
 */
export class DefaultTestNodeIdentifier implements TestNodeIdentifier {
  /**
   * @description Checks the node's category and tag list to determine if it is a test node.
   * @param {{ category: string; tags: StructuredTag[] }} node - A minimal node descriptor containing its category and structured tags.
   * @returns {boolean} `true` if the category is `"test"` or any tag is named `"test"`.
   */
  public isTestNode(node: { category: string; tags: StructuredTag[] }): boolean {
    return node.category === "test" || node.tags.some((tag) => tag.name === "test");
  }
}
