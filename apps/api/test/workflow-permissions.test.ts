import { beforeEach, expect, it, vi } from "vitest";
import {
  authorizeWorkflowAction,
  workflowMemberActions,
} from "../src/workflows";

vi.mock("../src/auth/identity-repository", () => ({
  findPrincipal: vi.fn(),
  loadActor: vi.fn(),
}));
vi.mock("../src/external-crm/hubspot-access", () => ({
  canAccessSharedCrm: vi.fn(),
  canManageSharedCrm: vi.fn(),
}));
import { findPrincipal, loadActor } from "../src/auth/identity-repository";
import {
  canAccessSharedCrm,
  canManageSharedCrm,
} from "../src/external-crm/hubspot-access";

const db = {} as D1Database;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findPrincipal).mockResolvedValue({ isActive: true } as never);
  vi.mocked(loadActor).mockResolvedValue({} as never);
});

it("lets workspace admins run every workflow action", async () => {
  vi.mocked(canManageSharedCrm).mockReturnValue(true);
  for (const action of [
    "view",
    "design",
    "publish",
    "execute",
    "history",
    "resolve",
  ] as const)
    await expect(
      authorizeWorkflowAction(db, "admin-1", "tenant:1", action),
    ).resolves.toBe(true);
});

it("lets members view, run and resolve but not design or publish", async () => {
  vi.mocked(canManageSharedCrm).mockReturnValue(false);
  vi.mocked(canAccessSharedCrm).mockReturnValue(true);
  for (const action of workflowMemberActions)
    await expect(
      authorizeWorkflowAction(db, "member-1", "tenant:1", action),
    ).resolves.toBe(true);
  await expect(
    authorizeWorkflowAction(db, "member-1", "tenant:1", "design"),
  ).resolves.toBe(false);
  await expect(
    authorizeWorkflowAction(db, "member-1", "tenant:1", "publish"),
  ).resolves.toBe(false);
});

it("blocks outsiders and inactive principals", async () => {
  vi.mocked(canManageSharedCrm).mockReturnValue(false);
  vi.mocked(canAccessSharedCrm).mockReturnValue(false);
  await expect(
    authorizeWorkflowAction(db, "stranger", "tenant:1", "execute"),
  ).resolves.toBe(false);
  vi.mocked(findPrincipal).mockResolvedValue({ isActive: false } as never);
  await expect(
    authorizeWorkflowAction(db, "gone", "tenant:1", "view"),
  ).resolves.toBe(false);
});
