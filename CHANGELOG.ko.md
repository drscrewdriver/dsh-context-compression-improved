# 변경 로그(포크 추가 항목)

> 전체 히스토리(업스트림 0.1.0 이전 포함)는 [CHANGELOG.md](CHANGELOG.md)를 참고하세요. 이 파일은 포크의 추가 항목만 번역한 것입니다. · [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md)

## Unreleased(미출시)
### Changed(0.1.5 호환 / compat/0.1.5 브랜치)

- 이 브랜치에서 공식 DeepSeek Harness `v0.1.5-rc.2`에 적응. 모든 `@deepseek-ai/dsh-*` 개발 의존성과 e2e 공식 호스트 목록을 `0.1.1-rc.2`에서 `0.1.5-rc.2`로 업데이트(cordis `4.0.2`, schemastery `3.18.2`, 새 분할 패키지들과 `dsh-client-store` 클라이언트 스택 포함).
- surface 치환은 v3의 `startSeq`/`endSeq` 형태와 브랜딩된 `SessionSeq` 사용. surface node의 이벤트 해석을 배열 인덱스에서 seq 조회로 변경.
- 클라이언트 번들은 제거된 `@deepseek-ai/dsh-client-runtime`을 참조하지 않음. settings 타입은 `@deepseek-ai/dsh-client-ui-settings`, 세션 hooks는 `@deepseek-ai/dsh-client-ui-session`에서 가져옴. `engines.dsh >=0.1.5-alpha.1 <0.2.0-0` 선언.
- Harness 0.1.5는 세션 `agentPreset`을 브라우저에 노출하지 않으므로 클라이언트에서 Minimal 세션을 감지할 수 없음. 셀렉터는 선택 가능한 상태 유지.
- 테스트를 0.1.5 시맨틱에 맞춰 업데이트(`.await()`, `SessionProjectionRegistry`, `stream: []`, 문자열 settings 네임스페이스).

### 추가

- 직교하는 코드 스켈레톤 압축 게이트(`codeSkeleton.enabled`, 기본값 off): 매우 큰 소스코드 도구 결과가 처음 노출될 때 임포트와 선언부의 스켈레톤을 보존할 수 있습니다(함수 본문 생략, 에러 라인 유지). 실패 시 기존의 head 트리밍으로 폴백합니다. 게이트는 모든 프로파일과 독립적이며 정확한 토크나이저 측정이 전제입니다.
- 셀렉터 설정 섹션에 게이트의 토글 추가(간체 중국어·영문 카피 포함).
- 새 섹션의 브라우저/런타임 디코드 정합성 테스트, `saveCodeSkeleton`의 confirm-on-write 컨트랙트 테스트, 전체 문서 패리티 매트릭스 확장.

### 변경

- ESLint 플랫 설정 베이스라인(`pnpm lint`, CI에서도 강제)과 `pnpm test:watch` TDD 루프를 추가. 죽은 임포트를 정리하고, lint 베이스라인에서 드러난 두 오류 경로를 보강했습니다.
- 이 저장소는 이제 `WilliamShi666/dsh-context-compression-selector`의 개선 포크로 관리됩니다. 문서는 영어·중국어(간체)·일본어·한국어로 제공됩니다.
