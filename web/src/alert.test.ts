import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "./api.ts";
import { messageOf } from "./alert.ts";

test("messageOf reads an ApiError's own message", () => {
  const error = new ApiError(502, "bad_gateway", "The Jira gateway is unreachable.");
  assert.equal(messageOf(error), "The Jira gateway is unreachable.");
});

test("messageOf falls back for a plain Error", () => {
  assert.equal(messageOf(new Error("boom")), "Something went wrong.");
});

test("messageOf falls back for a non-Error value", () => {
  assert.equal(messageOf("boom"), "Something went wrong.");
  assert.equal(messageOf(undefined), "Something went wrong.");
});
