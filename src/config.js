export function publicConfigFromEnv(env = process.env) {
  return {
    icpText: trim(env.PUBLIC_ICP_TEXT),
    icpUrl: trim(env.PUBLIC_ICP_URL) || "https://beian.miit.gov.cn/",
    securityRecordText: trim(env.PUBLIC_SECURITY_RECORD_TEXT),
    securityRecordUrl: trim(env.PUBLIC_SECURITY_RECORD_URL)
  };
}

function trim(value) {
  return String(value ?? "").trim();
}
