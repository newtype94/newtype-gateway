# LLM Gateway

A local proxy server providing unified access to multiple LLM providers through an OpenAI-compatible API with OAuth authentication and intelligent routing.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Testing](#testing)
- [Development](#development)

## Features

- **OAuth Device Flow Authentication** - Secure authentication for OpenAI and Google Gemini providers
- **OpenAI-Compatible API** - Drop-in replacement exposing standard OpenAI endpoints
- **Streaming and Non-Streaming** - Support for both SSE streaming and traditional JSON responses
- **Model Alias Routing** - Map custom model names to provider-specific models with priority-based fallback
- **Automatic Failover** - Seamless provider switching when one fails
- **Sliding Window Rate Limiting** - Per-provider rate limits with queue management
- **User-Agent Rotation** - Header disguise for provider requests
- **Localhost-Only Binding** - Security-first design, no external exposure
- **Token File Watching** - Automatic token synchronization with external sources
- **Graceful Shutdown** - Clean resource cleanup on process termination

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js (ESM)
- **Web Framework**: Express.js
- **HTTP Client**: Axios
- **Logging**: Pino with pretty printing
- **Testing**: Vitest with fast-check (property-based testing)
- **CLI**: Commander
- **Configuration**: YAML

## Project Structure

```
src/
  index.ts                    - System initialization and CLI setup
  config/
    loader.ts                 - Configuration file parser
    logger.ts                 - Pino logger setup
    types.ts                  - Configuration type definitions
  types/
    index.ts                  - Type exports
    openai.ts                 - OpenAI API types
    provider.ts               - Provider interface types
    token.ts                  - Token storage types
  auth/
    auth-manager.ts           - OAuth token lifecycle management
    token-store.ts            - File-based token persistence
  router/
    router.ts                 - Model alias resolution and failure tracking
  rate-limiter/
    rate-limiter.ts           - Sliding window rate limiting with queue
  providers/
    base-provider.ts          - Abstract provider interface
    openai-provider.ts        - OpenAI API client
    gemini-provider.ts        - Google Gemini API client
    user-agent-pool.ts        - User-Agent rotation pool
    index.ts                  - Provider exports
  transformer/
    response-transformer.ts   - Normalize provider responses to OpenAI format
  handler/
    request-handler.ts        - Request orchestration pipeline
  server/
    gateway-proxy.ts          - Express gateway setup and routing

tests/
  auth-manager.test.ts        - Token management tests
  gateway-proxy.test.ts       - Gateway endpoint tests
  integration.test.ts         - End-to-end integration tests
  providers.test.ts           - Provider client tests
  rate-limiter.test.ts        - Rate limiting tests
  request-handler.test.ts     - Request pipeline tests
  response-transformer.test.ts - Response normalization tests
  router.test.ts              - Routing logic tests
  token-store.test.ts         - Token persistence tests

config.example.yaml           - Example configuration file
package.json                  - Dependencies and scripts
tsconfig.json                 - TypeScript configuration
vitest.config.ts              - Test runner configuration
```

## Installation

### Prerequisites

- Node.js 18+ (ESM support required)
- npm 9+

### Steps

```bash
# Clone the repository
git clone <repository-url>
cd llm-gateway

# Install dependencies
npm install

# Build the project
npm run build
```

## Quick Start

1. Copy and configure the example config:

```bash
cp config.example.yaml config.yaml
```

2. Edit `config.yaml` with your OAuth credentials and provider settings.

3. Run the gateway:

```bash
# Production
npm start

# Development (with hot reload)
npm run dev -- -c config.yaml
```

4. Test the gateway:

```bash
curl http://localhost:8080/health
```

The gateway will be available at `http://127.0.0.1:8080`.

## Configuration

The gateway uses a YAML configuration file. See `config.example.yaml` for reference.

### Gateway Settings

```yaml
gateway:
  host: "127.0.0.1"  # Localhost only for security
  port: 8080         # Port number
```

### Authentication

```yaml
auth:
  tokenStorePath: "./tokens.json"     # Where to persist OAuth tokens
  watchFiles:
    - "~/.config/some-tool/tokens.json"  # External token sources to monitor
```

### Model Aliases

Map custom model names to provider-specific models with priority order:

```yaml
modelAliases:
  - alias: "my-best-model"
    providers:
      - provider: "openai"
        model: "gpt-4"
        priority: 1          # Try OpenAI first
      - provider: "gemini"
        model: "gemini-pro"
        priority: 2          # Fallback to Gemini
```

### Rate Limiting

Configure per-provider rate limits:

```yaml
rateLimits:
  - provider: "openai"
    requestsPerMinute: 10
    maxQueueSize: 50
  - provider: "gemini"
    requestsPerMinute: 15
    maxQueueSize: 50
```

### Providers

Configure OAuth settings for each provider:

```yaml
providers:
  openai:
    enabled: true
    clientId: "your-client-id"
    clientSecret: "your-client-secret"
    authEndpoint: "https://auth.openai.com/authorize"
    tokenEndpoint: "https://auth.openai.com/token"
    apiEndpoint: "https://api.openai.com/v1"

  gemini:
    enabled: true
    clientId: "your-client-id"
    clientSecret: "your-client-secret"
    authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth"
    tokenEndpoint: "https://oauth2.googleapis.com/token"
    apiEndpoint: "https://generativelanguage.googleapis.com/v1"
```

## API Reference

The gateway exposes an OpenAI-compatible API for easy integration with existing tools.

### POST /v1/chat/completions

Create a chat completion.

**Request:**

```json
{
  "model": "my-best-model",
  "messages": [
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "stream": false
}
```

**Response (non-streaming):**

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1699999999,
  "model": "my-best-model",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 10,
    "total_tokens": 20
  }
}
```

**Streaming Response:**

With `"stream": true`, the response uses Server-Sent Events (SSE):

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1699999999,"model":"my-best-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1699999999,"model":"my-best-model","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: [DONE]
```

