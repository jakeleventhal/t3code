import { StackActions, useNavigation } from "@react-navigation/native";
import { useEffect, useEffectEvent, useRef } from "react";
import { AppText as Text } from "../../../components/AppText";
import { GuideOutline } from "./GuideOutline";
import { reviewGuideState } from "./reviewGuideState";
import { GuideNotice } from "./GuideNotice";
import Animated from "react-native-reanimated";
import { PR_ROW_ENTER, PR_ROW_EXIT, PR_ROW_LAYOUT } from "../pullRequestAnimations";
import { useEnvironmentQuery } from "../../../state/query";
import { composerPullRequests } from "../../../state/pull-requests";
import { pullRequestTarget, type PullRequestParams } from "../usePullRequestDiff";
import { usePullRequestFilesViewed } from "../usePullRequestFilesViewed";
import { useReviewGuide } from "./useReviewGuide";

export type GuideStopParams = PullRequestParams & {
  readonly position: number;
  readonly guideHeadSha: string;
  readonly guideGeneratedAt: string;
};

export function PullRequestGuideContent({
  params,
  active = true,
}: {
  readonly params: PullRequestParams;
  readonly active?: boolean;
}) {
  const navigation = useNavigation();
  const state = useReviewGuide(params);
  const { guide, stale } = reviewGuideState(state.data);
  const detail = useEnvironmentQuery(composerPullRequests.detail(pullRequestTarget(params)));
  const viewed = usePullRequestFilesViewed(params, detail.data);
  const attempted = useRef<string | null>(null);
  const generationKey = `${params.environmentId}:${params.repository}:${params.number}`;
  const shouldGenerate =
    active &&
    state.data !== null &&
    !guide &&
    !state.running &&
    state.canWrite &&
    state.data.run?._tag !== "Failed";
  const generate = useEffectEvent(() => {
    void state.write();
  });
  useEffect(() => {
    if (!shouldGenerate || attempted.current === generationKey) return;
    attempted.current = generationKey;
    generate();
  }, [shouldGenerate, generationKey]);
  return (
    <Animated.View layout={PR_ROW_LAYOUT} className="w-full max-w-[760px] self-center">
      {!state.enabled ? (
        <Text>Review guides are disabled for this server.</Text>
      ) : (
        <>
          <GuideNotice state={state} />
          {guide ? (
            <Animated.View
              key={`outline:${guide.headSha}:${guide.generatedAt}`}
              layout={PR_ROW_LAYOUT}
              entering={PR_ROW_ENTER}
              exiting={PR_ROW_EXIT}
            >
              <GuideOutline
                guide={guide}
                isViewed={viewed.isViewed}
                onSetChapterViewed={viewed.canToggle && !stale ? viewed.setManyViewed : undefined}
                onToggleViewed={viewed.canToggle ? viewed.toggle : undefined}
                onOpenFile={(path) => navigation.navigate("PullRequestFile", { ...params, path })}
                onOpen={(position) =>
                  navigation.dispatch(
                    StackActions.push("PullRequestGuideStop", {
                      ...params,
                      position,
                      guideHeadSha: guide.headSha,
                      guideGeneratedAt: guide.generatedAt,
                    }),
                  )
                }
                onRewrite={
                  state.canWrite && !state.running && !stale && !state.startError && !state.error
                    ? () => void state.write()
                    : undefined
                }
              />
            </Animated.View>
          ) : null}
        </>
      )}
    </Animated.View>
  );
}
