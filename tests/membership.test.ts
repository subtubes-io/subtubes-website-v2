import { test } from "node:test";
import assert from "node:assert/strict";
import { ANNUAL_SAVINGS_USD, hasMembership, isMembershipInterval, membershipPriceData } from "../lib/membership/plan";

test("the membership is $12 a month or $99 a year", () => {
  assert.deepEqual(
    [membershipPriceData("month").unit_amount, membershipPriceData("month").recurring],
    [1200, { interval: "month" }],
  );
  assert.deepEqual(
    [membershipPriceData("year").unit_amount, membershipPriceData("year").recurring],
    [9900, { interval: "year" }],
  );
  assert.equal(membershipPriceData("year").currency, "usd");
  assert.equal(ANNUAL_SAVINGS_USD, 45);
});

test("only monthly and yearly are accepted intervals", () => {
  assert.equal(isMembershipInterval("month"), true);
  assert.equal(isMembershipInterval("year"), true);
  for (const value of ["week", "", null, undefined, 1]) assert.equal(isMembershipInterval(value), false);
});

test("only paying statuses give access", () => {
  for (const status of ["active", "trialing", "past_due"]) assert.equal(hasMembership(status), true);
  for (const status of ["none", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused", null, undefined]) assert.equal(hasMembership(status), false);
});
