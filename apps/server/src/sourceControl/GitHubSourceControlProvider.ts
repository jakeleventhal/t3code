import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@t3tools/shared/git";

import * as GitHubCli from "./GitHubCli.ts";
import { findAuthenticatedGitHubAccount, parseGitHubAuthStatus } from "./gitHubAuthStatus.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import {
  combinedAuthOutput,
  firstSafeAuthLine,
  providerAuth,
  type SourceControlAuthProbeInput,
  type SourceControlCliDiscoverySpec,
} from "./SourceControlProviderDiscovery.ts";

function toChangeRequest(summary: GitHubCli.GitHubPullRequestSummary): ChangeRequest {
  return {
    provider: "github",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt: summary.updatedAt ?? Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function parseGitHubAuth(input: SourceControlAuthProbeInput) {
  const output = combinedAuthOutput(input);
  const authStatus = parseGitHubAuthStatus(input.stdout);
  const authenticatedAccount = findAuthenticatedGitHubAccount(authStatus.accounts);
  const host = authenticatedAccount?.host;

  if (authenticatedAccount) {
    return providerAuth({
      status: "authenticated",
      account: authenticatedAccount.account,
      host,
    });
  }

  const failedAccount = authStatus.accounts.find((entry) => entry.active) ?? authStatus.accounts[0];
  if (authStatus.parsed) {
    return providerAuth({
      status: "unauthenticated",
      host: failedAccount?.host,
      detail:
        failedAccount?.error ??
        "Run `gh auth login` to authenticate GitHub CLI with an active account.",
    });
  }

  if (input.exitCode !== 0) {
    return providerAuth({
      status: "unauthenticated",
      host,
      detail: firstSafeAuthLine(output) ?? "Run `gh auth login` to authenticate GitHub CLI.",
    });
  }

  return providerAuth({
    status: "unknown",
    host,
    detail: firstSafeAuthLine(output) ?? "GitHub CLI auth status could not be parsed.",
  });
}

export const discovery = {
  type: "cli",
  kind: "github",
  label: "GitHub",
  executable: "gh",
  versionArgs: ["--version"],
  authArgs: ["auth", "status", "--json", "hosts"],
  parseAuth: parseGitHubAuth,
  installHint:
    "Install the GitHub command-line tool (`gh`) via https://cli.github.com/ or your package manager (for example `brew install gh`).",
} satisfies SourceControlCliDiscoverySpec;

export const make = Effect.gen(function* () {
  const github = yield* GitHubCli.GitHubCli;
  const withRepositoryFromContext = <Input extends object>(
    input: Input,
    context: SourceControlProvider.SourceControlProviderContext | undefined,
  ): Input | (Input & { readonly repository: string }) => {
    const repository =
      context?.remoteName === "upstream"
        ? parseGitHubRepositoryNameWithOwnerFromRemoteUrl(context.remoteUrl)
        : null;
    return repository ? { ...input, repository } : input;
  };

  const listChangeRequests: SourceControlProvider.SourceControlProvider["Service"]["listChangeRequests"] =
    (input) =>
      github
        .listPullRequests(
          withRepositoryFromContext(
            {
              cwd: input.cwd,
              headSelector: input.headSelector,
              state: input.state,
              ...(input.limit !== undefined ? { limit: input.limit } : {}),
            },
            input.context,
          ),
        )
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "github",
                operation: "listChangeRequests",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        );

  return SourceControlProvider.SourceControlProvider.of({
    kind: "github",
    listChangeRequests,
    getChangeRequest: (input) =>
      github.getPullRequest(withRepositoryFromContext(input, input.context)).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getChangeRequest",
              command: error.command,
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    createChangeRequest: (input) =>
      github
        .createPullRequest(
          withRepositoryFromContext(
            {
              cwd: input.cwd,
              baseBranch: input.baseRefName,
              headSelector: input.headSelector,
              title: input.title,
              bodyFile: input.bodyFile,
            },
            input.context,
          ),
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "github",
                operation: "createChangeRequest",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        ),
    getRepositoryCloneUrls: (input) =>
      github.getRepositoryCloneUrls(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getRepositoryCloneUrls",
              command: error.command,
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    getTargetRepositoryCloneUrls: (input) =>
      github.getPullRequestBaseRepositoryCloneUrls(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getRepositoryCloneUrls",
              command: error.command,
              cwd: input.cwd,
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    createRepository: (input) =>
      github.createRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "createRepository",
              command: error.command,
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    getDefaultBranch: (input) =>
      github.getDefaultBranch(withRepositoryFromContext(input, input.context)).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getDefaultBranch",
              command: error.command,
              cwd: input.cwd,
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    checkoutChangeRequest: (input) =>
      github.checkoutPullRequest(withRepositoryFromContext(input, input.context)).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "checkoutChangeRequest",
              command: error.command,
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make);
