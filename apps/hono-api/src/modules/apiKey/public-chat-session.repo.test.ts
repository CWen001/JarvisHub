import { describe, expect, it } from "vitest";
import {
	normalizePublicChatAskUserPrompt,
	restoreTruncatedPublicChatAskUserQuestion,
} from "./public-chat-session.repo";

describe("restoreTruncatedPublicChatAskUserQuestion", () => {
	it("restores a truncated pending question from the verbatim assistant message", () => {
		const prompt = normalizePublicChatAskUserPrompt({
			toolCallId: "ask-1",
			question: "### 策略卡 1\n部分内容…(truncated,len=1175)",
			options: ["按此策略生成", "调整策略"],
			urgency: "confirmation",
			awaitingReply: true,
		});
		const fullQuestion = [
			"### 策略卡 1",
			"完整策略内容",
			"### 策略卡 5",
			"完整的可见影响与权衡，不可截断。",
			"可选回复：",
			"1. 按此策略生成",
			"2. 调整策略",
		].join("\n");

		expect(restoreTruncatedPublicChatAskUserQuestion(prompt, fullQuestion)?.question)
			.toBe(fullQuestion);
	});

	it("does not replace a complete question", () => {
		const prompt = normalizePublicChatAskUserPrompt({
			toolCallId: "ask-2",
			question: "完整问题",
			options: [],
			urgency: "confirmation",
			awaitingReply: true,
		});

		expect(restoreTruncatedPublicChatAskUserQuestion(prompt, "另一段更长的助手消息")?.question)
			.toBe("完整问题");
	});
});
