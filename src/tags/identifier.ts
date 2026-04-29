export interface TestNodeIdentifier {
  isTestNode(node: { category: string; tags: string[] }): boolean;
}

export class DefaultTestNodeIdentifier implements TestNodeIdentifier {
  public isTestNode(node: { category: string; tags: string[] }): boolean {
    return node.category === "test" || node.tags.includes("test");
  }
}
