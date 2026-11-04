import assert from "node:assert/strict";
import test from "node:test";
import { parseLogoutOrigins } from "./runtime-config.mjs";

test("unset deployment option retains the established Keycloak origin", () => {
  assert.deepEqual(parseLogoutOrigins(undefined), ["http://127.0.0.1:8081"]);
  assert.ok(Object.isFrozen(parseLogoutOrigins(undefined)));
});
test("controlled origins normalize, deduplicate and allow explicit empty configuration", () => {
  assert.deepEqual(
    parseLogoutOrigins(
      '["http://127.0.0.1:18081","https://EXAMPLE.test:443/","https://example.test","http://[::1]:8081"]',
    ),
    ["http://127.0.0.1:18081", "https://example.test", "http://[::1]:8081"],
  );
  assert.deepEqual(parseLogoutOrigins("[]"), []);
  assert.ok(Object.isFrozen(parseLogoutOrigins("[]")));
});
for (const raw of [
  "",
  "{",
  "null",
  "{}",
  '"http://localhost"',
  "42",
  "[null]",
  "[42]",
  '["https://user:password@example.test"]',
  '["https://@example.test"]',
  '["https://example.test/path"]',
  '["https://example.test/."]',
  '["https://example.test?"]',
  '["https://example.test?x=1"]',
  '["https://example.test#"]',
  '["https://example.test#fragment"]',
  '["//example.test"]',
  '["file:///tmp/test"]',
  '["javascript:alert(1)"]',
  '[" https://example.test"]',
  '["https://example.test\\n"]',
  '["http://example.test\\\\evil"]',
  '["http://localhost:99999"]',
  JSON.stringify(Array(33).fill("https://example.test")),
  " ".repeat(8193),
]) {
  test("invalid deployment origin configuration fails closed without printing its contents", () => {
    assert.throws(
      () => parseLogoutOrigins(raw),
      (failure) =>
        failure.message ===
        "PORTAL_LOGOUT_ORIGINS must be a JSON array of HTTP(S) origins without credentials, paths, query or fragment.",
    );
  });
}
