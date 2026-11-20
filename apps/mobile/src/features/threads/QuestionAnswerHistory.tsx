import { useGT } from "gt-react-native";
import type {
  EnvironmentId,
  OrchestrationV2UserInputQuestion,
  UserInputAttachmentAnswerPayload,
  UserInputAttachments,
} from "@t3tools/contracts";
import { Image } from "expo-image";
import { Linking, Pressable, ScrollView, View } from "react-native";
import {
  getQuestionAnswerSelection,
  getQuestionAnswerText,
} from "@t3tools/client-runtime/work-log/user-input";
import { AppText as Text } from "../../components/ui/AppText";
import { assetImageSource } from "../../lib/assetImageSource";
import { useAssetUrl } from "../../state/assets";

function AnswerFile(props: {
  environmentId: EnvironmentId;
  attachment: UserInputAttachments[string][number];
}) {
  const resource = { _tag: "attachment", attachmentId: props.attachment.id } as const;
  const url = useAssetUrl(props.environmentId, resource);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={props.attachment.name}
      disabled={!url}
      onPress={() => {
        if (url) void Linking.openURL(url);
      }}
      className="gap-1"
    >
      {props.attachment.type === "image" && url ? (
        <Image
          source={assetImageSource(props.environmentId, resource, url)}
          cachePolicy="memory-disk"
          style={{ width: 160, height: 96 }}
          contentFit="contain"
        />
      ) : null}
      <Text className="text-sm text-foreground underline">{props.attachment.name}</Text>
    </Pressable>
  );
}

function QuestionOptions(props: { question: OrchestrationV2UserInputQuestion; answer: unknown }) {
  const gt = useGT();
  const { selectedLabels, customText } = getQuestionAnswerSelection(props.question, props.answer);
  return (
    <View className="gap-1">
      <Text selectable className="text-sm text-foreground-muted">
        {props.question.question}
      </Text>
      {props.question.options.map((option) => {
        const selected = selectedLabels.has(option.label);
        return (
          <View key={option.value ?? option.label} className="flex-row gap-2">
            <Text
              accessibilityLabel={selected ? gt("Chosen") : undefined}
              className={
                selected ? "w-3 text-sm text-foreground" : "w-3 text-sm text-foreground-muted"
              }
            >
              {selected ? "✓" : "·"}
            </Text>
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                selectable
                className={
                  selected ? "text-sm font-medium text-foreground" : "text-sm text-foreground-muted"
                }
              >
                {option.label}
              </Text>
              {option.description && option.description !== option.label ? (
                <Text selectable className="text-2xs text-foreground-muted">
                  {option.description}
                </Text>
              ) : null}
              {option.preview ? (
                <ScrollView
                  horizontal
                  className="rounded-md border border-border bg-subtle px-2 py-1.5"
                >
                  <Text selectable className="font-mono text-2xs leading-normal text-foreground">
                    {option.preview}
                  </Text>
                </ScrollView>
              ) : null}
            </View>
          </View>
        );
      })}
      {customText ? (
        <Text selectable className="ml-5 text-sm text-foreground">
          {customText}
        </Text>
      ) : null}
    </View>
  );
}

export function QuestionAnswerHistory(props: {
  environmentId: EnvironmentId;
  answer: UserInputAttachmentAnswerPayload | undefined;
  questions: ReadonlyArray<OrchestrationV2UserInputQuestion>;
}) {
  const answer = props.answer ?? {
    requestId: "",
    answers: {},
    attachmentsByQuestionId: {},
  };
  return (
    <View className="gap-2">
      {[
        ...new Set([
          ...props.questions.map((question) => question.id),
          ...Object.keys(answer.questionTextById ?? {}),
          ...Object.keys(answer.answers),
          ...Object.keys(answer.attachmentsByQuestionId),
        ]),
      ].map((questionId) => {
        const question = props.questions.find((candidate) => candidate.id === questionId);
        return (
          <View key={questionId} className="gap-1">
            {question ? (
              <QuestionOptions question={question} answer={answer.answers[questionId]} />
            ) : null}
            {!question && answer.questionTextById?.[questionId] ? (
              <Text className="text-sm text-foreground-muted">
                {answer.questionTextById[questionId]}
              </Text>
            ) : null}
            {!question && getQuestionAnswerText(answer.answers[questionId]) ? (
              <Text className="ml-3 text-sm text-foreground-muted">
                {getQuestionAnswerText(answer.answers[questionId])}
              </Text>
            ) : null}
            {(answer.attachmentsByQuestionId[questionId] ?? []).map((attachment) => (
              <AnswerFile
                key={attachment.id}
                environmentId={props.environmentId}
                attachment={attachment}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}
