import { expect, it } from "vite-plus/test";
import {
  readWorkspacePane,
  rememberWorkspacePane,
  resolveWorkspacePane,
  workspacePaneForLocation,
} from "./workspacePaneMemory";

it("waits for the initial status and chooses Git for changed files or Files for a clean tree", () => {
  expect(resolveWorkspacePane(null, undefined)).toBeNull();
  expect(resolveWorkspacePane(null, 4)).toBe("git");
  expect(resolveWorkspacePane(null, 0)).toBe("files");
});

it("restores the selected tab when both file and diff selections share one workspace route", () => {
  const params = { path: ["README.md"], reviewSectionId: "git:working-tree" };
  expect(workspacePaneForLocation(params, "git")).toBe("git");
  expect(workspacePaneForLocation(params, "files")).toBe("files");
  expect(workspacePaneForLocation({ path: params.path }, "git")).toBe("files");
  expect(workspacePaneForLocation({ reviewSectionId: params.reviewSectionId }, "files")).toBe(
    "git",
  );
});

it("keeps the selected pane across staging updates and thread changes", () => {
  const first = "mobile-pane-thread-one";
  const second = "mobile-pane-thread-two";
  expect(readWorkspacePane(first)).toBeNull();
  const initial = resolveWorkspacePane(null, 3)!;
  rememberWorkspacePane(first, initial);
  expect(resolveWorkspacePane(readWorkspacePane(first), 0)).toBe("git");
  rememberWorkspacePane(first, "files");
  rememberWorkspacePane(second, "git");
  expect(resolveWorkspacePane(readWorkspacePane(first), 7)).toBe("files");
  expect(readWorkspacePane(second)).toBe("git");
  expect(readWorkspacePane(first)).toBe("files");
});
