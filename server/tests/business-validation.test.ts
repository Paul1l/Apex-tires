import assert from "node:assert/strict";
import test from "node:test";
import { businessConfig } from "../../config/business.js";
import {
  assertProductionBusinessConfig,
  validateBusinessConfig,
} from "../../config/business-validation.js";

test("preview config reports missing client data without blocking a build", () => {
  const issues = validateBusinessConfig(businessConfig);

  assert.ok(issues.some((issue) => issue.field === "seller.inn"));
  assert.doesNotThrow(() => assertProductionBusinessConfig(businessConfig));
});

test("production config rejects missing or demonstration values", () => {
  const productionConfig = {
    ...businessConfig,
    deploymentStage: "production" as const,
    businessName: "ИП Иванов Иван Иванович",
  };

  assert.throws(
    () => assertProductionBusinessConfig(productionConfig),
    /Production deployment заблокирован/,
  );
});
