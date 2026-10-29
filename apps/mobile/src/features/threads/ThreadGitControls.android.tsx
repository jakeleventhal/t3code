import type {
  ThreadGitControls as IosThreadGitControls,
  useThreadGitRightHeaderItems as useIosThreadGitRightHeaderItems,
} from "./ThreadGitControls";

export type { ThreadGitMenuProps } from "./threadGitActions";

type ThreadGitControlsProps = Parameters<typeof IosThreadGitControls>[0];
const EMPTY_HEADER_ITEMS: ReturnType<typeof useIosThreadGitRightHeaderItems> = [];

// oxlint-disable-next-line t3code/no-hookless-use-function -- Android stub of a hook; the iOS file calls hooks.
export function useThreadGitRightHeaderItems(_props: ThreadGitControlsProps) {
  return EMPTY_HEADER_ITEMS;
}

// oxlint-disable-next-line t3code/no-hookless-use-function -- Android stub of a hook; the iOS file calls hooks.
export function useThreadGitCenterHeaderItems(_props: ThreadGitControlsProps) {
  return EMPTY_HEADER_ITEMS;
}

export function ThreadGitControls(_props: ThreadGitControlsProps) {
  return null;
}
