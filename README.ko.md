# dsh-context-compression-improved

> [dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector)의 개선 포크——DeepSeek Harness용 감사 가능한 도구 결과 컨텍스트 압축 셀렉터에, 직교하는 **코드 스켈레톤 압축 게이트**를 추가했습니다.

[English](README.md) · [中文说明](README.zh.md) · [日本語](README.ja.md) · [변경 로그](CHANGELOG.ko.md) · [설치 가이드](docs/installation.ko.md)

> [!NOTE]
> **이 포크가 업스트림 0.1.0에 추가한 것:**
>
> - 직교하는 **코드 스켈레톤 압축 게이트**(`codeSkeleton.enabled`, 기본값 off): 매우 큰 소스코드 도구 결과가 처음 노출될 때, 일반 리듀서로 넘어가기 전에 임포트와 선언부의 스켈레톤을 보존할 수 있습니다(함수 본문은 생략, 에러 라인은 유지).
> - 동일한 셀렉터 설정 섹션에 모든 압축 프로파일과 독립적인 이 게이트의 토글을 추가.
> - CI에 통합된 ESLint 베이스라인, `test:watch` TDD 루프, 영어/중국어(간체)/일본어/한국어 문서.

> [!IMPORTANT]
> 이 프로젝트는 **DeepSeek 모델만** 지원합니다. 손실 없는 측정과 손실 압축은 번들된 DeepSeek 공식 토크나이저(`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`)에 의존합니다. 그 외의 경우 fail-open으로 동작하며 원본 도구 결과를 유지합니다. 전체 안전 모델은 [업스트림 README](https://github.com/WilliamShi666/dsh-context-compression-selector#model-support-and-safety)를 참고하세요.

## 이것은 무엇인가

장시간 실행되는 에이전트 작업은 대량의 도구 출력을 축적합니다. 이 커뮤니티 플러그인은 DeepSeek Harness 코어를 수정하지 않고, 선택 가능하고 감사 가능한 도구 결과 컨텍스트 압축 정책을 제공합니다:

- **Fresh**: 모델이 받기 전에 새로 커진 도구 결과 세그먼트를 사전 압축합니다.
- **Aggregate**: Fresh 압축 후에도 예산을 초과하면 다시 압축합니다.
- **History / micro-compact**: 최근 작업 컨텍스트를 보호하면서 대상이 되는 오래된 도구 결과를 교체합니다.
- **TailTrim**: Custom에서만 활성화할 수 있는 선택적 테일 축소 경로입니다.
- **Native**: Harness 방식의 head/중간/tail 트리밍을 하나의 명시적 프로파일로 유지합니다.
- **코드 스켈레톤(신규, 직교 게이트)**——아래 참고.

모든 결정은 기록됩니다: 단계, 리듀서, 트리거 이유, 건너뜀 이유, 그리고 가능한 경우 정확한 토큰 수.

## 코드 스켈레톤 게이트(신규)

게이트를 활성화하면 매우 큰 **소스코드 도구 결과**(예: 큰 `read_file`)에 대해 먼저 스켈레톤 축소를 시도합니다: 임포트와 타입/함수/클래스 선언을 유지하고, 함수 본문은 마커와 함께 생략하며, 생략된 본문 안의 에러 라인은 보존합니다. 스켈레톤을 생성하거나 검증할 수 없으면 원래의 head 트리밍으로 폴백합니다——이 게이트가 컨텍스트를 악화시킬 수는 없습니다.

특성:

- **직교**: 선택된 프로파일(`balanced`, `savings`, `cache-strict`, `adaptive`, `custom`, `off`, `native`)과 독립적입니다. 모든 프로파일이 이 게이트를 받습니다.
- **기본값 off**: `codeSkeleton: { enabled: false }`이며, 직접 켜기 전까지는 동작하지 않습니다.
- **측정이 선행**: 정확한 DeepSeek 토크나이저가 필요하며, 사용할 수 없으면 fail-open합니다.
- **세션 고정**: 다른 셀렉터 설정과 마찬가지로 변경 사항은 새로 관찰된 세션에만 적용됩니다.
- **엄격한 파싱**: `codeSkeleton`은 정확히 `{ enabled: boolean }`이어야 합니다. 잘못된 값은 런타임 쪽에서 예외를 던지고, 브라우저 UI에서는 읽을 수 없음으로 표시됩니다.

## 설정 UI

동일한 설정 섹션에서 압축 프로파일 선택, Auto Compact 트리거 레벨 조정, 코드 스켈레톤 압축 토글을 모두 처리할 수 있습니다. 토글은 변경 시 즉시 저장되며, 다시 불러올 때 저장된 상태가 표시됩니다.

![Context Compression Selector 설정 UI](docs/assets/context-compression-selector-settings.png)

## 설치

소스에서 빌드하여 설치합니다(이 포크는 아직 npm에 게시되지 않았습니다. 내부 패키지 이름은 의도적으로 업스트림과 동일하게 유지됩니다):

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

이후 셀렉터 패키지를 pack 해서 Harness 프로파일에 추가합니다——검증과 제거를 포함한 전체 절차는 [설치 가이드](docs/installation.ko.md)를 참고하세요.

## 개발

```sh
pnpm install --frozen-lockfile
pnpm lint          # ESLint 베이스라인(CI에서도 강제)
pnpm typecheck     # runtime + selector + tests tsc 및 bundle 단계
pnpm test          # vitest 전체 스위트
pnpm test:watch    # TDD 루프: 먼저 실패하는 회귀 테스트를 작성하고, 통과시킨다
pnpm build
pnpm verify:release
```

기여는 업스트림의 규율을 따릅니다: 먼저 실패하는 회귀 테스트를 추가하고, 모든 프로덕션 변경은 이 저장소 안에 유지하며, "트리거됨", "활성화되었지만 건너뜀", "fail-open"의 증거를 각각 따로 제시하세요. [CONTRIBUTING.md](CONTRIBUTING.md) 참고.

## 호환성

- 공개된 플러그인 및 프로파일 API만 사용하여 DeepSeek Harness `dsh-v0.1.1-rc.2`에서 검증되었으며, 공식 `dsh-v0.1.2-alpha.5` 릴리스와 호환됩니다.
- Node `^22.19.0 || >=24`와 pnpm `11.7.0`이 필요합니다.
- 플러그인은 Harness의 공개 확장 API만 사용하며 Harness 코어를 수정하지 않습니다. 비공식 커뮤니티 프로젝트이며 DeepSeek과 제휴하거나 승인받지 않았습니다.

## 크레딧과 라이선스

- 업스트림 프로젝트와 기존의 모든 작업: [WilliamShi666/dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector), 작성자 WilliamShi666(MIT).
- 포크에서 추가된 것(코드 스켈레톤 게이트, 툴체인, 다국어 문서): drscrewdriver.
- MIT——[LICENSE](LICENSE)(업스트림 저작권 표기 유지) 참고. 번들된 토크나이저의 출처는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
