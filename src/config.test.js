import test from "node:test";
import assert from "node:assert/strict";

import { publicConfigFromEnv } from "./config.js";

test("publicConfigFromEnv exposes only public compliance fields", () => {
  const config = publicConfigFromEnv({
    PUBLIC_ICP_TEXT: " 京ICP备12345678号 ",
    PUBLIC_SECURITY_RECORD_TEXT: "京公网安备11000000000000号",
    PUBLIC_SECURITY_RECORD_URL: "https://example.com/security",
    SECRET_TOKEN: "not-public"
  });

  assert.deepEqual(config, {
    icpText: "京ICP备12345678号",
    icpUrl: "https://beian.miit.gov.cn/",
    securityRecordText: "京公网安备11000000000000号",
    securityRecordUrl: "https://example.com/security"
  });
  assert.equal("SECRET_TOKEN" in config, false);
});
