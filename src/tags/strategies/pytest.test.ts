import { describe, expect, test } from "vitest";
import { PytestStrategy } from "./pytest";

describe("PytestStrategy", () => {
  const strategy = new PytestStrategy();

  test("canHandle matches only .py files", () => {
    expect(strategy.canHandle("/repo/test_login.py")).toBe(true);
    expect(strategy.canHandle("/repo/test_login.ts")).toBe(false);
  });

  test("inserts pytestmark and a pytest import when neither exists", () => {
    const source = "def test_login():\n    assert True\n";
    const result = strategy.apply("/repo/test_login.py", source, ["auth"]);
    expect(result).toBe(
      "\nimport pytest\npytestmark = pytest.mark.auth\ndef test_login():\n    assert True\n",
    );
  });

  test("uses bracket form for multiple tags", () => {
    const source = "def test_login():\n    assert True\n";
    const result = strategy.apply("/repo/test_login.py", source, ["auth", "smoke"]);
    expect(result).toContain("pytestmark = [pytest.mark.auth, pytest.mark.smoke]");
  });

  test("does not duplicate an existing pytest import", () => {
    const source = "import pytest\nimport os\n\ndef test_login():\n    assert True\n";
    const result = strategy.apply("/repo/test_login.py", source, ["auth"]);
    expect(result).toBe(
      "import pytest\nimport os\n\npytestmark = pytest.mark.auth\n\ndef test_login():\n    assert True\n",
    );
  });

  test("updates an existing pytestmark line in place", () => {
    const source =
      "import pytest\npytestmark = pytest.mark.old\n\ndef test_login():\n    assert True\n";
    const result = strategy.apply("/repo/test_login.py", source, ["auth"]);
    expect(result).toBe(
      "import pytest\npytestmark = pytest.mark.auth\n\ndef test_login():\n    assert True\n",
    );
  });

  test("is idempotent when tags already match", () => {
    const source =
      "import pytest\npytestmark = [pytest.mark.auth, pytest.mark.smoke]\n\ndef test_login():\n    assert True\n";
    const result = strategy.apply("/repo/test_login.py", source, ["smoke", "auth"]);
    expect(result).toBe(source);
  });

  test("removes the pytestmark line when tags is empty", () => {
    const source =
      "import pytest\npytestmark = pytest.mark.auth\n\ndef test_login():\n    assert True\n";
    const result = strategy.apply("/repo/test_login.py", source, []);
    expect(result).toBe("import pytest\n\ndef test_login():\n    assert True\n");
  });
});
