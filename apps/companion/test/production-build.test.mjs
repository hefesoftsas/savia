import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const empty = { state: "idle", elapsedSeconds: 0, tracks: [], error: null };
const meetingId = "1f2c83ab-4d6e-4a10-9f71-c11a3f4d2e80";

function localMeeting(sessionId, name, createdAtMs, chunks = []) {
  return {
    sessionId,
    name,
    createdAtMs,
    state: "ready",
    elapsedSeconds: 2,
    chunks,
    uploadedOrigin: null,
    error: null,
    recovered: false,
  };
}

async function renderProduction(invoke, { uploadPermission = true } = {}) {
  const artifact = await build({
    root,
    configFile: path.join(root, "vite.config.ts"),
    logLevel: "silent",
    build: { write: false },
  });
  const script = (Array.isArray(artifact) ? artifact[0] : artifact).output.find(
    (item) => item.type === "chunk",
  ).code;
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: "http://localhost",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.isTauri = true;
  dom.window.__TAURI_INTERNALS__ = {
    invoke: (command, args) => {
      if (command === "upload_permission_load") return uploadPermission;
      return invoke(command, args);
    },
  };
  dom.window.eval(script);
  return dom;
}
async function until(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), "Expected production behavior did not occur");
}

test("production app reads the saved credential and reconnects without rewriting it", async () => {
  const events = [];
  const dom = await renderProduction(async (command) => {
    events.push(command);
    if (command === "capture_status") return empty;
    if (command === "meeting_list") return [];
    if (command === "credential_load")
      return { origin: "https://savia.example", token: "savia_pat_test_only" };
    if (command === "companion_request") return { storageAvailable: true };
    throw new Error("Unexpected command");
  });
  try {
    await until(() => events.includes("companion_request"));
    assert.ok(events.includes("credential_load"));
    assert.equal(events.includes("credential_save"), false);
    assert.equal(events.includes("credential_clear"), false);
    await until(() =>
      dom.window.document.body.textContent.includes("Connected"),
    );
  } finally {
    dom.window.close();
  }
});

test("production app clears its busy state after native capture returns an error", async () => {
  const events = [];
  const dom = await renderProduction(async (command) => {
    events.push(command);
    if (command === "credential_load") return null;
    if (command === "capture_status") return empty;
    if (command === "meeting_list") return [];
    if (command === "start_capture")
      return {
        ...empty,
        state: "error",
        error: "Test capture failure",
        errorCode: "captureFailed",
      };
    throw new Error("Unexpected command");
  });
  try {
    await until(() => dom.window.document.querySelector(".new-meeting-button"));
    dom.window.document.querySelector(".new-meeting-button").click();
    await until(() => events.includes("start_capture"));
    await until(
      () => !dom.window.document.querySelector(".new-meeting-button").disabled,
    );
    assert.equal(
      dom.window.document.body.textContent.includes("Starting recording"),
      false,
    );
  } finally {
    dom.window.close();
  }
});

test("production app restores multiple local meetings and preserves them when starting another", async () => {
  const events = [];
  let meetings = [
    localMeeting(meetingId, "Quarterly review", 20),
    localMeeting("c6db1e4e-e192-4da2-a09e-5469b69f4450", "Design sync", 10),
  ];
  let activeStatus = empty;
  const dom = await renderProduction(async (command, args = {}) => {
    events.push({ command, args });
    if (command === "credential_load") return null;
    if (command === "capture_status") return activeStatus;
    if (command === "meeting_list") return meetings;
    if (command === "start_capture") {
      activeStatus = {
        ...empty,
        state: "recording",
        sessionId: args.sessionId,
        elapsedSeconds: 0,
        chunks: [],
        activeSources: ["microphone", "system"],
      };
      meetings = [
        {
          ...localMeeting(args.sessionId, args.name, 30),
          state: "recording",
        },
        ...meetings,
      ];
      return activeStatus;
    }
    if (command === "meeting_remove") return activeStatus;
    if (command === "meeting_select") return empty;
    if (command === "read_preview_chunk")
      return { base64Pcm: "AA==", sampleRate: 48_000 };
    throw new Error(`Unexpected command: ${command}`);
  });
  try {
    await until(
      () =>
        dom.window.document.body.textContent.includes("Quarterly review") &&
        dom.window.document.body.textContent.includes("Design sync"),
    );
    assert.equal(
      events.some(
        ({ command, args }) =>
          command === "companion_request" &&
          ["sessioncreate", "sessionchunk", "sessionfinalize"].includes(
            args.operation,
          ),
      ),
      false,
      "restoring meetings must not upload automatically",
    );

    const newMeeting = dom.window.document.querySelector(".new-meeting-button");
    assert.ok(newMeeting, "the inbox must offer a separate new-meeting action");
    newMeeting.click();
    await until(() =>
      events.some((event) => event.command === "start_capture"),
    );
    await until(() => meetings.length === 3);
    await until(
      () =>
        dom.window.document.body.textContent.includes("Quarterly review") &&
        dom.window.document.body.textContent.includes("Design sync"),
    );
    assert.equal(
      events.some((event) => event.command === "meeting_remove"),
      false,
    );
    assert.equal(
      events.some(
        ({ command, args }) =>
          command === "companion_request" &&
          ["sessioncreate", "sessionchunk", "sessionfinalize"].includes(
            args.operation,
          ),
      ),
      false,
      "starting a meeting must not upload it or the existing meetings",
    );
  } finally {
    dom.window.close();
  }
});

