import { test } from "node:test";
import assert from "node:assert/strict";
import { hasMembership, MEMBERSHIP_PRICE_DATA } from "../lib/membership/plan";

test("the membership is $10 billed monthly, with no annual option", () => {
  assert.equal(MEMBERSHIP_PRICE_DATA.unit_amount, 1000);
  assert.equal(MEMBERSHIP_PRICE_DATA.currency, "usd");
  assert.deepEqual(MEMBERSHIP_PRICE_DATA.recurring, { interval: "month" });
});

test("only paying statuses give access", () => {
  for (const status of ["active", "trialing", "past_due"]) assert.equal(hasMembership(status), true);
  for (const status of ["none", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused", null, undefined]) assert.equal(hasMembership(status), false);
});
