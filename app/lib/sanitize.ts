// Patterns commonly used in prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|preceding)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|preceding)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(everything|all|your\s+instructions?)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /from\s+now\s+on,?\s+you\s+(are|will)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(a|an|if)\s+/i,
  /system\s*(prompt|message|instructions?)\s*[:=]/i,
  /\[\s*system\s*\]/i,
  /<\s*system\s*>/i,
  /role\s*[:=]\s*["']?system/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /DAN\s+mode/i,
];

const MAX_INPUT_LENGTH = 1000;

export interface SanitizeResult {
  cleaned: string;
  blocked: boolean;
  reason?: string;
}

export function sanitizeUserInput(input: string): SanitizeResult {
  if (typeof input !== "string") {
    return { cleaned: "", blocked: true, reason: "Invalid input type" };
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { cleaned: "", blocked: true, reason: "Empty input" };
  }

  // Hard length cap
  const truncated = trimmed.slice(0, MAX_INPUT_LENGTH);

  // Detect injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(truncated)) {
      return {
        cleaned: truncated,
        blocked: true,
        reason: "Possible prompt injection",
      };
    }
  }

  // Strip control characters that could break the prompt format
  const cleaned = truncated.replace(/[\u0000-\u001F\u007F]/g, " ");

  return { cleaned, blocked: false };
}