### GET /v1/models

List available models configured as aliases.

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "my-best-model",
      "object": "model",
      "owned_by": "system"
    }
  ]
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok"
}
```

## Architecture

The gateway uses a layered architecture with clear separation of concerns:

```
Client Request
    |
    v
GatewayProxy (Express server, routing, error handling)
    |
    v
RequestHandler (Request validation and orchestration)
    |
    v
Router (Resolve model alias to provider)
    |
    v
RateLimiter (Queue and rate limit enforcement)
    |
    v
AuthManager (Obtain valid OAuth token)
    |
    v
Provider (OpenAI/Gemini API client)
    |
    v
ResponseTransformer (Normalize to OpenAI format)
    |
    v
Client Response
```

### Key Components

**GatewayProxy**: Express application handling HTTP routing, middleware, and error handling. Manages SSE streams for streaming responses.

**RequestHandler**: Orchestrates the request pipeline. Parses and validates client requests. Handles both streaming and non-streaming completion paths.

**Router**: Resolves model aliases to provider-specific models using configured priority order. Tracks provider failures for fallback logic.

**RateLimiter**: Implements sliding window rate limiting per provider. Maintains queue for requests exceeding the rate limit.

**AuthManager**: Manages OAuth token lifecycle. Refreshes expired tokens automatically. Watches external token sources for updates.

**Providers**: Abstract interface with concrete implementations for OpenAI and Gemini. Handles API calls and response parsing.

**ResponseTransformer**: Normalizes provider-specific responses to OpenAI format for API consistency.

## Testing

The project includes 110 unit and integration tests with property-based testing using fast-check.

### Run Tests

```bash
# Run all tests
npm test

# Watch mode (re-run on file changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

### Test Files

- `auth-manager.test.ts` - Token management and OAuth flow
- `gateway-proxy.test.ts` - HTTP endpoints and request routing
- `integration.test.ts` - End-to-end gateway behavior
- `providers.test.ts` - Provider client implementations
- `rate-limiter.test.ts` - Rate limiting and queuing
- `request-handler.test.ts` - Request pipeline orchestration
- `response-transformer.test.ts` - Response format transformation
- `router.test.ts` - Model alias routing and failover
- `token-store.test.ts` - Token persistence

## Development

### Type Checking

