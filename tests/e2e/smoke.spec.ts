import { expect, test } from "@playwright/test";

test("smoke placeholder @smoke", async () => {
  expect("grand-central").toContain("central");
});
