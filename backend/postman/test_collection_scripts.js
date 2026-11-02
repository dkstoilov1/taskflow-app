/* No-network regression tests for the actual Postman collection scripts. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const collectionPath = path.join(__dirname, "taskflow.postman_collection.json");
const collection = JSON.parse(fs.readFileSync(collectionPath, "utf8"));
const items = new Map(collection.item.map((item) => [item.name, item]));
const ownedKeys = [
  "taskflowCreatedTaskId",
  "taskflowOwnedTaskId",
  "taskflowTaskVersion",
  "taskflowTaskEtag",
  "taskflowPreviousEtag",
];
let assertionsRun = 0;

function expectValue(initial, message) {
  let actual = initial;
  let inverted = false;
  const chain = {};

  for (const property of ["to", "have", "be", "that", "is"]) {
    Object.defineProperty(chain, property, { get: () => chain });
  }
  Object.defineProperty(chain, "not", {
    get() {
      inverted = !inverted;
      return chain;
    },
  });
  chain.property = function (name, expected) {
    const exists = actual !== null && actual !== undefined && Object.hasOwn(actual, name);
    check(inverted ? !exists : exists, message || `Expected property ${name}.`);
    inverted = false;
    if (arguments.length > 1) {
      const matches = actual[name] === expected;
      check(inverted ? !matches : matches, message || `Unexpected value for property ${name}.`);
    }
    actual = actual[name];
    return chain;
  };
  chain.a = (type) => {
    let matches;
    if (type === "array") {
      matches = Array.isArray(actual);
    } else {
      matches = typeof actual === type;
    }
    check(inverted ? !matches : matches, message || `Expected value to be ${type}.`);
    inverted = false;
    return chain;
  };
  chain.eql = (expected) => {
    const matches = require("node:util").isDeepStrictEqual(actual, expected);
    check(inverted ? !matches : matches, message || `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}.`);
    inverted = false;
    return chain;
  };
  chain.match = (pattern) => {
    const matches = typeof actual === "string" && pattern.test(actual);
    check(inverted ? !matches : matches, message || `Expected value to match ${pattern}.`);
    inverted = false;
    return chain;
  };
  chain.include = (part) => {
    const matches = typeof actual === "string" && actual.includes(part);
    check(inverted ? !matches : matches, message || `Expected value to include ${part}.`);
    inverted = false;
    return chain;
  };
  return chain;
}

function check(condition, message) {
  assertionsRun += 1;
  assert.ok(condition, message);
}

function makePostmanMock({ status = 200, body = {}, headers = {}, initialVariables = {} } = {}) {
  const values = new Map(Object.entries({
    baseUrl: "http://127.0.0.1:8080",
    ...initialVariables,
  }));
  const tests = [];
  const errors = [];
  let skipped = false;
  const response = {
    json: () => body,
    headers: {
      get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    to: {
      get have() {
        return this;
      },
      status: (expected) => check(status === expected, `Expected HTTP ${expected}; got ${status}.`),
    },
  };
  const pm = {
    collectionVariables: {
      get: (key) => values.get(key),
      set: (key, value) => values.set(key, value),
    },
    variables: {
      replaceIn: (template) =>
        template.replace(/{{([^{}]+)}}/g, (_match, key) => String(values.get(key) ?? "")),
    },
    response,
    expect: (value, message) => expectValue(value, message),
    test: (name, callback) => {
      try {
        callback();
        tests.push({ name, passed: true });
      } catch (error) {
        tests.push({ name, passed: false, error: error.message });
      }
    },
    execution: {
      skipRequest: () => {
        skipped = true;
      },
    },
  };
  return {
    pm,
    values,
    tests,
    errors,
    isSkipped: () => skipped,
    setBaseUrl: (baseUrl) => values.set("baseUrl", baseUrl),
    run: (source) =>
      vm.runInNewContext(source, {
        pm,
        URL,
        console: { error: (message) => errors.push(String(message)) },
      }, { timeout: 1000 }),
  };
}

function sourceFor(itemName, listen) {
  const item = items.get(itemName);
  assert.ok(item, `Missing collection request ${itemName}.`);
  return item.event
    .filter((event) => event.listen === listen)
    .flatMap((event) => event.script.exec)
    .join("\n");
}

function setPreviousRunState(client) {
  client.values.set("taskflowCreatedTaskId", "old-task-id");
  client.values.set("taskflowOwnedTaskId", "old-task-id");
  client.values.set("taskflowTaskVersion", "6");
  client.values.set("taskflowTaskEtag", '"6"');
  client.values.set("taskflowPreviousEtag", '"5"');
}

function runCreatePreRequest(client) {
  client.run(sourceFor("Create task owned by this collection", "prerequest"));
}

function runCreateTests(client, response) {
  const testClient = makePostmanMock(response);
  testClient.values.clear();
  for (const [key, value] of client.values) {
    testClient.values.set(key, value);
  }
  testClient.run(sourceFor("Create task owned by this collection", "test"));
  return testClient;
}

function assertWritesSkip(client) {
  const writeNames = [
    "Replace collection-owned task",
    "Error: missing If-Match (428)",
    "Error: stale If-Match (412)",
    "Delete collection-owned task",
  ];
  for (const name of writeNames) {
    const requestClient = makePostmanMock();
    requestClient.values.clear();
    for (const [key, value] of client.values) {
      requestClient.values.set(key, value);
    }
    requestClient.run(sourceFor(name, "prerequest"));
    check(requestClient.isSkipped(), `${name} should skip when ownership state is empty.`);
  }
}

function testFailedCreateClearsOldOwnershipAndSkipsWrites() {
  const client = makePostmanMock();
  setPreviousRunState(client);
  runCreatePreRequest(client);
  for (const key of ownedKeys) {
    check(client.values.get(key) === "", `Create pre-request must clear ${key}.`);
  }

  const testClient = runCreateTests(client, { status: 500, body: {}, headers: {} });
  check(testClient.tests.length === 1 && !testClient.tests[0].passed, "Failed create response must fail capture test.");
  for (const key of ownedKeys) {
    check(testClient.values.get(key) === "", `Non-201 create must not set ${key}.`);
  }
  assertWritesSkip(testClient);
}

function testHttp200DoesNotArmOwnership() {
  const client = makePostmanMock();
  setPreviousRunState(client);
  runCreatePreRequest(client);
  const testClient = runCreateTests(client, {
    status: 200,
    body: { id: "another-task", title: "not created", description: "", version: 7 },
    headers: { ETag: '"7"', Location: "/api/tasks/another-task" },
  });
  check(testClient.tests.length === 1 && !testClient.tests[0].passed, "HTTP 200 must fail the create capture test.");
  for (const key of ownedKeys) {
    check(testClient.values.get(key) === "", `HTTP 200 must not arm ${key}.`);
  }
  assertWritesSkip(testClient);
}

function testSuccessfulCreateArmsOnlyNewTask() {
  const client = makePostmanMock();
  setPreviousRunState(client);
  runCreatePreRequest(client);
  const newId = "8be3fd4f-634e-41df-a2bb-c7482ecee8e4";
  const testClient = runCreateTests(client, {
    status: 201,
    body: {
      id: newId,
      title: "TaskFlow Postman sample",
      description: "Created by this collection run; safe to update and delete through its chained requests.",
      version: 7,
    },
    headers: {
      ETag: '"7"',
      Location: `/api/tasks/${newId}`,
    },
  });
  check(testClient.tests.length === 1 && testClient.tests[0].passed, "Valid 201 create must capture task state.");
  check(testClient.values.get("taskflowCreatedTaskId") === newId, "Captured ID must be the new response ID.");
  check(testClient.values.get("taskflowOwnedTaskId") === newId, "Ownership marker must match the new response ID.");
  check(testClient.values.get("taskflowTaskVersion") === "7", "Captured version must match the new response.");
  check(testClient.values.get("taskflowTaskEtag") === '"7"', "Captured ETag must match the new response.");
  check(testClient.values.get("taskflowPreviousEtag") === "", "Successful create must clear prior stale ETag.");

  for (const name of ["Replace collection-owned task", "Delete collection-owned task"]) {
    const requestClient = makePostmanMock();
    requestClient.values.clear();
    for (const [key, value] of testClient.values) {
      requestClient.values.set(key, value);
    }
    requestClient.run(sourceFor(name, "prerequest"));
    check(!requestClient.isSkipped(), `${name} should allow only the newly created task.`);
  }
}

function testLoopbackGuardRejectsQueryAndFragment() {
  for (const baseUrl of [
    "http://127.0.0.1:8080?unexpected=1",
    "http://127.0.0.1:8080#unexpected",
  ]) {
    const client = makePostmanMock();
    client.setBaseUrl(baseUrl);
    const collectionPreRequest = collection.event
      .filter((event) => event.listen === "prerequest")
      .flatMap((event) => event.script.exec)
      .join("\n");
    client.run(collectionPreRequest);
    check(client.isSkipped(), `Collection must reject baseUrl query/fragment: ${baseUrl}`);
  }
}

testFailedCreateClearsOldOwnershipAndSkipsWrites();
testHttp200DoesNotArmOwnership();
testSuccessfulCreateArmsOnlyNewTask();
testLoopbackGuardRejectsQueryAndFragment();

console.log(`PASS: ${assertionsRun} no-network assertions exercised the actual collection scripts.`);
console.log("Failed/non-201 create cannot retain prior ownership; only a validated 201 arms the newly returned task.");