test("a previously accepted permission stays remembered without starting an upload on restart", async () => {
  const events = [];
  const meetings = [
    localMeeting(meetingId, "Quarterly review", 20),
    localMeeting("c6db1e4e-e192-4da2-a09e-5469b69f4450", "Design sync", 10),
  ];
  const dom = await renderProduction(async (command, args = {}) => {
    events.push({ command, args });
    if (command === "credential_load") return null;
    if (command === "capture_status") return empty;
    if (command === "meeting_list") return meetings;
    if (command === "read_preview_chunk")
      return { base64Pcm: "AA==", sampleRate: 48_000 };
    throw new Error(`Unexpected command: ${command}`);
  });
  try {
    await until(
      () =>
        dom.window.document.body.textContent.includes("Quarterly review") &&
        dom.window.document.body.textContent.includes("Design sync"),
    );
    assert.equal(
      dom.window.document.querySelector(".permission-disclaimer"),
      null,
      "a remembered acceptance should not show the first-run notice again",
    );
    assert.equal(
      dom.window.document.querySelector('input[type="checkbox"]'),
      null,
      "a remembered acceptance should not require per-upload checkboxes",
    );
    assert.equal(
      events.some(
        ({ command, args }) =>
          command === "companion_request" && args.operation === "sessioncreate",
      ),
      false,
      "restoring the app must never start an upload automatically",
    );
    assert.equal(
      events.some((event) => event.command === "upload_permission_save"),
      false,
      "loading remembered permission must not rewrite it on startup",
    );
  } finally {
    dom.window.close();
  }
});

