import test from "node:test";
import assert from "node:assert/strict";
import { eligibilityReasons } from "./eligibility";

const open = { member_required: false, leader_required: false, ministry_required: false };
const member = { isGuest: false, isLeader: false, inMinistry: false };

test("no rules, free seat: eligible", () => {
  assert.deepEqual(
    eligibilityReasons({ program: open, person: member, incompletePrerequisites: [], seats: { enrolled: 1, capacity: 10 } }),
    [],
  );
});

test("each rule adds its own reason", () => {
  assert.deepEqual(
    eligibilityReasons({
      program: { member_required: true, leader_required: true, ministry_required: true },
      person: { isGuest: true, isLeader: false, inMinistry: false },
      incompletePrerequisites: ["Foundation Class"],
      seats: { enrolled: 25, capacity: 25 },
    }),
    [
      "Not a church member",
      "Not a leader",
      "Not serving in a ministry",
      "Has not completed Foundation Class",
      "Class is full (25 / 25)",
    ],
  );
});

test("full class is held back, like enrollUser", () => {
  assert.deepEqual(
    eligibilityReasons({ program: open, person: member, incompletePrerequisites: [], seats: { enrolled: 5, capacity: 5 } }),
    ["Class is full (5 / 5)"],
  );
});
