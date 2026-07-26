import type { LLMRequest, LLMResponse } from "../types/index.js";

export interface LLMAdapter {
  call(request: LLMRequest): Promise<LLMResponse>;
}