```bash
npm run lint
```

Runs TypeScript compiler in check-only mode.

### Building

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

### Cleaning

```bash
npm run clean
```

Removes the `dist/` directory.

### Code Style

The project uses TypeScript strict mode. All files must:
- Pass type checking with no errors
- Use explicit types for public APIs
- Include JSDoc comments for exported functions

---

# LLM Gateway

여러 LLM 제공자에 대한 통일된 액세스를 제공하는 로컬 프록시 서버로, OAuth 인증과 지능형 라우팅을 통해 OpenAI 호환 API를 노출합니다.

## 목차

- [기능](#기능)
- [기술 스택](#기술-스택)
- [프로젝트 구조](#프로젝트-구조)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [구성](#구성)
- [API 레퍼런스](#api-레퍼런스)
- [아키텍처](#아키텍처)
- [테스팅](#테스팅)
- [개발](#개발)

## 기능

- **OAuth 디바이스 플로우 인증** - OpenAI 및 Google Gemini 제공자를 위한 보안 인증
- **OpenAI 호환 API** - 표준 OpenAI 엔드포인트를 노출하는 즉시 대체 가능한 솔루션
- **스트리밍 및 비스트리밍** - SSE 스트리밍 및 기존 JSON 응답 모두 지원
- **모델 별칭 라우팅** - 사용자 정의 모델 이름을 제공자별 모델로 매핑하고 우선순위 기반 폴백 지원
- **자동 장애 조치** - 한 제공자가 실패할 때 다른 제공자로 원활한 전환
- **슬라이딩 윈도우 레이트 제한** - 큐 관리를 포함한 제공자별 레이트 제한
- **User-Agent 회전** - 제공자 요청에 대한 헤더 위장
- **로컬호스트 전용 바인딩** - 보안 우선 설계, 외부 노출 없음
- **토큰 파일 감시** - 외부 소스와의 자동 토큰 동기화
- **우아한 종료** - 프로세스 종료 시 리소스 정리

## 기술 스택

- **언어**: TypeScript (strict mode)
- **런타임**: Node.js (ESM)
- **웹 프레임워크**: Express.js
- **HTTP 클라이언트**: Axios
- **로깅**: Pino (pretty printing 포함)
- **테스팅**: Vitest with fast-check (속성 기반 테스팅)
- **CLI**: Commander
- **구성**: YAML

## 프로젝트 구조

```
src/
  index.ts                    - 시스템 초기화 및 CLI 설정
  config/
    loader.ts                 - 구성 파일 파서
    logger.ts                 - Pino 로거 설정
    types.ts                  - 구성 타입 정의
  types/
    index.ts                  - 타입 내보내기
    openai.ts                 - OpenAI API 타입
    provider.ts               - 제공자 인터페이스 타입
    token.ts                  - 토큰 저장소 타입
  auth/
    auth-manager.ts           - OAuth 토큰 수명 주기 관리
    token-store.ts            - 파일 기반 토큰 지속성
  router/
    router.ts                 - 모델 별칭 해결 및 장애 추적
  rate-limiter/
    rate-limiter.ts           - 슬라이딩 윈도우 레이트 제한 및 큐
  providers/
    base-provider.ts          - 추상 제공자 인터페이스
    openai-provider.ts        - OpenAI API 클라이언트
    gemini-provider.ts        - Google Gemini API 클라이언트
    user-agent-pool.ts        - User-Agent 회전 풀
    index.ts                  - 제공자 내보내기
  transformer/
    response-transformer.ts   - 제공자 응답을 OpenAI 형식으로 정규화
  handler/
    request-handler.ts        - 요청 오케스트레이션 파이프라인
  server/
    gateway-proxy.ts          - Express 게이트웨이 설정 및 라우팅

tests/
  auth-manager.test.ts        - 토큰 관리 테스트
  gateway-proxy.test.ts       - 게이트웨이 엔드포인트 테스트
  integration.test.ts         - 엔드투엔드 통합 테스트
  providers.test.ts           - 제공자 클라이언트 테스트
  rate-limiter.test.ts        - 레이트 제한 테스트
  request-handler.test.ts     - 요청 파이프라인 테스트
  response-transformer.test.ts - 응답 정규화 테스트
  router.test.ts              - 라우팅 로직 테스트
  token-store.test.ts         - 토큰 지속성 테스트

config.example.yaml           - 예제 구성 파일
package.json                  - 의존성 및 스크립트
tsconfig.json                 - TypeScript 구성
vitest.config.ts              - 테스트 러너 구성
```

## 설치

### 전제 조건

- Node.js 18+ (ESM 지원 필요)
- npm 9+

### 단계

```bash
# 저장소 복제
git clone <repository-url>
cd llm-gateway

# 의존성 설치
npm install

# 프로젝트 빌드
npm run build
```

## 빠른 시작

1. 예제 구성을 복사하고 구성합니다:

```bash
cp config.example.yaml config.yaml
```

2. `config.yaml`을 OAuth 자격증명 및 제공자 설정으로 편집합니다.

3. 게이트웨이를 실행합니다:

```bash
# 프로덕션
npm start

# 개발 (핫 리로드 포함)
npm run dev -- -c config.yaml
```

4. 게이트웨이를 테스트합니다:

```bash
curl http://localhost:8080/health
```

게이트웨이는 `http://127.0.0.1:8080`에서 사용 가능합니다.

## 구성

게이트웨이는 YAML 구성 파일을 사용합니다. 참조는 `config.example.yaml`을 참조하세요.

### 게이트웨이 설정

```yaml
gateway:
  host: "127.0.0.1"  # 보안을 위해 로컬호스트만
  port: 8080         # 포트 번호
```

### 인증

```yaml
auth:
  tokenStorePath: "./tokens.json"     # OAuth 토큰을 저장할 위치
  watchFiles:
    - "~/.config/some-tool/tokens.json"  # 모니터링할 외부 토큰 소스
```

### 모델 별칭

사용자 정의 모델 이름을 제공자별 모델로 우선순위 순서로 매핑합니다:

```yaml
modelAliases:
  - alias: "my-best-model"
    providers:
      - provider: "openai"
        model: "gpt-4"
        priority: 1          # OpenAI를 먼저 시도
      - provider: "gemini"
        model: "gemini-pro"
        priority: 2          # Gemini로 폴백
```

### 레이트 제한

제공자별 레이트 제한을 구성합니다:

```yaml
rateLimits:
  - provider: "openai"
    requestsPerMinute: 10
    maxQueueSize: 50
  - provider: "gemini"
    requestsPerMinute: 15
    maxQueueSize: 50
```

### 제공자

각 제공자의 OAuth 설정을 구성합니다:

```yaml
providers:
  openai:
    enabled: true
    clientId: "your-client-id"
    clientSecret: "your-client-secret"
    authEndpoint: "https://auth.openai.com/authorize"
    tokenEndpoint: "https://auth.openai.com/token"
    apiEndpoint: "https://api.openai.com/v1"

  gemini:
    enabled: true
    clientId: "your-client-id"
    clientSecret: "your-client-secret"
    authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth"
    tokenEndpoint: "https://oauth2.googleapis.com/token"
    apiEndpoint: "https://generativelanguage.googleapis.com/v1"
```

## API 레퍼런스

게이트웨이는 기존 도구와 쉬운 통합을 위해 OpenAI 호환 API를 노출합니다.

### POST /v1/chat/completions

채팅 완료를 생성합니다.

**요청:**

```json
{
  "model": "my-best-model",
  "messages": [
    {
      "role": "user",
      "content": "안녕하세요!"
    }
  ],
  "stream": false
}
```

**응답 (비스트리밍):**

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1699999999,
  "model": "my-best-model",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "안녕하세요! 어떻게 도와드릴까요?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 10,
    "total_tokens": 20
  }
}
```

**스트리밍 응답:**

`"stream": true`인 경우 응답은 Server-Sent Events (SSE)를 사용합니다:

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1699999999,"model":"my-best-model","choices":[{"index":0,"delta":{"role":"assistant","content":"안녕하세요"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1699999999,"model":"my-best-model","choices":[{"index":0,"delta":{"content":" 반갑습니다"},"finish_reason":null}]}

data: [DONE]
```

### GET /v1/models

별칭으로 구성된 사용 가능한 모델을 나열합니다.

**응답:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "my-best-model",
      "object": "model",
      "owned_by": "system"
    }
  ]
}
```

### GET /health

상태 확인 엔드포인트입니다.

**응답:**

```json
{
  "status": "ok"
}
```

## 아키텍처

게이트웨이는 명확한 관심사 분리를 통한 계층화된 아키텍처를 사용합니다:

```
클라이언트 요청
    |
    v
GatewayProxy (Express 서버, 라우팅, 에러 처리)
    |
    v
RequestHandler (요청 검증 및 오케스트레이션)
    |
    v
Router (모델 별칭을 제공자로 해결)
    |
    v
RateLimiter (큐 및 레이트 제한 시행)
    |
    v
AuthManager (유효한 OAuth 토큰 획득)
    |
    v
Provider (OpenAI/Gemini API 클라이언트)
    |
    v
ResponseTransformer (OpenAI 형식으로 정규화)
    |
    v
클라이언트 응답
```

### 주요 구성 요소

**GatewayProxy**: HTTP 라우팅, 미들웨어 및 에러 처리를 담당하는 Express 애플리케이션입니다. 스트리밍 응답을 위해 SSE 스트림을 관리합니다.

**RequestHandler**: 요청 파이프라인을 오케스트레이션합니다. 클라이언트 요청을 구문 분석하고 검증합니다. 스트리밍 및 비스트리밍 완료 경로를 모두 처리합니다.

**Router**: 구성된 우선순위 순서를 사용하여 모델 별칭을 제공자별 모델로 해결합니다. 폴백 로직을 위해 제공자 장애를 추적합니다.

**RateLimiter**: 제공자별 슬라이딩 윈도우 레이트 제한을 구현합니다. 레이트 제한을 초과하는 요청에 대한 큐를 유지합니다.

**AuthManager**: OAuth 토큰 수명 주기를 관리합니다. 만료된 토큰을 자동으로 새로 고칩니다. 외부 토큰 소스의 업데이트를 감시합니다.

**Providers**: OpenAI 및 Gemini 구현이 있는 구체적인 추상 인터페이스입니다. API 호출 및 응답 구문 분석을 처리합니다.

**ResponseTransformer**: API 일관성을 위해 제공자별 응답을 OpenAI 형식으로 정규화합니다.

## 테스팅

프로젝트는 fast-check를 사용한 속성 기반 테스팅을 포함한 110개의 단위 및 통합 테스트를 포함합니다.

### 테스트 실행

```bash
# 모든 테스트 실행
npm test

# 감시 모드 (파일 변경 시 재실행)
npm run test:watch

# 커버리지 리포트 포함
npm run test:coverage
```

### 테스트 파일

- `auth-manager.test.ts` - 토큰 관리 및 OAuth 흐름
- `gateway-proxy.test.ts` - HTTP 엔드포인트 및 요청 라우팅
- `integration.test.ts` - 엔드투엔드 게이트웨이 동작
- `providers.test.ts` - 제공자 클라이언트 구현
- `rate-limiter.test.ts` - 레이트 제한 및 큐잉
- `request-handler.test.ts` - 요청 파이프라인 오케스트레이션
- `response-transformer.test.ts` - 응답 형식 변환
- `router.test.ts` - 모델 별칭 라우팅 및 장애 조치
- `token-store.test.ts` - 토큰 지속성

## 개발

### 타입 확인

```bash
npm run lint
```

TypeScript 컴파일러를 체크 전용 모드로 실행합니다.

### 빌드

```bash
npm run build
```

TypeScript를 `dist/` 디렉토리의 JavaScript로 컴파일합니다.

### 정리

```bash
npm run clean
```

`dist/` 디렉토리를 제거합니다.

### 코드 스타일

프로젝트는 TypeScript strict mode를 사용합니다. 모든 파일은 다음을 충족해야 합니다:
- 오류 없이 타입 확인을 통과
- 공개 API에 대한 명시적 타입 사용
- 내보낸 함수에 대한 JSDoc 주석 포함
