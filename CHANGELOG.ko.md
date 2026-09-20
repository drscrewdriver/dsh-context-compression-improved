# 변경 로그(포크 추가 항목)

> 전체 히스토리(업스트림 0.1.0 이전 포함)는 [CHANGELOG.md](CHANGELOG.md)를 참고하세요. 이 파일은 포크의 추가 항목만 번역한 것입니다. · [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [日本語](CHANGELOG.ja.md)

## 0.5.1 - 2026-09-20

### Fixed(수정)

- 동일 identity를 동시에 compose하는 preset-overlay가 Windows에서 더 이상 실패하지
  않습니다. 게시는 대상 경로별로 직렬화되며, 그래도 원자적 rename이 경쟁에서 지면 대상이
  이미 이 스테이징 파일과 같은 `{mtimeMs, size}` standing key를 가지고 있는지 확인한 뒤에만
  성공으로 간주합니다. Windows의 `MoveFileEx`는 이 경쟁을 `EPERM`/`EBUSY`로 보고하지만
  POSIX `rename`은 대상을 그대로 교체합니다——이 때문에 동시 세션 시작 시
  `standingKeyFor()`가 예외를 던졌습니다. 일치하지 않는 대상은 여전히 명확히 실패하며,
  조용한 세대 재사용은 계속 금지됩니다.
- 이 문제와 다른 기존 레드 게이트를 가리던 릴리스 게이트/테스트 수정
  (packed smoke의 오래된 식별자와 폐기된 audit reason, 낡은 client inject 기대값,
  Windows 전용 spawn 함정).

## 0.5.0 - 2026-09-20

### Added(추가)

- 어드바이저리 관련도 어드바이저(통계와 제안 전용, 기본 꺼짐): 모든 턴 경계에서
  fire-and-forget 패스를 실행하여, 최신 `todo/write` 이벤트에서 세션의 후미 작업 의미를
  요약하고(todolist 가 없으면 최근 사용자 텍스트로 폴백), 역사적 tool-result 후보의
  "내용+주석 의미 ↔ 현재 작업" 관련도를 증분 스코어링하며, prefix-decay 수치(characterPressure
  가중 관련도 평균의 역)를 계산합니다. 관련도가 낮은 오래된 세그먼트는 `recertified` 로
  표시되지만 이는 향후 history 공격성 판단을 위한 제안 입력일 뿐——이번 라운드에서 이를
  소비하는 경로는 없으며, 어드바이저 출력이 착지해야 할 reduction 을 억제·지연·재작성하는
  일은 결코 없습니다(전용 불변 테스트로 고정). `presetOptions.advisor*` 설정 키로 구성
  (`advisorMode` `''|'host'|'direct'`, 기본 `''`; direct 채널은 estimator 엔드포인트 재사용;
  `SideChannel` 에 선택적 overrides 매개변수 추가로 설정 공유 없이 전송 계층 공유).
  관측성: 새로운 `advisor-outcome` 감사 레코드(content-free, summary / scoring / decay 각
  페이즈별 1개)와 읽기 전용 HTTP 라우트 `GET .../advisor-report?sessionId=`(배포 opt-in
  플래그 `advisorReportRoute`, review 라우트와 동일한 뼈대). 클라이언트 UI 는 이번 라운드에서
  의도적으로 제공하지 않습니다.

## 0.4.0 - 2026-09-20

### Fixed(수정)

- 플러그인이 더 이상 라우팅 model id 에 의존하지 않습니다. 모든 계획 게이트는
  exact tokenizer 카운트 대신 문자 기준(Unicode 코드 포인트, `characterPressure` /
  `pressureCost` 경유)으로 판단하므로, 번들 tokenizer 이 없는 라우트(실운영
  `deepseek-flash`)에서도 리라이트가 침묵 없이 착지합니다. token 임계값의 키 이름과
  값은 유지되고(기존 4.0 문자/token 규약으로 변환, 고정된 profile 베이스라인 무변경),
  token 수치는 텔레메트리로 강등되며 rewrite 감사 레코드의 새 필드 `measurementBasis`가
  정직하게 구분합니다(`exact-tokenizer` 와 `characters`, 파생 시
  `tokenizerId: 'characters'` / `tokenizerRevision: 'chars-per-token-4.0'`).
  롤백: 이후 변경이 이 커밋에 의존하지 않는지 확인한 뒤 `git revert 7a1972a` 를
  실행하세요.
### Changed(0.1.5 호환 / compat/0.1.5 브랜치)

- runtime 패키지를 selector 패키지로 통합했습니다. 한 번의 설치로 전체 스택이 들어오고,
  저장소 루트가 설치면이 됩니다(`name`, `main`, `types`, `./pruner`와 `./invariant`를 포함한
  `exports`, `dependencies`, `dsh`). 툴체인, 스크립트, CI도 단일 패키지로 정리했습니다.
  실기에서 검증한 estimator-catalog 라우트 등록(이중 접두사, 보호된 이중 채널 활성화, 요청별
  서비스 해석, 관측 가능한 수명주기 로그)을 이 라인에 재적용하고 호스트 측 가드를 추가했습니다.
  `ab2175a`에서 `z.any()`로 낮춰졌던 settings 스키마를 복원해 Custom 기본값이 다시 게시됩니다.
- 이 브랜치에서 공식 DeepSeek Harness `v0.1.5-rc.2`에 적응. 모든 `@deepseek-ai/dsh-*` 개발 의존성과 e2e 공식 호스트 목록을 `0.1.1-rc.2`에서 `0.1.5-rc.2`로 업데이트(cordis `4.0.2`, schemastery `3.18.2`, 새 분할 패키지들과 `dsh-client-store` 클라이언트 스택 포함).
- surface 치환은 v3의 `startSeq`/`endSeq` 형태와 브랜딩된 `SessionSeq` 사용. surface node의 이벤트 해석을 배열 인덱스에서 seq 조회로 변경.
- 클라이언트 번들은 제거된 `@deepseek-ai/dsh-client-runtime`을 참조하지 않음. settings 타입은 `@deepseek-ai/dsh-client-ui-settings`, 세션 hooks는 `@deepseek-ai/dsh-client-ui-session`에서 가져옴. `engines.dsh >=0.1.5-alpha.1 <0.2.0-0` 선언.
- Harness 0.1.5는 세션 `agentPreset`을 브라우저에 노출하지 않으므로 클라이언트에서 Minimal 세션을 감지할 수 없음. 셀렉터는 선택 가능한 상태 유지.
- 테스트를 0.1.5 시맨틱에 맞춰 업데이트(`.await()`, `SessionProjectionRegistry`, `stream: []`, 문자열 settings 네임스페이스).

### 수정

- 추정기 카드가 Harness 호스트 채널에서 더 이상 API 키를 요구하지 않습니다. 호스트 채널을 선택하면 라이브 프로바이더/모델 드롭다운이 표시되고 실제로 사용될 라우트(명시적 재정의, 없으면 세션 기본 모델)를 알려줍니다. 키 입력란과 두 번째 수동 모델 입력란은 렌더링되지 않습니다 — 엔드포인트 URL, 모델 텍스트 필드, 쓰기 전용 키는 직접 연결 채널에만 속합니다.
- `presetOptions` 쓰기를 경로 지정 방식으로 변경했습니다. 기존에는 섹션 전체를 교체했기 때문에 추정기의 두 번째 필드(프로바이더, 모델, 엔드포인트)를 건드리면 `estimatorMode`와 다른 모든 재정의가 삭제되어, 패널은 저장 성공을 보고하는데도 추정기가 조용히 꺼졌습니다. 이제 각 필드는 자기 경로만 쓰고, `undefined`는 지목한 필드만 지우며, confirm-on-write는 채널 하나가 아니라 같은 필드 집합을 검증합니다.
- 회귀 커버리지 추가: `packages/selector/tests/preset-options-write.client.spec.ts`(경로 단위 쓰기, 형제 필드 보존, 명시적 삭제, 변경 없음 시 무쓰기, 미커밋 쓰기 보고)와 `packages/selector/tests/estimator-channel.client.spec.tsx`(채널별 필드, 카탈로그 드롭다운, 수동 폴백).

### 추가

- 직교하는 코드 스켈레톤 압축 게이트(`codeSkeleton.enabled`, 기본값 off): 매우 큰 소스코드 도구 결과가 처음 노출될 때 임포트와 선언부의 스켈레톤을 보존할 수 있습니다(함수 본문 생략, 에러 라인 유지). 실패 시 기존의 head 트리밍으로 폴백합니다. 게이트는 모든 프로파일과 독립적이며 정확한 토크나이저 측정이 전제입니다.
- 셀렉터 설정 섹션에 게이트의 토글 추가(간체 중국어·영문 카피 포함).
- 새 섹션의 브라우저/런타임 디코드 정합성 테스트, `saveCodeSkeleton`의 confirm-on-write 컨트랙트 테스트, 전체 문서 패리티 매트릭스 확장.

### 변경

- ESLint 플랫 설정 베이스라인(`pnpm lint`, CI에서도 강제)과 `pnpm test:watch` TDD 루프를 추가. 죽은 임포트를 정리하고, lint 베이스라인에서 드러난 두 오류 경로를 보강했습니다.
- 이 저장소는 이제 `WilliamShi666/dsh-context-compression-selector`의 개선 포크로 관리됩니다. 문서는 영어·중국어(간체)·일본어·한국어로 제공됩니다.
