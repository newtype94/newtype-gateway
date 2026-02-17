import { BaseProvider } from './base-provider.js';
import type { ProviderRequest, ProviderResponse, ProviderStreamChunk, OpenAIProviderRequest } from '../types/index.js';
import logger from '../config/logger.js';

export class OpenAIProvider extends BaseProvider {
  constructor(apiEndpoint: string) {
    super('openai', apiEndpoint);
  }

  async chatCompletion(request: ProviderRequest): Promise<ProviderResponse> {
    try {
      const openaiReq = this.toOpenAIRequest(request);
      const response = await this.client.post('/v1/chat/completions', openaiReq, {
        headers: this.buildHeaders(request.accessToken),
      });
      return this.fromOpenAIResponse(response.data);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async *chatCompletionStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    try {
      const openaiReq = this.toOpenAIRequest(request);
      openaiReq.stream = true;
      const response = await this.client.post('/v1/chat/completions', openaiReq, {
        headers: this.buildHeaders(request.accessToken),
        responseType: 'stream',
      });

      let buffer = '';
      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          const parsed = this.parseSSEChunk(data);
          if (parsed) yield parsed;
        }
      }
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private toOpenAIRequest(request: ProviderRequest): OpenAIProviderRequest {
    const req: OpenAIProviderRequest = {
      model: request.model,
      messages: request.messages,
      stream: request.stream,
    };
    if (request.tools) req.tools = request.tools;
    if (request.temperature !== undefined) req.temperature = request.temperature;
    if (request.top_p !== undefined) req.top_p = request.top_p;
    if (request.max_tokens !== undefined) req.max_tokens = request.max_tokens;
    if (request.stop !== undefined) req.stop = request.stop;
    return req;
  }

  private fromOpenAIResponse(data: any): ProviderResponse {
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      finishReason: choice?.finish_reason || 'stop',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      toolCalls: choice?.message?.tool_calls,
      functionCall: choice?.message?.function_call,
    };
  }

  private parseSSEChunk(data: string): ProviderStreamChunk | null {
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return null;
      return {
        content: delta.content ?? undefined,
        finishReason: parsed.choices?.[0]?.finish_reason ?? undefined,
        toolCallChunk: delta.tool_calls?.[0] ?? undefined,
        functionCallChunk: delta.function_call ?? undefined,
      };
    } catch {
      return null;
    }
  }
}
