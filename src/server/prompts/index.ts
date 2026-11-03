/**
 * Aggregates all system prompts for Gemini Live API.
 * This is the central location for system instruction assembly.
 */

import { SYSTEM_RULES } from "./systemRules";
import { AVATAR_INTRO, EMOTION_SYSTEM, CONVERSATION_STYLE } from "./avatarPrompts";
import { TOOL_USAGE_GUIDE } from "./toolUsage";
import { MEMORY_SYSTEM_PROMPT } from "./memoryPrompts";
import { buildPersonalityOverride, PROACTIVE_BEHAVIOR } from "./personalityOverrides";

/**
 * Builds the complete system instruction string for Gemini Live.
 * 
 * @param avatarStyle - "orb" for AEGIS_CORE or "character" for ELYSIA_CORE
 * @param memoryContext - Optional user memory/context to include
 * @returns Complete system instruction string ready for Gemini Live API
 */
export function buildSystemInstruction(
  avatarStyle: string = "character",
  memoryContext: string = ""
): string {
  const sections = [
    buildPersonalityOverride(avatarStyle),
    PROACTIVE_BEHAVIOR,
    SYSTEM_RULES,
    AVATAR_INTRO,
    EMOTION_SYSTEM,
    CONVERSATION_STYLE,
    TOOL_USAGE_GUIDE,
    MEMORY_SYSTEM_PROMPT,
  ];

  if (memoryContext) {
    sections.push(`\n## User Memory & Context\n${memoryContext}`);
  }

  return sections.join("\n\n---\n\n");
}

export default {
  buildSystemInstruction,
  SYSTEM_RULES,
  AVATAR_INTRO,
  EMOTION_SYSTEM,
  CONVERSATION_STYLE,
  TOOL_USAGE_GUIDE,
  MEMORY_SYSTEM_PROMPT,
};
