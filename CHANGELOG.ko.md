# 변경 로그(포크 추가 항목)

> 전체 히스토리(업스트림 0.1.0 이전 포함)는 [CHANGELOG.md](CHANGELOG.md)를 참고하세요. 이 파일은 포크의 추가 항목만 번역한 것입니다. · [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md)

## 0.1.1

### 추가

- `scripts/`의 TypeScript 도구 체인: `verify-release`, `packed-components-smoke`, `packed-install-e2e`가 `.ts` 소스가 되어 `tsc`로 `scripts-dist/`에 컴파일됩니다. 저장소의 마지막 3개 비-TS 소스 파일이 제거되었습니다.

### 변경

- `package.json` 스크립트 `test:e2e:packed`와 `verify:release`가 `scripts-dist/`의 컴파일 결과물을 실행합니다.
- 추정기 카탈로그 라우트 등록이 강화됨: `asWebServer`가 서비스 자체를 반환하도록 수정(D7 수정), 추정기 UI가 비활성 시 섹션 제목을 유지하도록 수정(U1 수정).
- 프레임워크 문서 정정: 행 수준 `inject: [webServer]`는 부담을 지지 않음(Y22); DSH 모든 패키지에 `isolate()` 없음.

### 수정

- 추정기 카탈로그 라우트는 `asWebServer`가 `register`를 서비스에서 분리한导致로 처음부터 한 번도 등록되지 않았음(D7).
- 비-TokenPilot 프로필에서 추정기 섹션이 경고 없이 사라졌음(U1).

## Unreleased(미출시)

### 추가

- 직교하는 코드 스켈레톤 압축 게이트(`codeSkeleton.enabled`, 기본값 off): 매우 큰 소스코드 도구 결과가 처음 노출될 때 임포트와 선언부의 스켈레톤을 보존할 수 있습니다(함수 본문 생략, 에러 라인 유지). 실패 시 기존의 head 트리밍으로 폴백합니다. 게이트는 모든 프로파일과 독립적이며 정확한 토크나이저 측정이 전제입니다.
- 셀렉터 설정 섹션에 게이트의 토글 추가(간체 중국어·영문 카피 포함).
- 새 섹션의 브라우저/런타임 디코드 정합성 테스트, `saveCodeSkeleton`의 confirm-on-write 컨트랙트 테스트, 전체 문서 패리티 매트릭스 확장.

### 변경

- ESLint 플랫 설정 베이스라인(`pnpm lint`, CI에서도 강제)과 `pnpm test:watch` TDD 루프를 추가. 죽은 임포트를 정리하고, lint 베이스라인에서 드러난 두 오류 경로를 보강했습니다.
- 이 저장소는 이제 `WilliamShi666/dsh-context-compression-selector`의 개선 포크로 관리됩니다. 문서는 영어·중국어(간체)·일본어·한국어로 제공됩니다.

### 수정

- 추정기 카드가 Harness 호스트 채널에서 더 이상 API 키를 요구하지 않습니다. 호스트 채널을 선택하면 라이브 프로바이더/모델 드롭다운이 표시되고 실제로 사용될 라우트(명시적 재정의, 없으면 세션 기본 모델)를 알려줍니다. 키 입력란과 두 번째 수동 모델 입력란은 렌더링되지 않습니다 — 엔드포인트 URL, 모델 텍스트 필드, 쓰기 전용 키는 직접 연결 채널에만 속합니다.
- `presetOptions` 쓰기가 형제 필드를 보존합니다. `settingsScope.set('presetOptions', patch)`는 섹션 전체를 교체하므로 추정기의 두 번째 필드(프로바이더, 모델, 엔드포인트)를 건드리면 `estimatorMode`와 다른 모든 재정의가 삭제되어, 패널은 저장 성공을 보고하는데도 추정기가 조용히 꺼졌습니다. 이제 패치는 저장된 섹션 위에 병합되고, `undefined`는 지목한 필드만 지우며, 변경 없는 패치는 쓰지 않고, confirm-on-write는 채널 하나가 아니라 같은 필드 집합을 검증합니다.
- 회귀 커버리지 추가: `packages/selector/tests/preset-options-write.client.spec.ts`(병합 쓰기, 형제 필드 보존, 명시적 삭제, 변경 없음 시 무쓰기, 미커밋 쓰기 보고)와 `packages/selector/tests/estimator-channel.client.spec.tsx`(채널별 필드, 카탈로그 드롭다운, 수동 폴백).
