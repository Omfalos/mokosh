// Run from the repo root: NODE_OPTIONS="--import tsx" npx cucumber-js --config example/e2e-demo/cucumber.cjs
// (see the `example:gherkin` npm script). tsx is registered via NODE_OPTIONS
// so cucumber-js can load the TypeScript step-definitions directly.
module.exports = {
  default: {
    paths: ["example/e2e-demo/features/**/*.feature"],
    import: ["example/e2e-demo/step-definitions/**/*.ts"],
  },
};