test("production app requires a one-time permission notice before explicit per-meeting upload and marks only after finalize", async () => {
  const events = [];
  const chunk = {
    source: "microphone",
    sequence: 0,
    startSeconds: 0,
    durationSeconds: 2,
    bytes: 100,
    sampleRate: 48_000,
  };
  const target = localMeeting(meetingId, "Quarterly review", 20, [chunk]);
  const other = localMeeting(
    "c6db1e4e-e192-4da2-a09e-5469b69f4450",
    "Design sync",
    10,
    [chunk],
  );
  const selectedStatus = {
    ...empty,
    state: "ready",
    sessionId: meetingId,
    elapsedSeconds: 2,
    chunks: [chunk],
    tracks: [
      {
        source: "microphone",
        durationSeconds: 2,
        sampleRate: 48_000,
        bytes: 100,
      },
    ],
    recovered: true,
  };
  let finalizeAttempts = 0;
  let uploadedMeeting = null;
  const permissionSaves = [];
  const dom = await renderProduction(
    async (command, args = {}) => {
      events.push({ command, args });
      if (command === "credential_load")
        return {
          origin: "https://savia.example",
          token: "savia_pat_test_only",
        };
      if (command === "capture_status") return empty;
      if (command === "meeting_list")
        return [
          uploadedMeeting
            ? { ...target, uploadedOrigin: uploadedMeeting.origin }
            : target,
          other,
        ];
      if (command === "meeting_select") return selectedStatus;
      if (command === "meeting_rename") return undefined;
      if (command === "read_capture_chunk")
        return { base64: "T2dnUw==", format: "ogg" };
      if (command === "meeting_mark_uploaded") {
        uploadedMeeting = args;
        return undefined;
      }
      if (command === "upload_permission_save") {
        permissionSaves.push(args);
        return undefined;
      }
      if (command === "meeting_remove") return empty;
      if (command === "read_preview_chunk")
        return { base64Pcm: "AA==", sampleRate: 48_000 };
      if (command === "companion_request") {
        if (args.operation === "capabilities")
          return {
            storageAvailable: true,
            grantedRecordingScopes: ["recordings:upload"],
            maxCompressedAudioBytes: 10_000_000,
            audioFormats: ["ogg"],
            sttModel: "test",
            summaryModel: "test",
            maxDurationSeconds: 3600,
            maxAudioBytes: 10_000_000,
            privacyRouting: "test",
          };
        if (args.operation === "sessioncreate")
          return { state: "uploading", chunks: [] };
        if (args.operation === "sessionchunk") return { accepted: true };
        if (args.operation === "sessionfinalize") {
          finalizeAttempts++;
          if (finalizeAttempts === 1) throw new Error("finalize failed");
          return { state: "completed" };
        }
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    { uploadPermission: false },
  );
  try {
    await until(
      () =>
        dom.window.document.body.textContent.includes("Quarterly review") &&
        dom.window.document.body.textContent.includes("Design sync"),
    );
    const targetRow = [
      ...dom.window.document.querySelectorAll(".meeting-row"),
    ].find((row) => row.textContent.includes("Quarterly review"));
    const uploadButton = targetRow?.querySelector(".meeting-row__upload");
    assert.ok(
      uploadButton,
      "each local meeting must have its own upload action",
    );
    uploadButton.click();
    await until(() =>
      dom.window.document.body.textContent.includes(
        "Recording and upload permission",
      ),
    );
    assert.equal(
      events.some(
        ({ command, args }) =>
          command === "companion_request" && args.operation === "sessioncreate",
      ),
      false,
      "the notice must be shown before any upload begins",
    );
    const accept = dom.window.document.querySelector(".permission-accept");
    assert.ok(accept, "the notice must offer an explicit acceptance action");
    accept.click();
    await until(() => permissionSaves.length === 1);
    assert.equal(permissionSaves[0].accepted, true);
    await until(
      () => !dom.window.document.querySelector(".permission-disclaimer"),
    );
    assert.equal(
      events.some(
        ({ command, args }) =>
          command === "companion_request" && args.operation === "sessioncreate",
      ),
      false,
      "accepting the notice alone must not upload a meeting",
    );

    const rowUpload = () => targetRow.querySelector(".meeting-row__upload");
    rowUpload().click();
    await until(() => finalizeAttempts === 1);
    const targetSelection = events.findIndex(
      ({ command, args }) =>
        command === "meeting_select" && args.sessionId === meetingId,
    );
    const firstChunkRead = events.findIndex(
      ({ command, args }) =>
        command === "read_capture_chunk" && args.sessionId === meetingId,
    );
    const firstSessionChunk = events.findIndex(
      ({ command, args }) =>
        command === "companion_request" &&
        args.operation === "sessionchunk" &&
        args.body.sessionId === meetingId,
    );
    assert.ok(targetSelection >= 0, "row upload selects its meeting first");
    assert.ok(targetSelection < firstChunkRead);
    assert.ok(firstChunkRead < firstSessionChunk);
    await until(() => !rowUpload().disabled);
    assert.equal(
      uploadedMeeting,
      null,
      "failed finalization must not mark the local copy uploaded",
    );

    rowUpload().click();
    await until(() => uploadedMeeting !== null);
    assert.equal(uploadedMeeting.sessionId, meetingId);
    const created = events.filter(
      ({ command, args }) =>
        command === "companion_request" && args.operation === "sessioncreate",
    );
    assert.equal(
      created.length,
      2,
      "only the explicitly selected meeting is retried",
    );
    assert.equal(created[0].args.body.id, meetingId);
    const successfulFinalize = events.findLastIndex(
      ({ command, args }) =>
        command === "companion_request" && args.operation === "sessionfinalize",
    );
    const markedUploaded = events.findIndex(
      (event) => event.command === "meeting_mark_uploaded",
    );
    assert.ok(
      markedUploaded > successfulFinalize,
      "the local status follows successful server finalization",
    );
    assert.equal(
      events.some((event) => event.command === "meeting_remove"),
      false,
    );
  } finally {
    dom.window.close();
  }
});

test("meeting names are saved explicitly with trimming and cancelled without a native write", async () => {
  const events = [];
  let meetings = [
    localMeeting(meetingId, "Quarterly review", 20),
    localMeeting("c6db1e4e-e192-4da2-a09e-5469b69f4450", "Design sync", 10),
  ];
  const statuses = new Map(
    meetings.map((meeting) => [
      meeting.sessionId,
      {
        ...empty,
        state: "ready",
        sessionId: meeting.sessionId,
        elapsedSeconds: 2,
        tracks: [
          {
            source: "microphone",
            durationSeconds: 2,
            sampleRate: 48_000,
            bytes: 100,
          },
        ],
        chunks: [],
      },
    ]),
  );
  let resolveFirstRename;
  const dom = await renderProduction(async (command, args = {}) => {
    events.push({ command, args });
    if (command === "credential_load") return null;
    if (command === "capture_status") return empty;
    if (command === "meeting_list") return meetings;
    if (command === "meeting_select") return statuses.get(args.sessionId);
    if (command === "meeting_rename") {
      meetings = meetings.map((meeting) =>
        meeting.sessionId === args.sessionId
          ? { ...meeting, name: args.name }
          : meeting,
      );
      return undefined;
    }
    if (command === "read_preview_chunk")
      return { base64Pcm: "AA==", sampleRate: 48_000 };
    throw new Error(`Unexpected command: ${command}`);
  });
  try {
    await until(
      () =>
        dom.window.document.querySelectorAll(".meeting-row__select").length ===
        2,
    );
    dom.window.document.querySelectorAll(".meeting-row__select")[0].click();
    await until(() =>
      dom.window.document.querySelector(".meeting-row.is-selected"),
    );
    const selectedRow = () =>
      dom.window.document.querySelector(".meeting-row.is-selected");
    const setInputValue = (value) => {
      const input = selectedRow().querySelector(
        'input[aria-label="Session name"]',
      );
      assert.ok(input, "the selected row should expose its inline name editor");
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      ).set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      return input;
    };

    await until(() => selectedRow().querySelector(".meeting-row__edit"));
    selectedRow().querySelector(".meeting-row__edit").click();
    await until(() =>
      selectedRow().querySelector('input[aria-label="Session name"]'),
    );
    let input = setInputValue("  Quarterly review: Final  ");
    input.focus();
    selectedRow().querySelector(".meeting-name-save").click();
    await until(() =>
      events.some((event) => event.command === "meeting_rename"),
    );
    assert.equal(
      events.find((event) => event.command === "meeting_rename").args.sessionId,
      meetingId,
    );
    assert.equal(
      events.find((event) => event.command === "meeting_rename").args.name,
      "Quarterly review: Final",
    );
    await until(
      () => !selectedRow().querySelector('input[aria-label="Session name"]'),
    );
    await until(() =>
      selectedRow().textContent.includes("Quarterly review: Final"),
    );

    selectedRow().querySelector(".meeting-row__edit").click();
    await until(() =>
      selectedRow().querySelector('input[aria-label="Session name"]'),
    );
    input = setInputValue("Cancelled title");
    selectedRow().querySelector(".meeting-name-cancel").click();
    await until(
      () => !selectedRow().querySelector('input[aria-label="Session name"]'),
    );
    assert.equal(
      events.filter((event) => event.command === "meeting_rename").length,
      1,
    );
    assert.ok(selectedRow().textContent.includes("Quarterly review: Final"));

    selectedRow().querySelector(".meeting-row__edit").click();
    await until(() =>
      selectedRow().querySelector('input[aria-label="Session name"]'),
    );
    input = setInputValue("Escape cancelled title");
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await until(
      () => !selectedRow().querySelector('input[aria-label="Session name"]'),
    );
    assert.equal(
      events.filter((event) => event.command === "meeting_rename").length,
      1,
    );
    assert.ok(selectedRow().textContent.includes("Quarterly review: Final"));

    selectedRow().querySelector(".meeting-row__edit").click();
    await until(() =>
      selectedRow().querySelector('input[aria-label="Session name"]'),
    );
    input = setInputValue("Quarterly review keyboard");
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    // JSDOM does not synthesize the browser's implicit form submission for
    // Enter in a text input, so submit the same form event explicitly.
    input.form.requestSubmit();
    await until(
      () =>
        events.filter((event) => event.command === "meeting_rename").length ===
        2,
    );
    assert.equal(
      events.filter((event) => event.command === "meeting_rename")[1].args
        .sessionId,
      meetingId,
    );
    assert.equal(
      events.filter((event) => event.command === "meeting_rename")[1].args.name,
      "Quarterly review keyboard",
    );
    assert.ok(
      selectedRow().querySelector(".meeting-row__edit"),
      "the edit action should remain available",
    );
  } finally {
    dom.window.close();
  }
});

test("a tooltip stays visible on click and dismisses with Escape", async () => {
  const dom = await renderProduction(async (command) => {
    if (command === "capture_status") return empty;
    if (command === "meeting_list") return [];
    if (command === "credential_load") return null;
    throw new Error("Unexpected command");
  });
  try {
    await until(() => dom.window.document.querySelector(".settings-toggle"));
    dom.window.document.querySelector(".settings-toggle").click();
    await until(() =>
      dom.window.document.querySelector(
        'button[aria-label="Savia app address"]',
      ),
    );
    const help = dom.window.document.querySelector(
      'button[aria-label="Savia app address"]',
    );
    help.click();
    await until(() => dom.window.document.querySelector('[role="tooltip"]'));
    help.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(
      dom.window.document.querySelector('[role="tooltip"]'),
      "click must not immediately hide hovered or focused help",
    );
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
    );
    await until(() => !dom.window.document.querySelector('[role="tooltip"]'));
  } finally {
    dom.window.close();
  }
});
