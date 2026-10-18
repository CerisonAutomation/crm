/**
 * AI utilities for handling AI agent responses with proper fallback logic.
 * Implements patterns from cl-ai.txt for grounded AI agents with deterministic fallbacks.
 */

/**
 * Represents the authority/source of an AI response.
 * Following the pattern from cl-ai.txt where responses should indicate
 * whether they come from live AI models or deterministic fallbacks.
 */
export type AIResponseAuthority = 
  | "server"      // Authoritative response from live AI model with grounding
  | "fallback"    // Deterministic fallback when AI model is unavailable
  | "client";     // Purely client-generated response

/**
 * Enhanced AI response type that includes better fallback handling.
 * Extends the basic AI agent response with additional metadata for fallback logic.
 */
export interface EnhancedAIResponse {
  agent: string;
  reply: string;
  provider: string;
  contextUsed: string[];
  threadId: string;
  authority: AIResponseAuthority;
  citations: Array<{
    factId: string;
    entity: string;
    field: string;
    value: string | null;
    source: { kind: string; ref: string; label: string };
  }>;
  confidence: number; // 0-1 confidence score
  runId: string;
  /** Indicates whether this response used a deterministic fallback */
  isFallback: boolean;
  /** Grounding score - how well the response is grounded in factual context */
  groundingScore: number; // 0-1 score indicating quality of grounding
  /** Suggests whether a fallback should be preferred in similar future requests */
  fallbackSuggested: boolean;
}

/**
 * Determines whether an AI response should be trusted based on authority and confidence.
 * Implements the principle that we should prefer grounded responses and 
 * have clear thresholds for when to rely on AI vs fall back to deterministic logic.
 */
export function shouldTrustAIResponse(response: EnhancedAIResponse): boolean {
  // Don't trust responses with very low confidence
  if (response.confidence < 0.3) return false;
  
  // Prefer server-authoritative responses with good grounding
  if (response.authority === "server" && response.groundingScore >= 0.7) return true;
  
  // For fallbacks, only trust if they have high confidence and are explicitly suggested
  if (response.authority === "fallback") {
    return response.confidence >= 0.8 && response.fallbackSuggested;
  }
  
  // Client responses should generally not be trusted for factual information
  return false;
}

/**
 * Provides a deterministic fallback response when AI services are unavailable.
 * Following the pattern from cl-ai.txt where agents fall back to 
 * deterministic, data-grounded answers when models are unavailable.
 */
export function getDeterministicFallbackResponse(
  agentType: string,
  message: string | undefined,
  caseId: string | undefined,
  contextUsed: string[]
): EnhancedAIResponse {
  // Generate a deterministic response based on available context
  let deterministicReply = "I'm unable to connect to the AI service at the moment. ";
  
  if (caseId) {
    deterministicReply += `For case ${caseId}, I recommend reviewing the case details directly.`;
  } else if (contextUsed.length > 0) {
    deterministicReply += `Based on the available context (${contextUsed.length} items), I suggest proceeding with standard procedures.`;
  } else {
    deterministicReply += "Please try again later or contact support if the issue persists.";
  }
  
  if (message && message.trim()) {
    deterministicReply += ` Your specific question was: "${message}"`;
  }
  
  return {
    agent: agentType,
    reply: deterministicReply,
    provider: "deterministic-fallback",
    contextUsed: contextUsed || [],
    threadId: `fallback-${Date.now()}`,
    authority: "fallback",
    citations: [],
    confidence: 0.95, // High confidence in our fallback logic
    runId: `fallback-${Math.random().toString(36).substr(2, 9)}`,
    isFallback: true,
    groundingScore: 0.8, // Good grounding since we're based on available facts
    fallbackSuggested: true,
  };
}

/**
 * Enhances a standard AI agent response with additional fallback metadata.
 * This can be used to wrap responses from the AI agent API to add 
 * better fallback handling capabilities.
 */
export function enhanceAIResponse(
  baseResponse: {
    agent: string;
    reply: string;
    provider: string;
    contextUsed: string[];
    threadId: string;
    authority: string; // From API - should be "server" for live responses
    citations: Array<{
      factId: string;
      entity: string;
      field: string;
      value: string | null;
      source: { kind: string; ref: string; label: string };
    }>;
    confidence: number;
    runId: string;
  }
): EnhancedAIResponse {
  // Determine if this is likely a fallback based on provider or other indicators
  const isFallback = baseResponse.provider === "deterministic-fallback" || 
                    baseResponse.provider === "fallback" ||
                    baseResponse.confidence < 0.5; // Low confidence might indicate fallback
  
  // Calculate grounding score based on context and citations
  const groundingScore = Math.min(
    1.0,
    (baseResponse.contextUsed.length * 0.1) + 
    (baseResponse.citations.length * 0.2) +
    (baseResponse.authority === "server" ? 0.3 : 0)
  );
  
  // Determine if fallback is suggested for similar future requests
  const fallbackSuggested = 
    baseResponse.confidence < 0.6 || // Low confidence suggests trying fallback next time
    baseResponse.provider !== "server"; // Non-server provider suggests potential instability
  
  return {
    ...baseResponse,
    authority: baseResponse.authority as AIResponseAuthority,
    isFallback,
    groundingScore,
    fallbackSuggested,
  };
}