import { BaseProvider } from './base-provider.js';
import type {
  ProviderRequest, ProviderResponse, ProviderStreamChunk,
  GeminiProviderRequest, GeminiProviderResponse, GeminiContent, GeminiPart,
  GeminiTool, GeminiFunctionDeclaration, GeminiGenerationConfig
} from '../types/index.js';
import type { Message, Tool } from '../types/index.js';
import logger from '../config/logger.js';

export class GeminiProvider extends BaseProvider {
  constructor(apiEndpoint: string) {
    super('gemini', apiEndpoint);
  }

  async chatCompletion(request: ProviderRequest): Promise<ProviderResponse> {
    try {
      const geminiReq = this.toGeminiRequest(request);
      const response = await this.client.post(
        `/v1beta/models/${request.model}:generateContent`,
        geminiReq,
        { headers: this.buildHeaders(request.accessToken) }
      );
      return this.fromGeminiResponse(response.data);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async *chatCompletionStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    try {
      const geminiReq = this.toGeminiRequest(request);
      const response = await this.client.post(
        `/v1beta/models/${request.model}:streamGenerateContent?alt=sse`,
        geminiReq,
        { headers: this.buildHeaders(request.accessToken), responseType: 'stream' }
      );

      let buffer = '';
      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data) as GeminiProviderResponse;
            const candidate = parsed.candidates?.[0];
            if (!candidate) continue;
            const part = candidate.content?.parts?.[0];
            yield {
              content: part?.text ?? undefined,
              finishReason: candidate.finishReason ? this.mapFinishReason(candidate.finishReason) : undefined,
            };
          } catch { continue; }
        }
      }
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  toGeminiRequest(request: ProviderRequest): GeminiProviderRequest {
    const contents = this.convertMessages(request.messages);
    const result: GeminiProviderRequest = { contents };

    const genConfig: GeminiGenerationConfig = {};
    if (request.temperature !== undefined) genConfig.temperature = request.temperature;
    if (request.top_p !== undefined) genConfig.topP = request.top_p;
    if (request.max_tokens !== undefined) genConfig.maxOutputTokens = request.max_tokens;
    if (request.stop) {
      genConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }
    if (Object.keys(genConfig).length > 0) result.generationConfig = genConfig;

    if (request.tools) result.tools = this.convertTools(request.tools);

    return result;
  }

  private convertMessages(messages: Message[]): GeminiContent[] {
    const contents: GeminiContent[] = [];
    let systemPrefix = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrefix += (msg.content || '') + '\n\n';
        continue;
      }

      if (msg.role === 'user') {
        const text = systemPrefix ? `[System] ${systemPrefix}${msg.content || ''}` : (msg.content || '');
        systemPrefix = '';
        contents.push({ role: 'user', parts: [{ text }] });
      } else if (msg.role === 'assistant') {
        const parts: GeminiPart[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.function_call) {
          parts.push({
            functionCall: {
              name: msg.function_call.name,
              args: JSON.parse(msg.function_call.arguments),
            },
          });
        }
        if (parts.length === 0) parts.push({ text: '' });
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool' || msg.role === 'function') {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name || 'unknown',
              response: msg.content ? JSON.parse(msg.content) : {},
            },
          }],
        });
      }
    }

    if (systemPrefix && contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: systemPrefix.trim() }] });
    }

    return contents;
  }

  convertTools(tools: Tool[]): GeminiTool[] {
    const declarations: GeminiFunctionDeclaration[] = tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as any,
    }));
    return [{ functionDeclarations: declarations }];
  }

  private fromGeminiResponse(data: GeminiProviderResponse): ProviderResponse {
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    return {
      content: part?.text || '',
      finishReason: this.mapFinishReason(candidate?.finishReason || 'STOP'),
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      functionCall: part?.functionCall ? {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args),
      } : undefined,
    };
  }

  private mapFinishReason(reason: string): string {
    switch (reason) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY': return 'content_filter';
      case 'RECITATION': return 'content_filter';
      default: return 'stop';
    }
  }
}
