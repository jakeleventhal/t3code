import type { ProjectScript } from "@t3tools/contracts";
import { devServerDescription, devServerLabel, type ResolvedDevServer } from "../../lib/devServers";
import type { AppBarMenu } from "../../components/ui/AppBar.types";
import {
  basename,
  getTerminalStatusLabel,
  projectScriptMenuIcon,
  type TerminalMenuSession,
} from "../terminal/terminalMenu";
import { projectScriptMenuLabel } from "@t3tools/shared/projectScripts";
import type { ThreadGitMenuProps } from "./threadGitActions";
export { useThreadGitMenuDefinition } from "./threadGitActions";
export type { ThreadGitMenuProps } from "./threadGitActions";
export type ThreadGitControlsProps = ThreadGitMenuProps & {
  readonly devServers: ReadonlyArray<ResolvedDevServer>;
  readonly onOpenDevServer: (server: ResolvedDevServer) => Promise<void>;
  readonly canOpenTerminal: boolean;
  readonly canOperateTerminal: boolean;
  readonly canOpenFiles: boolean;
  readonly projectScripts: ReadonlyArray<ProjectScript>;
  readonly terminalSessions: ReadonlyArray<TerminalMenuSession>;
  readonly onOpenTerminal: (terminalId?: string | null) => void;
  readonly onOpenNewTerminal: () => void;
  readonly onRunProjectScript: (script: ProjectScript) => Promise<void>;
};

export function threadTerminalMenu(props: ThreadGitControlsProps): AppBarMenu | null {
  if (!props.canOpenTerminal) return null;
  return {
    title: "Terminal",
    icon: "terminal",
    separateBackground: false,
    items: [
      ...(props.projectScripts.length > 0
        ? props.projectScripts.map((script) => ({
            id: `script-${script.id}`,
            title: projectScriptMenuLabel(script),
            icon: projectScriptMenuIcon(script.icon),
            subtitle: script.command,
            disabled: !props.canOperateTerminal,
            onPress: () => void props.onRunProjectScript(script),
          }))
        : [
            {
              id: "script-none",
              title: "No project scripts",
              icon: "play",
              subtitle: "This project has no saved scripts yet",
              disabled: true,
              onPress: () => {},
            },
          ]),
      ...props.terminalSessions.map((session) => ({
        id: `terminal-${session.terminalId}`,
        title: session.displayLabel,
        icon: "terminal",
        subtitle: [
          getTerminalStatusLabel({
            status: session.status,
            hasRunningSubprocess: session.hasRunningSubprocess,
          }),
          basename(session.cwd),
        ]
          .filter(Boolean)
          .join(" · "),
        onPress: () => props.onOpenTerminal(session.terminalId),
      })),
      {
        id: "terminal-new",
        title: "Open new terminal",
        icon: "plus",
        subtitle: "Start another shell for this thread",
        disabled: !props.canOperateTerminal,
        onPress: props.onOpenNewTerminal,
      },
    ],
  };
}
export function threadDevServerMenu(props: ThreadGitControlsProps): AppBarMenu | null {
  if (props.devServers.length === 0) return null;
  return {
    title: "Dev servers",
    icon: "globe",
    separateBackground: false,
    items: props.devServers.map((resolved) => ({
      id: `dev-server-${resolved.server.host}:${resolved.server.port}`,
      title: devServerLabel(resolved.server),
      subtitle: devServerDescription(resolved),
      icon: "globe",
      disabled: !resolved.reachable,
      onPress: () => void props.onOpenDevServer(resolved),
    })),
  };
}
